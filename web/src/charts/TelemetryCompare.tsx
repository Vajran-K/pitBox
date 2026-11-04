import { useState } from "react";
import { scaleLinear } from "d3-scale";
import { line, curveLinear, curveStepAfter } from "d3-shape";
import type { Driver } from "../data";
import { interp, type LapTrace } from "../lib/race";
import { useWidth } from "../lib/useWidth";

export const A_COLOUR = "var(--series-1)";
export const B_COLOUR = "var(--series-2)";

type Panel = { key: "speed" | "throttle" | "brake" | "delta"; label: string; height: number };
const PANELS: Panel[] = [
  { key: "speed", label: "Speed (km/h)", height: 170 },
  { key: "delta", label: "Gap (s)", height: 90 },
  { key: "throttle", label: "Throttle (%)", height: 70 },
  { key: "brake", label: "Brake", height: 34 },
];
const M = { left: 52, right: 16 };
const GAP = 22;

/**
 * Speed, throttle and brake for two laps against distance, sharing one x axis
 * and one crosshair. "Gap" is how far B is behind A at each point of the lap.
 */
export default function TelemetryCompare({ a, b, da, db }: { a: LapTrace; b: LapTrace; da: Driver; db: Driver }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null); // distance in metres along A's lap
  const total = Math.max(a.total, b.total);
  const x = scaleLinear().domain([0, total]).range([M.left, width - M.right]);

  // Gap: time difference at the same fraction of lap distance (B minus A, seconds).
  const deltaD: number[] = [], delta: number[] = [];
  for (let i = 0; i < a.dist.length; i += 2) {
    const f = a.dist[i] / a.total;
    deltaD.push(a.dist[i]);
    delta.push((interp(b.dist, b.t, f * b.total) - a.t[i]) / 1000);
  }
  const dMax = Math.max(0.1, ...delta.map(Math.abs));

  let top = 8;
  const panels = PANELS.map((p) => {
    const y0 = top;
    top += p.height + GAP;
    const domain: [number, number] =
      p.key === "speed" ? [Math.max(0, Math.min(...a.speed, ...b.speed) - 10), Math.max(...a.speed, ...b.speed) + 10]
      : p.key === "delta" ? [-dMax, dMax] : [0, 100];
    return { ...p, y0, y: scaleLinear().domain(domain).range([y0 + p.height, y0]).nice() };
  });
  const height = top + 10;

  const series = (tr: LapTrace, key: "speed" | "throttle" | "brake", y: (v: number) => number) =>
    line<number>().x((_, i) => x(tr.dist[i])).y((v) => y(v)).curve(key === "brake" ? curveStepAfter : curveLinear)(tr[key]) ?? "";

  const at = (tr: LapTrace, key: "speed" | "throttle", d: number) => Math.round(interp(tr.dist, tr[key], (d / a.total) * tr.total));

  return (
    <div className="chart telemetry" ref={ref}>
      <svg width={width} height={height}
        role="img" aria-label={`Telemetry comparison of ${da.code} and ${db.code} fastest laps`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const d = x.invert(e.clientX - r.left);
          setHover(d >= 0 && d <= total ? d : null);
        }}
        onMouseLeave={() => setHover(null)}>
        {panels.map((p) => (
          <g key={p.key}>
            <text x={M.left} y={p.y0 - 6} className="panel-label">{p.label}</text>
            {p.key !== "brake" && p.y.ticks(3).map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={p.y(t)} y2={p.y(t)} className={p.key === "delta" && t === 0 ? "zero" : "grid"} />
                <text x={M.left - 6} y={p.y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
                  {p.key === "delta" && t > 0 ? `+${t}` : t}
                </text>
              </g>
            ))}
            {p.key === "delta" ? (
              <path className="trace" stroke={B_COLOUR}
                d={line<number>().x((_, i) => x(deltaD[i])).y((v) => p.y(v))(delta) ?? ""} />
            ) : (
              <>
                <path className="trace" stroke={A_COLOUR} d={series(a, p.key, p.y)} />
                <path className="trace" stroke={B_COLOUR} d={series(b, p.key, p.y)} />
              </>
            )}
          </g>
        ))}
        {x.ticks(8).map((t) => (
          <text key={t} x={x(t)} y={height - 2} className="axis" textAnchor="middle">{t === 0 ? "0 m" : `${t / 1000} km`}</text>
        ))}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={height - 14} className="crosshair" />
        )}
      </svg>
      {hover != null && (
        <div className="readout" style={{ left: Math.min(Math.max(x(hover) + 12, 0), width - 220) }}>
          <div>{(hover / 1000).toFixed(2)} km into the lap</div>
          <div><span className="key" style={{ background: A_COLOUR }} />{da.code} {at(a, "speed", hover)} km/h, throttle {at(a, "throttle", hover)}%</div>
          <div><span className="key" style={{ background: B_COLOUR }} />{db.code} {at(b, "speed", hover)} km/h, throttle {at(b, "throttle", hover)}%</div>
          <div>
            {(() => {
              const g = (interp(b.dist, b.t, (hover / a.total) * b.total) - interp(a.dist, a.t, hover)) / 1000;
              return g >= 0 ? `${db.code} ${g.toFixed(3)} s behind` : `${db.code} ${(-g).toFixed(3)} s ahead`;
            })()}
          </div>
        </div>
      )}
      <p className="chart-note">Gap above zero means {db.code} is behind {da.code} at that point of the lap.</p>
    </div>
  );
}
