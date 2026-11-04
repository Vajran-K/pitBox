import { useMemo } from "react";
import SearchBox from "../components/SearchBox";
import { rank } from "../lib/search";
import { useSearchParams } from "react-router-dom";
import { useData, type Career, type DriverRace, type HistDriver, type Team } from "../data";
import LineChart from "../charts/LineChart";
import { A_COLOUR, B_COLOUR } from "../charts/TelemetryCompare";

const full = (d?: HistDriver) => (d ? `${d.first} ${d.last}` : "");

export default function Drivers() {
  const [params, setParams] = useSearchParams();
  const a = params.get("a") ?? "hamilton";
  const b = params.get("b") ?? "max_verstappen";
  const drivers = useData<HistDriver[]>("history/drivers.json");
  const careers = useData<Record<string, Career>>("history/careers.json");
  const teams = useData<Team[]>("history/constructors.json");
  const ra = useData<DriverRace[]>(`history/drivers/${a}.json`);
  const rb = useData<DriverRace[]>(`history/drivers/${b}.json`);

  const byId = useMemo(() => new Map((drivers.data ?? []).map((d) => [d.id, d])), [drivers.data]);
  const teamName = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t.name])), [teams.data]);
  const da = byId.get(a), db = byId.get(b);
  const ca = careers.data?.[a], cb = careers.data?.[b];

  const set = (key: "a" | "b", id: string) => { const p = new URLSearchParams(params); p.set(key, id); setParams(p); };

  if (drivers.error || careers.error) return <p className="empty">{drivers.error ?? careers.error}</p>;

  return (
    <article>
      <header className="page-head">
        <p className="kicker">Careers, 1950 to today</p>
        <h1>{da && db ? `${da.last} and ${db.last}` : "Compare two drivers"}</h1>
      </header>
      <div className="pickers">
        <DriverSearch label="Driver A" value={a} drivers={drivers.data ?? []} careers={careers.data} onPick={(id) => set("a", id)} />
        <DriverSearch label="Driver B" value={b} drivers={drivers.data ?? []} careers={careers.data} onPick={(id) => set("b", id)} />
      </div>

      {ca && cb && da && db && (
        <>
          <section className="tale">
            <div className="tale-head">
              <span><span className="key" style={{ background: A_COLOUR }} />{full(da)}</span>
              <span><span className="key" style={{ background: B_COLOUR }} />{full(db)}</span>
            </div>
            {[
              ["Championships", ca.titles, cb.titles],
              ["Wins", ca.wins, cb.wins],
              ["Podiums", ca.podiums, cb.podiums],
              ["Started from pole", ca.poles, cb.poles],
              ["Fastest laps", ca.fastestLaps, cb.fastestLaps],
              ["Race starts", ca.starts, cb.starts],
              ["Seasons", ca.seasons.length, cb.seasons.length],
            ].filter(([label, x, y]) => label !== "Fastest laps" || (x as number) + (y as number) > 0).map(([label, x, y]) => <StatRow key={label as string} label={label as string} a={x as number} b={y as number} />)}
            <StatRow label="Win rate" a={pct(ca.wins, ca.starts)} b={pct(cb.wins, cb.starts)} suffix="%" />
            <p className="chart-note">
              Teams: {da.last}, {ca.teams.map((t) => teamName.get(t) ?? t).join(", ")}. {db.last}, {cb.teams.map((t) => teamName.get(t) ?? t).join(", ")}.
              {" "}Points systems changed many times, so career points aren't compared here. Fastest laps are only on record from 2004.
            </p>
          </section>

          {ra.data && rb.data && (
            <>
              <section>
                <h2>Wins as their careers went on</h2>
                <LineChart
                  series={[
                    { id: a, label: da.code ?? da.last, colour: A_COLOUR, points: cumulativeWins(ra.data) },
                    { id: b, label: db.code ?? db.last, colour: B_COLOUR, points: cumulativeWins(rb.data) },
                  ]}
                  xLabel={(x) => `Start ${x}`} yLabel="Wins" height={280} />
                <p className="chart-note">Lined up by race start, so a long career and a short one can be compared fairly.</p>
              </section>
              <HeadToHead ra={ra.data} rb={rb.data} da={da} db={db} />
            </>
          )}
        </>
      )}
    </article>
  );
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function cumulativeWins(races: DriverRace[]) {
  let w = 0;
  return races.map((r, i) => {
    if (r.pos === 1) w++;
    return { x: i + 1, y: w, note: `${r.year} ${r.race.replace(" Grand Prix", " GP")}` };
  });
}

function StatRow({ label, a, b, suffix = "" }: { label: string; a: number; b: number; suffix?: string }) {
  const max = Math.max(a, b, 1);
  return (
    <div className="stat-row">
      <span className={`stat-val${a > b ? " lead" : ""}`}>{a}{suffix}</span>
      <div className="stat-bar left"><i style={{ width: `${(a / max) * 100}%`, background: A_COLOUR }} /></div>
      <span className="stat-label">{label}</span>
      <div className="stat-bar"><i style={{ width: `${(b / max) * 100}%`, background: B_COLOUR }} /></div>
      <span className={`stat-val${b > a ? " lead" : ""}`}>{b}{suffix}</span>
    </div>
  );
}

function HeadToHead({ ra, rb, da, db }: { ra: DriverRace[]; rb: DriverRace[]; da: HistDriver; db: HistDriver }) {
  const bIdx = new Map(rb.map((r) => [`${r.year}-${r.round}`, r]));
  const shared = ra.map((r) => ({ a: r, b: bIdx.get(`${r.year}-${r.round}`) })).filter((x) => x.b) as { a: DriverRace; b: DriverRace }[];
  if (!shared.length) return <section><h2>Racing each other</h2><p className="muted">{da.last} and {db.last} never started the same race.</p></section>;
  // Retired cars still get a position number; only numeric positionText means classified.
  const classified = (r: DriverRace) => /^\d+$/.test(r.posText ?? "");
  const finished = shared.filter((x) => classified(x.a) && classified(x.b));
  const aAhead = finished.filter((x) => x.a.pos! < x.b.pos!).length;
  const sameTeam = shared.filter((x) => x.a.team === x.b.team).length;
  return (
    <section>
      <h2>Racing each other</h2>
      <p className="lede">
        They started {shared.length} races together{sameTeam ? `, ${sameTeam} of them as teammates` : ""}. When both were classified,{" "}
        {da.last} finished ahead {aAhead} times and {db.last} {finished.length - aAhead} times.
      </p>
      <StatRow label="Finished ahead" a={aAhead} b={finished.length - aAhead} />
    </section>
  );
}

function DriverSearch({ label, value, drivers, careers, onPick }: {
  label: string; value: string; drivers: HistDriver[]; careers?: Record<string, Career>; onPick: (id: string) => void;
}) {
  const current = drivers.find((d) => d.id === value);
  const options = useMemo(() => drivers
    .filter((d) => careers?.[d.id]?.starts)
    .map((d) => {
      const c = careers![d.id];
      const span = c.seasons[0] === c.seasons.at(-1) ? `${c.seasons[0]}` : `${c.seasons[0]}–${c.seasons.at(-1)}`;
      return { key: d.id, label: `${d.first} ${d.last}`, detail: `${span}, ${c.wins} ${c.wins === 1 ? "win" : "wins"}`,
        text: `${d.first} ${d.last} ${d.code ?? ""} ${d.nationality ?? ""}`, starts: c.starts };
    }), [drivers, careers]);
  const famous = useMemo(() => [...options].sort((a, b) => b.starts - a.starts).slice(0, 8), [options]);
  return (
    <SearchBox label={label} value={current ? `${current.first} ${current.last}` : ""} placeholder="Any driver since 1950"
      search={(q) => (q.trim() ? rank(options, q, (o) => o.text, (a, b) => b.starts - a.starts, 10) : famous)}
      onPick={(o) => onPick(o.key)} />
  );
}
