import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { teamColour, useData, type Driver, type Meta, type Timing, type Track } from "../data";
import { eventName } from "../lib/format";
import { neutralisedLaps } from "../lib/race";
import { buildReplay, carStates, clockLabel, gapLabel, tyreAt, type Replay as ReplayModel } from "../lib/replay";
import { SPEEDS, useReplayClock, type Clock } from "../lib/useReplayClock";
import ReplayMap from "../charts/ReplayMap";
import { setTranscriptsEnabled, useTranscripts } from "../lib/transcribe";
import { buildQuali, lapTimeMs, qualiBoard, type QualiBoard } from "../lib/quali";

const COMPOUND: Record<string, { letter: string; cls: string }> = {
  SOFT: { letter: "S", cls: "soft" }, MEDIUM: { letter: "M", cls: "medium" }, HARD: { letter: "H", cls: "hard" },
  INTERMEDIATE: { letter: "I", cls: "inter" }, WET: { letter: "W", cls: "wet" },
};

export default function Replay() {
  const { key } = useParams();
  const meta = useData<Meta>(`sessions/${key}/meta.json`);
  const timing = useData<Timing>(`sessions/${key}/timing.json`);
  const track = useData<Track>(`sessions/${key}/track.json`);

  if (meta.error || timing.error) return <p className="empty">{meta.error ?? timing.error}</p>;
  if (!meta.data || !timing.data || track.loading) return <p className="empty">Loading the replay…</p>;
  return <ReplayView meta={meta.data} timing={timing.data} track={track.data ?? null} />;
}

/**
 * The replay itself. On its own it runs a local clock; a watch room passes `clock`
 * (driven by the shared room clock) plus its own extras.
 */
export function ReplayView({ meta, timing, track, clock: external, kicker, overlay, children, main, side }: {
  meta: Meta; timing: Timing; track: Track | null;
  clock?: Clock; kicker?: ReactNode; overlay?: ReactNode; children?: ReactNode;
  /** Watch-room layout: tower and `main` (the chat) fill the screen, with a small map and `side` beside them. */
  main?: ReactNode; side?: ReactNode;
}) {
  const rp = useMemo(() => buildReplay(meta, timing, track), [meta, timing, track]);
  const local = useReplayClock(rp.start, rp.end);
  const clock = external ?? local;
  const [selected, setSelected] = useState<number | null>(null);
  const drivers = useMemo(() => new Map(meta.drivers.map((d) => [d.number, d])), [meta]);
  useKeyboard(clock, rp);

  const quali = meta.type === "Qualifying";
  const qm = useMemo(() => (quali ? buildQuali(meta, timing) : null), [quali, meta, timing]);
  const board = qm ? qualiBoard(qm, rp, clock.t) : null;
  const allCars = carStates(rp, timing, clock.t);
  // qualifying: only cars on a timed or cool-down lap are on the map; the rest are in the garage
  const onTrack = board ? new Set(board.rows.filter((r) => r.onTrack).map((r) => r.d)) : null;
  const cars = onTrack ? allCars.filter((c) => onTrack.has(c.d)) : allCars;
  const leader = cars[0];
  const leaderLap = Math.min(rp.totalLaps, Math.max(1, leader?.lap ?? 1));
  const neutral = useMemo(() => neutralisedLaps(timing.raceControl, rp.totalLaps), [timing, rp.totalLaps]);
  const flag = quali ? undefined : neutral.find((n) => leaderLap >= n.from && leaderLap <= n.to);
  const finished = cars.some((c) => c.status === "finished");

  const header = (
    <header className="page-head replay-head">
      <div>
        <p className="kicker">{kicker ?? <Link to={`/race/${meta.key}`}>Race page</Link>}</p>
        <h1>{eventName(meta.country, meta.type, meta.name, meta.meetingName)} {meta.year}</h1>
      </div>
      <div className="replay-status" aria-live="polite">
        <span className="lapcount">{board ? (clock.t < rp.start ? "Before the session" : board.label) : finished ? "Finished" : clock.t < rp.start ? "Lights out soon" : `Lap ${leaderLap} of ${rp.totalLaps}`}</span>
        <span className="muted">{clock.t < rp.start ? `in ${clockLabel(rp.start - clock.t).replace(/^0:/, "")}` : clockLabel(clock.t - rp.start)}</span>
        {flag && <span className={`flag flag-${flag.kind}`}>{flag.kind === "SC" ? "Safety car" : flag.kind === "VSC" ? "Virtual safety car" : "Red flag"}</span>}
      </div>
    </header>
  );
  const map = rp.ref
    ? <ReplayMap refLap={rp.ref} cars={cars} drivers={drivers} selected={selected} onSelect={setSelected} />
    : <p className="empty">No track map for this session (it was exported without telemetry). The timing tower still works.</p>;
  const tower = board
    ? <QualiTower board={board} timing={timing} drivers={drivers} selected={selected} onSelect={setSelected} />
    : <Tower cars={cars} rp={rp} timing={timing} drivers={drivers} selected={selected} onSelect={setSelected} />;
  const marks = qm ? qm.flags.map((f, i) => ({ t: f, label: `${qm.prefix}${i + 1}` })) : undefined;

  if (main) return (
    <article className="replay room-mode">
      {header}
      <Controls clock={clock} rp={rp} marks={marks} />
      <div className="room-layout">
        <div className="room-tower">{tower}</div>
        <div className="room-main">{overlay}{main}</div>
        <aside className="room-side">
          <div className="panel map-panel mini">{map}</div>
          {side}
          <Feed timing={timing} drivers={drivers} t={clock.t} rp={rp} />
        </aside>
      </div>
      {children}
    </article>
  );

  return (
    <article className="replay">
      {header}

      <Controls clock={clock} rp={rp} marks={marks} />

      <div className="replay-grid">
        <div className="panel map-panel">
          {overlay}
          {map}
          <p className="chart-note">
            Lap and sector times are exact. Within a sector, cars are placed by following the fastest lap's line, so small
            gaps between close cars can look slightly different from the real broadcast. Tap a car or a row to follow it.
          </p>
        </div>
        {tower}
      </div>

      {children}
      <Feed timing={timing} drivers={drivers} t={clock.t} rp={rp} />
    </article>
  );
}

function Controls({ clock, rp, marks }: { clock: Clock; rp: ReplayModel; marks?: { t: number; label: string }[] }) {
  const span = rp.end - rp.start;
  return (
    <div className="controls">
      <button className="play" onClick={clock.toggle} aria-label={clock.playing ? "Pause" : "Play"}>
        {clock.playing ? "Pause" : clock.t >= rp.end ? "Replay" : "Play"}
      </button>
      <div className="speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button key={s} className={s === clock.speed ? "on" : undefined} aria-pressed={s === clock.speed} onClick={() => clock.setSpeed(s)}>{s}×</button>
        ))}
      </div>
      <div className="scrubber">
        <input type="range" min={rp.start} max={rp.end} step={1000} value={clock.t}
          aria-label="Race time" aria-valuetext={clockLabel(clock.t - rp.start)}
          onChange={(e) => clock.seek(Number(e.target.value))} />
        <div className="lap-ticks" aria-hidden>
          {marks ? marks.map((m) => <span key={m.label} style={{ left: `${((m.t - rp.start) / span) * 100}%` }}>{m.label} end</span>)
            : rp.leaderLineTimes.map((lt, n) => n > 0 && n % (rp.totalLaps > 40 ? 10 : 5) === 0 && isFinite(lt) && (
            <span key={n} style={{ left: `${((lt - rp.start) / span) * 100}%` }}>{n}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tower({ cars, rp, timing, drivers, selected, onSelect }: {
  cars: ReturnType<typeof carStates>; rp: ReplayModel; timing: Timing; drivers: Map<number, Driver>;
  selected: number | null; onSelect: (d: number | null) => void;
}) {
  const leader = cars[0];
  return (
    <ol className="tower" aria-label="Running order">
      {cars.map((c, i) => {
        const d = drivers.get(c.d);
        const tyre = tyreAt(timing.stints, c.d, Math.max(1, c.lap));
        const comp = tyre?.compound ? COMPOUND[tyre.compound] : undefined;
        return (
          <li key={c.d} className={`${selected === c.d ? "on " : ""}${c.status === "out" ? "out" : ""}`}>
            <button onClick={() => onSelect(selected === c.d ? null : c.d)}>
              <span className="pos">{c.status === "out" ? "–" : i + 1}</span>
              <span className="team-bar" style={{ background: teamColour(d) }} />
              <span className="code">{d?.code}</span>
              <span className={`gap${c.status === "pit" ? " in-pit" : ""}`}>{c.status === "pit" ? "In pit" : leader ? gapLabel(rp, c, leader) : ""}</span>
              <span className="state">{c.status === "finished" ? "Flag" : ""}</span>
              {comp ? <span className={`tyre ${comp.cls}`} title={`${tyre!.compound!.toLowerCase()}, ${tyre!.age} laps old`}>{comp.letter}</span> : <span className="tyre none" />}
              <span className="age">{tyre ? tyre.age : ""}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function QualiTower({ board, timing, drivers, selected, onSelect }: {
  board: QualiBoard; timing: Timing; drivers: Map<number, Driver>; selected: number | null; onSelect: (d: number | null) => void;
}) {
  return (
    <ol className="tower quali" aria-label={`${board.label} times`}>
      {board.rows.map((r, i) => {
        const d = drivers.get(r.d);
        const st = [...timing.stints].reverse().find((x) => x.d === r.d && (x.from ?? 0) <= Math.max(1, r.laps + 1));
        const comp = st?.compound ? COMPOUND[st.compound] : undefined;
        return (
          <li key={r.d} className={`${selected === r.d ? "on " : ""}${r.knockedOut ? "out " : ""}${board.cutAfter === i ? "cut" : ""}`}>
            <button onClick={() => onSelect(selected === r.d ? null : r.d)}>
              <span className="pos">{r.pos}</span>
              <span className="team-bar" style={{ background: teamColour(d) }} />
              <span className="code">{d?.code}</span>
              <span className="gap">{r.best != null ? lapTimeMs(r.best) : "–"}</span>
              <span className="state">{r.knockedOut ? `Out in ${board.label.startsWith("SQ") ? "SQ" : "Q"}${r.outIn}` : r.onTrack ? "On track" : r.gap != null ? `+${(r.gap / 1000).toFixed(3)}` : ""}</span>
              {comp ? <span className={`tyre ${comp.cls}`}>{comp.letter}</span> : <span className="tyre none" />}
              <span className="age">{r.laps || ""}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Feed({ timing, drivers, t, rp }: { timing: Timing; drivers: Map<number, Driver>; t: number; rp: ReplayModel }) {
  const items = useMemo(() => [
    ...timing.raceControl.map((m) => ({ t: m.t, kind: "rc" as const, m })),
    ...timing.radio.map((r) => ({ t: r.t, kind: "radio" as const, r })),
  ].sort((a, b) => a.t - b.t), [timing]);
  const shown = items.filter((x) => x.t <= t && x.t >= rp.start - 60_000).slice(-8).reverse();
  const tr = useTranscripts(shown.flatMap((x) => (x.kind === "radio" ? [x.r.url] : [])));
  return (
    <section className="feed-section">
      <div className="radio-head">
        <h2>As it happened</h2>
        {timing.radio.length > 0 && (
          <label className="switch"><input type="checkbox" checked={tr.enabled} onChange={(e) => setTranscriptsEnabled(e.target.checked)} /><span>Radio transcripts</span></label>
        )}
      </div>
      {tr.enabled && tr.model.state === "loading" && <p className="chart-note">Downloading the speech model… {Math.round(tr.model.progress * 100)}%</p>}
      {shown.length === 0 && <p className="muted">Race control messages and team radio appear here as the replay reaches them.</p>}
      <ul className="feed">
        {shown.map((x) => {
          const when = clockLabel(x.t - rp.start);
          if (x.kind === "rc") return (
            <li key={`rc-${x.t}-${x.m.msg}`}><span className="when">{when}</span><span className="src">Race control</span><span className="rc-msg">{x.m.msg}</span></li>
          );
          const d = drivers.get(x.r.d);
          return (
            <li key={`r-${x.r.url}`}><span className="when">{when}</span>
              <span className="src"><span className="team-bar" style={{ background: teamColour(d) }} />{d?.code} radio</span>
              <audio controls preload="none" src={x.r.url}>Your browser can't play this clip.</audio>
              {tr.enabled && <Transcript t={tr.get(x.r.url)} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Transcript({ t }: { t: ReturnType<ReturnType<typeof useTranscripts>["get"]> }) {
  return (
    <p className={`transcript${t?.status === "done" ? "" : " pending"}`}>
      {t?.status === "done" ? `“${t.text}”` : t?.status === "error" ? `Couldn't transcribe: ${t.error}` : t?.status === "working" ? "Transcribing…" : "Waiting to transcribe…"}
    </p>
  );
}

function useKeyboard(clock: Clock, rp: ReplayModel) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input[type=search], input[type=text], textarea")) return;
      if (e.key === " ") { e.preventDefault(); clock.toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); clock.seek(clock.t + (e.shiftKey ? 90_000 : 10_000)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); clock.seek(clock.t - (e.shiftKey ? 90_000 : 10_000)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, rp]);
}
