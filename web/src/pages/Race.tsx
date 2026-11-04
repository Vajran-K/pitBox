import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { load, teamColour, useData, type Driver, type Meta, type Telemetry, type Timing } from "../data";
import { eventName, lapTime, localDate, properName, raceTime } from "../lib/format";
import { fastestLaps, lapTrace, type LapTrace } from "../lib/race";
import LapChart from "../charts/LapChart";
import Strategy from "../charts/Strategy";
import TelemetryCompare from "../charts/TelemetryCompare";
import TrackDominance from "../charts/TrackDominance";
import AskPanel from "../components/AskPanel";
import SearchBox, { type Option } from "../components/SearchBox";
import { rank } from "../lib/search";

export default function Race() {
  const { key } = useParams();
  const meta = useData<Meta>(`sessions/${key}/meta.json`);
  const timing = useData<Timing>(`sessions/${key}/timing.json`);

  if (meta.error || timing.error) return <p className="empty">{meta.error ?? timing.error}</p>;
  if (!meta.data || !timing.data) return <p className="empty">Loading race…</p>;
  if (meta.data.type === "Qualifying") return <QualiView meta={meta.data} />;
  return <RaceView meta={meta.data} timing={timing.data} />;
}

/** Qualifying sessions: the classification with each part's time, and the way into the replay. */
function QualiView({ meta }: { meta: Meta }) {
  const drivers = new Map(meta.drivers.map((d) => [d.number, d]));
  const t = (v: unknown, i: number) => (Array.isArray(v) && typeof v[i] === "number" ? lapTime(v[i]) : "");
  return (
    <article className="race">
      <header className="page-head">
        <p className="kicker">{meta.circuit}, {localDate(meta.start, meta.gmtOffset)}</p>
        <h1>{eventName(meta.country, meta.type, meta.name, meta.meetingName)} {meta.year}</h1>
        <div className="buttons">
          <Link className="button" to={`/race/${meta.key}/replay`}>Watch the replay</Link>
          <Link className="button secondary" to={`/rooms?race=${meta.key}`}>Watch with friends</Link>
        </div>
      </header>
      <section>
        <h2>Classification</h2>
        <div className="panel table-scroll">
          <table className="results">
            <thead><tr><th>Pos</th><th>Driver</th><th className="num">{/sprint/i.test(meta.name) ? "SQ1" : "Q1"}</th><th className="num">{/sprint/i.test(meta.name) ? "SQ2" : "Q2"}</th><th className="num">{/sprint/i.test(meta.name) ? "SQ3" : "Q3"}</th></tr></thead>
            <tbody>
              {meta.result.map((r) => {
                const d = drivers.get(r.driver_number);
                return (
                  <tr key={r.driver_number}>
                    <td className="num">{r.position ?? "–"}</td>
                    <td><span className="team-bar" style={{ background: teamColour(d) }} /><strong>{d?.code}</strong> {d ? properName(d.name) : r.driver_number} <span className="muted">{d?.team}</span></td>
                    {[0, 1, 2].map((i) => <td key={i} className="num">{t(r.duration, i)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}

function RaceView({ meta, timing }: { meta: Meta; timing: Timing }) {
  const drivers = new Map(meta.drivers.map((d) => [d.number, d]));
  const order = meta.result.map((r) => drivers.get(r.driver_number)).filter(Boolean) as Driver[];
  const totalLaps = Math.max(0, ...timing.laps.map((l) => l.lap));
  const best = fastestLaps(timing.laps);
  const overallBest = [...best.values()].sort((x, y) => (x.dur ?? 1e9) - (y.dur ?? 1e9))[0];
  const isRace = meta.type === "Race";

  return (
    <article className="race">
      <header className="page-head">
        <p className="kicker">{meta.circuit}, {localDate(meta.start, meta.gmtOffset)}</p>
        <h1>{eventName(meta.country, meta.type, meta.name, meta.meetingName)} {meta.year}</h1>
        {isRace && (
          <div className="buttons">
            <Link className="button" to={`/race/${meta.key}/replay`}>Watch the replay</Link>
            <Link className="button secondary" to={`/rooms?race=${meta.key}`}>Watch with friends</Link>
          </div>
        )}
      </header>

      {isRace && (
        <section>
          <h2>Lap chart</h2>
          <div className="panel"><LapChart meta={meta} timing={timing} /></div>
        </section>
      )}

      <section className="race-grid">
        <div>
          <h2>Classification</h2>
          <table className="results">
            <thead>
              <tr><th>Pos</th><th>Driver</th>{isRace && <th title="Places gained from the grid">Grid</th>}<th>Fastest lap</th><th>Time or gap</th></tr>
            </thead>
            <tbody>
              {meta.result.map((r) => {
                const d = drivers.get(r.driver_number);
                const grid = meta.grid.find((g) => g.driver_number === r.driver_number)?.position;
                const gained = grid && r.position ? grid - r.position : 0;
                const fl = best.get(r.driver_number);
                const status = r.dsq ? "DSQ" : r.dns ? "DNS" : r.dnf ? "DNF" : null;
                return (
                  <tr key={r.driver_number}>
                    <td className="num">{status ?? r.position}</td>
                    <td><span className="team-bar" style={{ background: teamColour(d) }} /><strong>{d?.code}</strong> <span className="muted">{d?.team}</span></td>
                    {isRace && (
                      <td className="num">
                        {grid ?? "–"}
                        {gained !== 0 && <span className={gained > 0 ? "up" : "down"}>{gained > 0 ? ` ▲${gained}` : ` ▼${-gained}`}</span>}
                      </td>
                    )}
                    <td className={`num${fl && fl === overallBest ? " fastest" : ""}`}>{lapTime(fl?.dur)}</td>
                    <td className="num">
                      {r.position === 1 && typeof r.duration === "number" ? raceTime(r.duration)
                        : typeof r.gap_to_leader === "number" ? `+${r.gap_to_leader.toFixed(3)}`
                        : r.gap_to_leader ?? (status ? `${r.number_of_laps ?? 0} laps` : "–")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="chart-note"><span className="fastest">Purple</span> is the fastest lap of the session, as on the timing screens.</p>
        </div>
        {timing.stints.length > 0 && (
          <div>
            <h2>Tyre strategy</h2>
            <Strategy order={order} stints={timing.stints} totalLaps={totalLaps} />
          </div>
        )}
      </section>

      <AskPanel meta={meta} timing={timing} />

      <Compare meta={meta} timing={timing} order={order} />

      {timing.radio.length > 0 && <Radio timing={timing} drivers={drivers} />}
      <p className="back"><Link to="/">All races</Link></p>
    </article>
  );
}

function Compare({ meta, timing, order }: { meta: Meta; timing: Timing; order: Driver[] }) {
  const [a, setA] = useState(order[0]?.number);
  const [b, setB] = useState(order[1]?.number);
  const [traces, setTraces] = useState<{ a: LapTrace; b: LapTrace } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const best = useMemo(() => fastestLaps(timing.laps), [timing]);
  const da = meta.drivers.find((d) => d.number === a), db = meta.drivers.find((d) => d.number === b);

  useEffect(() => {
    if (a == null || b == null) return;
    let live = true;
    setTraces(null); setError(null);
    Promise.all([load<Telemetry>(`sessions/${meta.key}/telemetry/${a}.json.gz`), load<Telemetry>(`sessions/${meta.key}/telemetry/${b}.json.gz`)])
      .then(([ta, tb]) => {
        const la = best.get(a), lb = best.get(b);
        const ra = la && lapTrace(ta, la), rb = lb && lapTrace(tb, lb);
        if (!live) return;
        if (!ra || !rb) setError("One of these drivers has no complete timed lap with telemetry. Pick someone else.");
        else setTraces({ a: ra, b: rb });
      })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [a, b, meta.key, best]);

  if (!meta.hasTelemetry) return null;
  const options: Option[] = order.map((d, i) => ({
    key: String(d.number), label: `${d.code}  ${properName(d.name)}`, detail: `P${i + 1}, ${d.team}`, swatch: teamColour(d),
  }));
  const textOf = (o: Option) => `${o.label} ${o.detail} ${o.key}`;
  const pick = (value: number | undefined, set: (n: number) => void, label: string) => {
    const d = order.find((x) => x.number === value);
    return (
      <SearchBox label={label} value={d ? `${d.code}  ${properName(d.name)}` : ""} placeholder="Code, name, team or number"
        search={(q) => (q.trim() ? rank(options, q, textOf, undefined, 22) : options)}
        onPick={(o) => set(Number(o.key))} />
    );
  };

  return (
    <section>
      <h2>Fastest laps, head to head</h2>
      <div className="pickers">
        {pick(a, setA, "Driver A")}
        {pick(b, setB, "Driver B")}
        {da && db && best.get(da.number) && best.get(db.number) && (
          <p className="muted">{da.code} {lapTime(best.get(da.number)!.dur)} on lap {best.get(da.number)!.lap}, {db.code} {lapTime(best.get(db.number)!.dur)} on lap {best.get(db.number)!.lap}</p>
        )}
      </div>
      {error && <p className="empty">{error}</p>}
      {!error && !traces && <p className="empty">Loading telemetry…</p>}
      {traces && da && db && (
        <div className="compare-grid">
          <TrackDominance a={traces.a} b={traces.b} da={da} db={db} />
          <TelemetryCompare a={traces.a} b={traces.b} da={da} db={db} />
        </div>
      )}
    </section>
  );
}

function Radio({ timing, drivers }: { timing: Timing; drivers: Map<number, Driver> }) {
  const lapAt = (t: number) => {
    const lapRows = timing.laps.filter((l) => l.t != null && l.t <= t);
    return lapRows.length ? Math.max(...lapRows.map((l) => l.lap)) : null;
  };
  return (
    <section>
      <h2>Team radio</h2>
      <ul className="radio">
        {timing.radio.map((r) => {
          const d = drivers.get(r.d);
          const lap = lapAt(r.t);
          return (
            <li key={r.url}>
              <span className="team-bar" style={{ background: teamColour(d) }} />
              <strong>{d?.code}</strong>
              <span className="muted">{lap ? `Lap ${lap}` : "Before the start"}</span>
              <audio controls preload="none" src={r.url}>Your browser can't play this clip.</audio>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
