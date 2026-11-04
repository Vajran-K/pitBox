import { Link } from "react-router-dom";
import { useData, type Index } from "../data";
import { dateLabel, shortEventName } from "../lib/format";

/** Every exported race, newest first, grouped by season. */
export default function Races() {
  const index = useData<Index>("index.json");
  if (index.error) return <p className="empty">{index.error}</p>;
  if (index.loading) return <p className="empty">Loading races…</p>;
  const all = index.data?.sessions ?? [];
  const races = all.filter((s) => s.type === "Race").sort((a, b) => b.start.localeCompare(a.start));
  const quali = new Map(all.filter((s) => s.type === "Qualifying").map((q) => [`${q.year}-${q.meetingName ?? q.country}`, q]));
  const byYear = new Map<number, typeof races>();
  for (const r of races) byYear.set(r.year, [...(byYear.get(r.year) ?? []), r]);
  return (
    <article>
      <header className="page-head">
        <p className="kicker">Races</p>
        <h1>Every race with full data</h1>
        <p className="lede">Lap-by-lap timing, tyres, team radio and telemetry from 2023 on. For results back to 1950, see <Link to="/season">Seasons</Link>.</p>
      </header>
      {races.length === 0 && <p className="empty">No races exported yet. Run <code>python -m pipeline sessions --year 2026</code>.</p>}
      {[...byYear].map(([year, list]) => (
        <section key={year} className="race-year">
          <h2>{year}</h2>
          <ul className="race-list">
            {list.map((r) => {
              const q = quali.get(`${r.year}-${r.meetingName ?? r.country}`);
              return (
                <li key={r.key}>
                  <Link to={`/race/${r.key}`}>{shortEventName(r.country, r.type, r.name, r.meetingName)}</Link>
                  <span className="muted">{q && <><Link to={`/race/${q.key}/replay`}>Quali replay</Link> · </>}{dateLabel(r.start)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </article>
  );
}
