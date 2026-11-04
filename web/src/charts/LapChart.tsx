import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { teamColour, type Meta, type Timing } from "../data";
import { lapPositions, neutralisedLaps } from "../lib/race";
import { useWidth } from "../lib/useWidth";
import { Tooltip, type Tip } from "./Tooltip";

const ROW = 20;
const M = { top: 28, right: 52, bottom: 30, left: 52 };

/**
 * Lap chart: running order after every lap. Team colour identifies the car,
 * the second driver of each team is dashed, and codes label both ends,
 * so identity never depends on colour alone. Hover or tap a line to isolate it.
 */
export default function LapChart({ meta, timing, compact = false }: { meta: Meta; timing: Timing; compact?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [focus, setFocus] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const active = pinned ?? focus;

  const { series, lastLap, n, neutral, dashed } = useMemo(() => {
    const byLap = lapPositions(meta, timing.laps);
    const lastLap = Math.max(...byLap.keys());
    const series = meta.drivers.map((d) => ({
      driver: d,
      points: [...byLap].filter(([, m]) => m.has(d.number)).map(([lap, m]) => ({ lap, p: m.get(d.number)! })),
    })).filter((s) => s.points.length > 1);
    const seen = new Set<string>();
    const dashed = new Set<number>();
    for (const d of [...meta.drivers].sort((a, b) => a.number - b.number)) {
      if (seen.has(d.team)) dashed.add(d.number); else seen.add(d.team);
    }
    return { series, lastLap, n: meta.drivers.length, neutral: neutralisedLaps(timing.raceControl, lastLap), dashed };
  }, [meta, timing]);

  const rowH = compact ? 16 : ROW;
  const height = M.top + M.bottom + rowH * (n - 1);
  const x = scaleLinear().domain([0, lastLap]).range([M.left, width - M.right]);
  const y = scaleLinear().domain([1, n]).range([M.top, M.top + rowH * (n - 1)]);
  const path = line<{ lap: number; p: number }>().x((d) => x(d.lap)).y((d) => y(d.p));
  const ticks = x.ticks(Math.min(10, Math.floor(width / 70))).filter(Number.isInteger);

  return (
    <div className="chart" ref={ref} onMouseLeave={() => { setFocus(null); setTip(null); }}>
      <svg width={width} height={height} role="img" aria-label={`Lap chart: running order on each of ${lastLap} laps`}>
        {neutral.map((s, i) => (
          <g key={i}>
            <rect x={x(Math.max(0, s.from - 0.5))} y={M.top - 14} width={Math.max(2, x(s.to + 0.5) - x(Math.max(0, s.from - 0.5)))}
              height={height - M.top - M.bottom + 22} className={`band band-${s.kind}`} />
            <text x={x(s.from - 0.5) + 3} y={M.top - 18} className="band-label">{s.kind === "Red" ? "Red flag" : s.kind}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={M.top - 6} y2={height - M.bottom + 6} className="grid" />
            <text x={x(t)} y={height - 8} className="axis" textAnchor="middle">{t === 0 ? "Grid" : t}</text>
          </g>
        ))}
        {series.map(({ driver, points }) => {
          const dim = active != null && active !== driver.number;
          const first = points[0], last = points[points.length - 1];
          const colour = teamColour(driver);
          return (
            <g key={driver.number} className={dim ? "dim" : undefined}
              onMouseEnter={() => setFocus(driver.number)}
              onClick={() => setPinned(pinned === driver.number ? null : driver.number)}
              onMouseMove={(e) => {
                const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                const lap = Math.round(x.invert(e.clientX - r.left));
                const pt = points.find((p) => p.lap === lap) ?? last;
                setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content: (
                  <><strong>{driver.code}</strong> {driver.name}<br />{pt.lap === 0 ? "Grid" : `Lap ${pt.lap}`}: P{pt.p}</>
                ) });
              }}>
              <path d={path(points) ?? ""} className="hit" />
              <path d={path(points) ?? ""} className="lap-line" stroke={colour}
                strokeDasharray={dashed.has(driver.number) ? "5 3" : undefined}
                strokeWidth={active === driver.number ? 3 : 2} />
              <text x={M.left - 8} y={y(first.p)} className="code" textAnchor="end" dominantBaseline="middle">{driver.code}</text>
              <text x={x(last.lap) + 8} y={y(last.p)} className="code" dominantBaseline="middle">
                {driver.code}{last.lap < lastLap ? " ✕" : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
      <p className="chart-note">
        Position at the end of each lap. Second team cars are dashed; ✕ marks a car that stopped before the flag.
        {pinned != null ? " Tap the line again to show everyone." : " Tap a line to keep it highlighted."}
      </p>
    </div>
  );
}
