import { useState } from "react";
import { scaleLinear } from "d3-scale";
import type { Driver, Stint } from "../data";
import { stintsByDriver } from "../lib/race";
import { useWidth } from "../lib/useWidth";
import { Tooltip, type Tip } from "./Tooltip";

// Pirelli's compound colours are the sport's own convention; the letter inside
// each bar (and the tooltip) carries the compound for anyone who can't rely on colour.
const COMPOUND: Record<string, { fill: string; letter: string; ink: string }> = {
  SOFT: { fill: "#d6312b", letter: "S", ink: "#fff" },
  MEDIUM: { fill: "#f2c230", letter: "M", ink: "#1b1d22" },
  HARD: { fill: "#eceef1", letter: "H", ink: "#1b1d22" },
  INTERMEDIATE: { fill: "#3a9f43", letter: "I", ink: "#fff" },
  WET: { fill: "#1f6fb5", letter: "W", ink: "#fff" },
};
const UNKNOWN = { fill: "#9aa0ab", letter: "?", ink: "#fff" };
const name = (c: string | null) => (c ? c[0] + c.slice(1).toLowerCase() : "Unknown");

const ROW = 22;
const M = { top: 8, right: 16, bottom: 28, left: 52 };

export default function Strategy({ order, stints, totalLaps }: { order: Driver[]; stints: Stint[]; totalLaps: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const by = stintsByDriver(stints);
  const rows = order.filter((d) => by.has(d.number));
  const height = M.top + M.bottom + rows.length * ROW;
  const x = scaleLinear().domain([0, totalLaps]).range([M.left, width - M.right]);

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} role="img" aria-label="Tyre strategy: compound used on each stint, by driver">
        {x.ticks(Math.min(10, Math.floor(width / 70))).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={M.top} y2={height - M.bottom} className="grid" />
            <text x={x(t)} y={height - 8} className="axis" textAnchor="middle">{t}</text>
          </g>
        ))}
        {rows.map((d, i) => (
          <g key={d.number} transform={`translate(0, ${M.top + i * ROW})`}>
            <text x={M.left - 8} y={ROW / 2} className="code" textAnchor="end" dominantBaseline="middle">{d.code}</text>
            {by.get(d.number)!.map((s) => {
              const c = COMPOUND[s.compound ?? ""] ?? UNKNOWN;
              const x0 = x((s.from ?? 1) - 1) + 1, x1 = x(s.to ?? totalLaps) - 1;
              const w = Math.max(2, x1 - x0);
              return (
                <g key={s.n}
                  onMouseMove={(e) => {
                    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content: (
                      <><strong>{d.code}</strong> stint {s.n}<br />{name(s.compound)}, laps {s.from}–{s.to}
                        <br />{s.age ? `Used, ${s.age} laps old at fitting` : "New set"}</>
                    ) });
                  }}>
                  <rect x={x0} y={3} width={w} height={ROW - 6} rx={4} fill={c.fill} className={s.compound === "HARD" ? "stint stint-hard" : "stint"} />
                  {w > 16 && <text x={x0 + 7} y={ROW / 2} fill={c.ink} className="stint-letter" dominantBaseline="middle">{c.letter}</text>}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} width={width} />
      <ul className="legend">
        {["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].filter((k) => stints.some((s) => s.compound === k)).map((k) => (
          <li key={k}><span className="swatch" style={{ background: COMPOUND[k].fill }} />{COMPOUND[k].letter} {name(k)}</li>
        ))}
      </ul>
    </div>
  );
}
