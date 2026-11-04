import { useState } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useWidth } from "../lib/useWidth";
import { Tooltip, type Tip } from "./Tooltip";

export type Series = { id: string; label: string; colour: string; points: { x: number; y: number; note?: string }[] };

const M = { top: 16, right: 64, bottom: 30, left: 48 };

/**
 * Simple multi-line chart with direct end labels and a crosshair tooltip.
 * Series beyond the coloured few should be passed with a muted colour; hovering
 * any series brings it forward.
 */
export default function LineChart({ series, height = 300, xLabel, yLabel, reverseY = false, fitY = false, zeroLine = false }: {
  series: Series[]; height?: number; xLabel: (x: number) => string; yLabel: string;
  /** positions: 1 at the top */ reverseY?: boolean;
  /** lap times: fit the axis to the data instead of starting at zero */ fitY?: boolean;
  /** gaps: values can be negative; draw the zero line */ zeroLine?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <p className="empty">No data to chart.</p>;
  const longest = Math.max(0, ...series.map((s) => s.label.length));
  const right = Math.max(M.right, longest * 6.6 + 14);
  const x = scaleLinear().domain([Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))]).range([M.left, width - right]);
  const ys = all.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo) * 0.06 || 1;
  const domain: [number, number] = reverseY ? [hi, Math.max(1, lo)]
    : fitY ? [lo - pad, hi + pad]
    : zeroLine ? [Math.min(0, lo), Math.max(0, hi)] : [0, hi];
  const y = scaleLinear().domain(domain).nice().range(reverseY ? [height - M.bottom, M.top] : [height - M.bottom, M.top]);
  const path = line<{ x: number; y: number }>().x((p) => x(p.x)).y((p) => y(p.y));
  const ordered = [...series].sort((a, b) => (a.id === focus ? 1 : b.id === focus ? -1 : 0));

  // keep end labels from stacking on top of each other
  const ends = series.filter((s) => s.points.length).map((s) => ({ id: s.id, label: s.label, y: y(s.points[s.points.length - 1].y), x: x(s.points[s.points.length - 1].x) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;

  return (
    <div className="chart" ref={ref}
      onMouseLeave={() => { setTip(null); setFocus(null); }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const xv = Math.round(x.invert(e.clientX - r.left));
        const rows = series.map((s) => ({ s, p: s.points.find((p) => p.x === xv) })).filter((r) => r.p);
        if (!rows.length) return setTip(null);
        rows.sort((a, b) => b.p!.y - a.p!.y);
        setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content: (
          <><strong>{xLabel(xv)}</strong>{rows.slice(0, 8).map(({ s, p }) => (
            <div key={s.id}><span className="key" style={{ background: s.colour }} />{s.label} {p!.y}{p!.note ? `, ${p!.note}` : ""}</div>
          ))}</>
        ) });
      }}>
      <svg width={width} height={height} role="img" aria-label={`${yLabel} by ${series.map((s) => s.label).join(", ")}`}>
        {y.ticks(5).filter((t) => !reverseY || Number.isInteger(t)).map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - right} y1={y(t)} y2={y(t)} className={zeroLine && t === 0 ? "zero" : "grid"} />
            <text x={M.left - 6} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{t}</text>
          </g>
        ))}
        {x.ticks(Math.min(10, Math.floor(width / 80))).filter(Number.isInteger).map((t) => (
          <text key={t} x={x(t)} y={height - 8} className="axis" textAnchor="middle">{xLabel(t)}</text>
        ))}
        <text x={M.left} y={10} className="panel-label">{yLabel}</text>
        {ordered.map((s) => (
          <g key={s.id} className={focus && focus !== s.id ? "dim" : undefined} onMouseEnter={() => setFocus(s.id)}>
            <path d={path(s.points) ?? ""} className="hit" />
            <path d={path(s.points) ?? ""} className="trace" stroke={s.colour} strokeWidth={focus === s.id ? 3 : 2} />
          </g>
        ))}
        {ends.map((e) => (
          <text key={e.id} x={e.x + 6} y={e.y} className={`code${focus && focus !== e.id ? " dim" : ""}`} dominantBaseline="middle">{e.label}</text>
        ))}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}
