import { useEffect, useMemo, useState } from "react";
import { useData, type Driver, type Index, type Meta } from "../data";
import { liveDrivers, liveOutcome, liveRows, raceControl, remaining, sessionHeader, sessionOver, teamRadio, useLive, type LiveRow } from "../lib/live";
import { isQualiType, type RoomInfo } from "../lib/roomProtocol";
import { whenLabel } from "../lib/schedule";
import { useRoom } from "../lib/useRoom";
import { PicksPanel, Reactions, RoomBar, RoomChat } from "../components/RoomParts";
import RadioPanel from "../components/Radio";

const COMPOUND: Record<string, { letter: string; cls: string }> = {
  SOFT: { letter: "S", cls: "soft" }, MEDIUM: { letter: "M", cls: "medium" }, HARD: { letter: "H", cls: "hard" },
  INTERMEDIATE: { letter: "I", cls: "inter" }, WET: { letter: "W", cls: "wet" },
};
const clockTime = (utc: string) => (utc ? new Date(utc.endsWith("Z") ? utc : utc + "Z").toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "");

/**
 * A watch room for a live session: F1's live timing tower, chat, picks that lock at the
 * scheduled start, race control and team radio. There's no track map: live car positions
 * need an F1 TV subscription.
 */
export default function LiveRoom({ info, name }: { info: RoomInfo; name: string }) {
  const room = useRoom(info.code, name);
  const conn = useLive();
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);
  const s = room.state;
  const h = sessionHeader(conn.state);
  const ours = h.key === info.session;           // is F1's feed on this room's session yet?
  const rows = ours ? liveRows(conn.state) : [];
  const quali = isQualiType(info.sessionType);
  const now = Date.now();
  const started = now >= info.raceStart;
  const over = ours && sessionOver(h.status);

  // drivers for the pickers: the live entry list, or the last exported race before F1 publishes it
  const index = useData<Index>("index.json");
  const lastRace = (index.data?.sessions ?? []).filter((x) => x.type === "Race").sort((a, b) => b.start.localeCompare(a.start))[0];
  const lastMeta = useData<Meta>(lastRace ? `sessions/${lastRace.key}/meta.json` : null);
  const live = liveDrivers(conn.state);
  const drivers: Driver[] = live.length ? live : lastMeta.data?.drivers ?? [];

  // the first browser to see the final classification saves it to the room
  const outcome = s.result ?? (over ? liveOutcome(conn.state) : null);
  useEffect(() => {
    if (over && !s.result && s.status === "open" && rows.length) room.send({ type: "result", result: liveOutcome(conn.state) });
  }, [over, s.result, s.status, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const where = (): string | undefined => {
    if (!ours || !h.live) return started ? undefined : "Before the start";
    if (h.lap) return `Lap ${h.lap.current}`;
    const left = remaining(conn.state);
    return quali && h.part ? `Q${h.part}${left ? ` ${left.replace(/^0:/, "")} left` : ""}` : left ? `${left.replace(/^0:/, "")} left` : undefined;
  };
  const label = (m: { tag?: string; sentAt: number }) => m.tag ?? new Date(m.sentAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const radio = ours ? teamRadio(conn.state).slice(0, 10).map((c) => {
    const r = rows.find((x) => x.n === c.n);
    return { url: c.url, when: clockTime(c.utc), code: r?.code ?? c.n, colour: r?.colour };
  }) : [];
  const rc = ours ? raceControl(conn.state).slice(0, 10) : [];

  return (
    <article className="replay room-mode live-room">
      <header className="page-head replay-head">
        <div>
          <p className="kicker"><RoomBar state={s} code={info.code} /></p>
          <h1>{info.title}</h1>
        </div>
        <div className="replay-status" aria-live="polite">
          {ours && h.live ? <span className="live-dot">Live</span> : null}
          <span className="lapcount">{ours && h.live ? where() ?? h.status : over ? "Finished" : started ? "Starting soon" : "Starts"}</span>
          {!started && <span className="muted">{whenLabel(new Date(info.raceStart).toISOString(), now)}</span>}
          {ours && h.track && h.live && <span className={`track-status ${h.track.tone}`}>{h.track.label}</span>}
          {ours && h.weather && <span className="muted">Air {h.weather.air}°, track {h.weather.track}°{h.weather.rain ? ", rain" : ""}</span>}
        </div>
      </header>
      {conn.upstream === "relay-down" && <p className="empty error">Can't reach the live-timing relay. Start the rooms server (dev.bat starts it).</p>}

      <div className="room-layout">
        <div className="room-tower">
          {rows.length ? <LiveTower rows={rows} quali={quali} race={!quali && (h.type === "Race")} /> : (
            <div className="tower-wait">
              <p><strong>Timing appears here when {info.title.replace(/ \d{4}$/, "")} starts.</strong></p>
              <p className="muted">{started ? "Waiting for F1's feed to switch to this session…" : `Lights out ${whenLabel(new Date(info.raceStart).toISOString(), now)}.`}</p>
              {ours === false && h.session && <p className="muted">F1's feed is still on {h.meeting} {h.session}.</p>}
            </div>
          )}
        </div>
        <div className="room-main">
          <Reactions state={s} />
          {s.status === "failed" && <p className="empty error" role="alert">{s.error}</p>}
          <RoomChat room={room} label={label} tag={where} hint="No messages yet. Say hello, or make your picks on the right before the start." />
        </div>
        <aside className="room-side">
          {(info.sessionType && /Race|Sprint|Qualifying/.test(info.sessionType)) && (
            <PicksPanel room={room} drivers={drivers} quali={quali} locked={s.locked || started} finished={!!outcome} outcome={outcome}
              lockNote="Picks close at the scheduled start." />
          )}
          <section className="panel live-feed">
            <h2>Race control</h2>
            {rc.length === 0 ? <p className="muted">{ours ? "No messages yet." : "Messages appear once the session is on."}</p> : (
              <ul>{rc.map((m) => <li key={m.utc + m.text}><span className="when">{clockTime(m.utc)}</span><span className="body rc-msg">{m.text}</span></li>)}</ul>
            )}
          </section>
          <RadioPanel clips={radio} empty={ours ? "No radio yet." : "Team radio appears once the session is on."} />
        </aside>
      </div>
      <p className="chart-note">No track map in live rooms: live car positions need an F1 TV subscription. Replays have the map.</p>
    </article>
  );
}

function LiveTower({ rows, quali, race }: { rows: LiveRow[]; quali: boolean; race: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const firstOut = useMemo(() => rows.findIndex((r) => r.knockedOut), [rows]);
  return (
    <ol className="tower live" aria-label="Running order">
      {rows.map((r, i) => {
        const comp = r.tyre ? COMPOUND[r.tyre.compound] : undefined;
        const out = r.state === "Out" || r.state === "Stopped";
        return (
          <li key={r.n} className={`${selected === r.n ? "on " : ""}${out || r.knockedOut ? "out " : ""}${i === firstOut ? "cut" : ""}`}>
            <button onClick={() => setSelected(selected === r.n ? null : r.n)} title={r.name}>
              <span className="pos">{r.pos < 99 ? r.pos : "–"}</span>
              <span className="team-bar" style={{ background: r.colour }} />
              <span className="code">{r.code}</span>
              <span className={`gap${r.state === "In pit" ? " in-pit" : ""}`}>
                {r.state === "In pit" || r.state === "Pit exit" ? r.state : quali ? r.best || "No time" : race ? (i === 0 ? (r.laps ? `Lap ${r.laps}` : "Leader") : r.interval || r.gap) : r.best || r.gap}
              </span>
              <span className="state">{out ? r.state : r.knockedOut ? "Out" : quali && i > 0 ? r.gap : ""}</span>
              {comp ? <span className={`tyre ${comp.cls}`} title={`${r.tyre!.compound.toLowerCase()}, ${r.tyre!.laps} laps`}>{comp.letter}</span> : <span className="tyre none" />}
              <span className="age">{r.tyre ? r.tyre.laps : ""}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
