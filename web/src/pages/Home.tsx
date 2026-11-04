import { Link } from "react-router-dom";
import { useData, type Index, type Meta } from "../data";
import { eventName, localDate, properName } from "../lib/format";
import { currentOrNextWeekend, isLiveNow, useSchedule, whenLabel, type ScheduledSession, type Weekend } from "../lib/schedule";
import { useChat } from "../components/GlobalChat";

/** Home: the race weekend that's on (or next), the last race, and a way into every part of the site. */
export default function Home() {
  const chat = useChat();
  const index = useData<Index>("index.json");
  const { sessions } = useSchedule();
  const races = (index.data?.sessions ?? []).filter((s) => s.type === "Race").sort((a, b) => b.start.localeCompare(a.start));
  const latest = races[0];
  const meta = useData<Meta>(latest ? `sessions/${latest.key}/meta.json` : null);
  const now = Date.now();
  const cw = currentOrNextWeekend(sessions, now);

  if (index.error) return <p className="empty">{index.error}</p>;

  const podium = meta.data ? meta.data.result.filter((r) => r.position && r.position <= 3).sort((a, b) => a.position! - b.position!)
    .map((r) => meta.data!.drivers.find((d) => d.number === r.driver_number)).filter(Boolean) : [];

  return (
    <div className="home">
      <h1 className="sr-only">PitBox</h1>
      <section className="home-cards">
        {cw ? <WeekendCard {...cw} now={now} /> : (
          <div className="panel home-card"><p className="tile-kicker">Next race</p><p className="muted">The calendar isn't loaded. Start the rooms server (dev.bat) or run the pipeline.</p></div>
        )}

        {latest && (
          <div className="panel home-card">
            <p className="tile-kicker">Last race</p>
            <h2><Link to={`/race/${latest.key}`}>{eventName(latest.country, latest.type, latest.name, latest.meetingName)} {latest.year}</Link></h2>
            <p className="muted">{meta.data ? `${meta.data.circuit}, ${localDate(meta.data.start, meta.data.gmtOffset)}` : ""}</p>
            {podium.length > 0 && (
              <ol className="podium">
                {podium.map((d, i) => (
                  <li key={d!.number}><span className="pos">P{i + 1}</span><span className="team-bar" style={{ background: d!.colour ? `#${d!.colour}` : "var(--muted)" }} /><strong>{properName(d!.name)}</strong><span className="muted">{d!.team}</span></li>
                ))}
              </ol>
            )}
            <div className="buttons">
              <Link className="button" to={`/race/${latest.key}`}>Race page</Link>
              <Link className="button secondary" to={`/race/${latest.key}/replay`}>Replay</Link>
              <Link className="button secondary" to={`/rooms?race=${latest.key}`}>Watch together</Link>
            </div>
          </div>
        )}
      </section>

      <nav className="tiles" aria-label="Everything in PitBox">
        <Link to="/live" className="tile"><span className="tile-kicker">Live</span><h2>Live timing</h2><p>Tower, gaps, tyres, flags, race control and team radio with transcripts.</p></Link>
        <Link to="/rooms" className="tile"><span className="tile-kicker">Together</span><h2>Watch rooms</h2><p>Watch a live session or a replay with friends: chat, react, call the result.</p></Link>
        <Link to="/races" className="tile"><span className="tile-kicker">Races</span><h2>Every race since 2023</h2><p>Lap charts, strategy, telemetry, radio and replays.</p></Link>
        <button className="tile tile-ai" onClick={() => chat.openChat()}><span className="tile-kicker">AI</span><h2>Ask PitBox</h2><p>Ask about any race in plain English. Every number comes from the data.</p></button>
        <Link to="/season" className="tile"><span className="tile-kicker">History</span><h2>Seasons</h2><p>Standings and title fights since 1950.</p></Link>
        <Link to="/drivers" className="tile"><span className="tile-kicker">History</span><h2>Compare drivers</h2><p>Any two drivers side by side.</p></Link>
      </nav>
    </div>
  );
}

function WeekendCard({ weekend, underway, now }: { weekend: Weekend; underway: boolean; now: number }) {
  const live = weekend.sessions.find((s) => isLiveNow(s, now));
  const roomable = (s: ScheduledSession) => /Race|Qualifying|Sprint/.test(s.name) && Date.parse(s.end ?? s.start) + 3600e3 > now;
  return (
    <div className={`panel home-card weekend${live ? " is-live" : ""}`}>
      <p className="tile-kicker">{live ? <span className="live-dot">Live now</span> : underway ? "This weekend" : "Next race"}</p>
      <h2>{weekend.name}</h2>
      <p className="muted">{weekend.sessions[0]?.circuit ?? weekend.sessions[0]?.country}</p>
      <ul className="schedule">
        {weekend.sessions.map((s) => {
          const on = isLiveNow(s, now);
          const done = !on && Date.parse(s.end ?? s.start) < now;
          return (
            <li key={s.key} className={on ? "on" : done ? "done" : undefined}>
              <span className="s-name">{s.name}</span>
              <span className="s-when">{on ? "Live now" : done ? "Finished" : whenLabel(s.start, now)}</span>
              <span className="s-act">
                {on && <Link to="/live">Watch live</Link>}
                {!done && roomable(s) && <Link to={`/rooms?live=${s.key}`}>{on ? "Room" : "Plan a room"}</Link>}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="buttons">
        <Link className="button" to="/live">{live ? `Watch ${live.name} live` : "Live timing"}</Link>
      </div>
    </div>
  );
}
