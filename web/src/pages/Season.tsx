import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useData, type HistDriver, type Index, type SeasonData, type Team } from "../data";
import LineChart, { type Series } from "../charts/LineChart";
import SearchBox from "../components/SearchBox";

const HIGHLIGHT = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

export default function Season() {
  const { year: param } = useParams();
  const nav = useNavigate();
  const index = useData<Index>("index.json");
  const seasons = index.data?.historySeasons ?? [];
  const year = Number(param) || seasons[seasons.length - 1];
  const season = useData<SeasonData>(year ? `history/seasons/${year}.json` : null);
  const drivers = useData<HistDriver[]>("history/drivers.json");
  const teams = useData<Team[]>("history/constructors.json");

  const name = useMemo(() => new Map((drivers.data ?? []).map((d) => [d.id, d])), [drivers.data]);
  const teamName = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t.name])), [teams.data]);

  const series = useMemo<Series[]>(() => {
    const s = season.data;
    if (!s) return [];
    const total = new Map<string, number>();
    const pts = new Map<string, { x: number; y: number; note?: string }[]>();
    for (const race of s.races.filter((r) => r.results.length)) {
      for (const r of [...race.results, ...race.sprint]) total.set(r.driver, (total.get(r.driver) ?? 0) + r.points);
      for (const [d, v] of total) pts.set(d, [...(pts.get(d) ?? []), { x: race.round, y: Math.round(v * 10) / 10, note: race.name.replace(" Grand Prix", " GP") }]);
    }
    const ranked = s.driverStandings.length ? s.driverStandings.map((d) => d.driver) : [...total].sort((a, b) => b[1] - a[1]).map(([d]) => d);
    return ranked.slice(0, 10).map((id, i) => {
      const d = name.get(id);
      return { id, label: d?.code ?? d?.last ?? id, colour: HIGHLIGHT[i] ?? "var(--line-muted)", points: pts.get(id) ?? [] };
    }).reverse(); // draw leaders last so they sit on top
  }, [season.data, name]);

  if (index.error) return <p className="empty">{index.error}</p>;
  if (!year) return <p className="empty">No seasons exported yet. Run <code>python -m pipeline history</code>.</p>;
  const s = season.data;
  const roundsRun = s?.races.filter((r) => r.results.length).length ?? 0;

  return (
    <article>
      <header className="page-head with-control">
        <div>
          <p className="kicker">{s ? `${roundsRun} of ${s.races.length} rounds run` : "Season"}</p>
          <h1>{year} World Championship</h1>
        </div>
        <div className="season-nav">
          {seasons.includes(year - 1) && <Link className="step" to={`/season/${year - 1}`} aria-label={`${year - 1} season`}>‹ {year - 1}</Link>}
          <SearchBox label="Go to season" value={String(year)} placeholder="Type a year"
            search={(q) => {
              const all = [...seasons].reverse().map((y) => ({ key: String(y), label: `${y} season` }));
              const t = q.trim();
              return (t ? all.filter((o) => o.key.includes(t)) : all).slice(0, 12);
            }}
            onPick={(o) => nav(`/season/${o.key}`)} />
          {seasons.includes(year + 1) && <Link className="step" to={`/season/${year + 1}`} aria-label={`${year + 1} season`}>{year + 1} ›</Link>}
        </div>
      </header>
      {season.error && <p className="empty">{season.error}</p>}
      {s && (
        <>
          <section>
            <h2>Title fight</h2>
            <LineChart series={series} xLabel={(x) => `Round ${x}`} yLabel="Points" height={320} />
            <p className="chart-note">
              Points added up race by race for the top ten.{year < 1991 ? " Before 1991 only a driver's best results counted, so these totals can be higher than the official ones." : ""}
            </p>
          </section>
          <section className="split">
            <div>
              <h2>Drivers</h2>
              <table className="results">
                <thead><tr><th>Pos</th><th>Driver</th><th>Wins</th><th>Points</th></tr></thead>
                <tbody>
                  {s.driverStandings.map((d) => {
                    const p = name.get(d.driver);
                    return (
                      <tr key={d.driver}>
                        <td className="num">{d.pos}</td>
                        <td><strong>{p ? `${p.first} ${p.last}` : d.driver}</strong> <span className="muted">{d.teams.map((t) => teamName.get(t) ?? t).join(", ")}</span></td>
                        <td className="num">{d.wins}</td>
                        <td className="num">{d.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <h2>Constructors</h2>
              {s.constructorStandings.length ? (
                <table className="results">
                  <thead><tr><th>Pos</th><th>Team</th><th>Wins</th><th>Points</th></tr></thead>
                  <tbody>
                    {s.constructorStandings.map((c) => (
                      <tr key={c.team}><td className="num">{c.pos}</td><td>{teamName.get(c.team) ?? c.team}</td><td className="num">{c.wins}</td><td className="num">{c.points}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="muted">The constructors' championship started in 1958.</p>}
              <h2>Races</h2>
              <ul className="race-list">
                {s.races.map((r) => {
                  const w = r.results[0] && name.get(r.results[0].driver);
                  return <li key={r.round}><span>{r.name.replace(" Grand Prix", "")}</span><span className="muted">{w ? `${w.first[0]}. ${w.last}` : "Not run yet"}</span></li>;
                })}
              </ul>
            </div>
          </section>
        </>
      )}
      <p className="back"><Link to="/drivers">Compare two drivers across their careers</Link></p>
    </article>
  );
}
