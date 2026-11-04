import { useEffect, useState } from "react";
import { useData, type Index } from "../data";
import { liveRows, raceControl, remaining, sessionHeader, teamRadio, useLive, type LiveRow } from "../lib/live";
import RadioPanel from "../components/Radio";

const COMPOUND: Record<string, { letter: string; cls: string }> = {
  SOFT: { letter: "S", cls: "soft" }, MEDIUM: { letter: "M", cls: "medium" }, HARD: { letter: "H", cls: "hard" },
  INTERMEDIATE: { letter: "I", cls: "inter" }, WET: { letter: "W", cls: "wet" },
};
const clockTime = (utc: string) => (utc ? new Date(utc.endsWith("Z") ? utc : utc + "Z").toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

export default function Live() {
  const conn = useLive();
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);
  const h = sessionHeader(conn.state);
  const rows = liveRows(conn.state);
  const isRace = h.type === "Race" || h.type === "Sprint";
  const left = remaining(conn.state);

  return (
    <article className="live">
      <header className="page-head replay-head">
        <div>
          <p className="kicker">
            {conn.upstream === "connected" && h.live ? <span className="live-dot">Live</span> : "Live timing"}
            {h.meeting ? ` from ${h.meeting}` : ""}
          </p>
          <h1>{h.session ?? "Live timing"}</h1>
        </div>
        <div className="replay-status">
          {h.lap && <span className="lapcount">Lap {h.lap.current}{h.lap.total ? ` of ${h.lap.total}` : ""}</span>}
          {!h.lap && left && h.live && <span className="lapcount">{left}</span>}
          {h.track && h.live && <span className={`track-status ${h.track.tone}`}>{h.track.label}</span>}
          {h.weather && <span className="muted">Air {h.weather.air}°, track {h.weather.track}°{h.weather.rain ? ", raining" : ""}</span>}
        </div>
      </header>

      <Status conn={conn} live={h.live} status={h.status} meeting={h.meeting} session={h.session} />

      {rows.length > 0 && (
        <div className="live-grid">
          <div className="panel live-tower-wrap">
            <table className="live-tower">
              <thead>
                <tr>
                  <th>Pos</th><th>Driver</th>
                  <th>{isRace ? "Gap" : "Gap to fastest"}</th><th>Interval</th>
                  <th>Last lap</th><th>Best</th><th className="sec">S1</th><th className="sec">S2</th><th className="sec">S3</th><th>Tyre</th>
                  {isRace && <th>Stops</th>}
                </tr>
              </thead>
              <tbody>{rows.map((r) => <Row key={r.n} r={r} isRace={isRace} />)}</tbody>
            </table>
            <p className="chart-note">
              <span className="t-overall">Purple</span> is the fastest in the session, <span className="t-personal">green</span> a driver's personal best, as on the official timing.
              Car telemetry and positions on the map aren't available live without an F1 TV subscription; they arrive about 30 minutes after the session.
            </p>
          </div>
          <aside className="live-side">
            <Feed title="Race control" items={raceControl(conn.state).slice(0, 12).map((m) => ({ key: m.utc + m.text, when: clockTime(m.utc), body: <span className="rc-msg">{m.text}</span> }))} empty="No messages yet." />
            <RadioPanel clips={teamRadio(conn.state).slice(0, 10).map((c) => {
              const r = rows.find((x) => x.n === c.n);
              return { url: c.url, when: clockTime(c.utc), code: r?.code ?? c.n, colour: r?.colour };
            })} empty="No radio yet." />
          </aside>
        </div>
      )}
      <Upcoming />
    </article>
  );
}

function Row({ r, isRace }: { r: LiveRow; isRace: boolean }) {
  const comp = r.tyre ? COMPOUND[r.tyre.compound] : undefined;
  return (
    <tr className={r.state === "Out" || r.state === "Stopped" ? "out" : undefined}>
      <td className="num pos">{r.pos < 99 ? r.pos : "–"}</td>
      <td className="drv"><span className="team-bar" style={{ background: r.colour }} /><strong>{r.code}</strong>{r.state && <span className="pit-flag">{r.state}</span>}</td>
      <td className="num">{r.gap}</td>
      <td className="num">{r.interval}</td>
      <td className={`num t-${r.last.mark}`}>{r.last.value}</td>
      <td className={`num${r.bestOverall ? " t-overall" : ""}`}>{r.best}</td>
      {r.sectors.map((s, i) => <td key={i} className={`num sec t-${s.mark}`}>{s.value}</td>)}
      <td>{comp ? <span className={`tyre ${comp.cls}`} title={`${r.tyre!.compound.toLowerCase()}, ${r.tyre!.laps} laps${r.tyre!.fresh ? ", new set" : ""}`}>{comp.letter}</span> : r.tyre ? <span className="muted">?</span> : null}<span className="age">{r.tyre ? ` ${r.tyre.laps}` : ""}</span></td>
      {isRace && <td className="num">{r.pits || ""}</td>}
    </tr>
  );
}

function Status({ conn, live, status, meeting, session }: { conn: ReturnType<typeof useLive>; live: boolean; status: string; meeting?: string; session?: string }) {
  if (conn.upstream === "relay-down") return <p className="empty error">Can't reach the live-timing relay. If you're running PitBox locally, start the rooms server (dev.bat starts it).</p>;
  if (conn.upstream === "connecting" && !session) return <p className="empty">Connecting to F1 live timing…</p>;
  if (conn.upstream === "error") return <p className="empty error">F1's live timing isn't answering right now. PitBox will keep retrying.</p>;
  if (!live && session) return <p className="empty">Nothing is running right now. Below is how {meeting} {session} finished ({status.toLowerCase() || "ended"}). This page switches to live timing on its own when the next session starts.</p>;
  return null;
}

function Feed({ title, items, empty }: { title: string; items: { key: string; when: string; body: React.ReactNode }[]; empty: string }) {
  return (
    <section className="panel live-feed">
      <h2>{title}</h2>
      {items.length === 0 ? <p className="muted">{empty}</p> : (
        <ul>{items.map((i) => <li key={i.key}><span className="when">{i.when}</span><span className="body">{i.body}</span></li>)}</ul>
      )}
    </section>
  );
}

function Upcoming() {
  const index = useData<Index & { upcoming?: { key: number; name: string; meetingName?: string | null; country: string; start: string }[] }>("index.json");
  const list = (index.data?.upcoming ?? []).filter((s) => Date.parse(s.start) > Date.now() - 2 * 3600e3).slice(0, 6);
  if (!list.length) return null;
  return (
    <section>
      <h2>Coming up</h2>
      <ul className="race-list upcoming">
        {list.map((s) => (
          <li key={s.key}>
            <span>{(s.meetingName ?? s.country).replace(/ Grand Prix$/, "")} {s.name}</span>
            <span className="muted">{new Date(s.start).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
