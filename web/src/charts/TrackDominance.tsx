import { useMemo, useState } from "react";
import type { Driver } from "../data";
import { timeAtFraction, type LapTrace } from "../lib/race";
import { useWidth } from "../lib/useWidth";
import { A_COLOUR, B_COLOUR } from "./TelemetryCompare";

const SECTORS = 24;

/**
 * The circuit drawn from A's GPS trace, cut into equal-distance mini-sectors,
 * each coloured by whichever driver covered it faster. Hover a sector for the margin.
 */
export default function TrackDominance({ a, b, da, db }: { a: LapTrace; b: LapTrace; da: Driver; db: Driver }) {
  const [ref, width] = useWidth<HTMLDivElement>(400);
  const [hover, setHover] = useState<number | null>(null);

  const { segs, wins } = useMemo(() => {
    const segs = Array.from({ length: SECTORS }, (_, i) => {
      const f0 = i / SECTORS, f1 = (i + 1) / SECTORS;
      const ta = timeAtFraction(a, f1) - timeAtFraction(a, f0);
      const tb = timeAtFraction(b, f1) - timeAtFraction(b, f0);
      const pts = a.pos.filter((p) => p.f >= f0 && p.f <= f1);
      // join to the next sector so the line is continuous
      const next = a.pos.find((p) => p.f > f1);
      if (next) pts.push(next);
      return { i, pts, margin: (tb - ta) / 1000 }; // > 0: A faster
    });
    const wins = { a: segs.filter((s) => s.margin > 0).length, b: segs.filter((s) => s.margin <= 0).length };
    return { segs, wins };
  }, [a, b]);

  const xs = a.pos.map((p) => p.x), ys = a.pos.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const size = Math.min(width, 520);
  const pad = 24;
  const k = (size - pad * 2) / Math.max(maxX - minX, maxY - minY);
  const h = (maxY - minY) * k + pad * 2;
  const px = (x: number) => pad + (x - minX) * k + (size - pad * 2 - (maxX - minX) * k) / 2;
  const py = (y: number) => h - pad - (y - minY) * k; // GPS y points up; SVG y points down

  const hovered = hover != null ? segs[hover] : null;
  return (
    <div className="chart dominance" ref={ref}>
      <svg width={size} height={h} role="img"
        aria-label={`Track map: ${da.code} faster in ${wins.a} of ${SECTORS} mini-sectors, ${db.code} in ${wins.b}`}
        onMouseLeave={() => setHover(null)}>
        <polyline points={a.pos.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")} className="track-base" />
        {segs.map((s) => (
          <polyline key={s.i} points={s.pts.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")}
            className={`sector${hover === s.i ? " on" : ""}`}
            stroke={s.margin > 0 ? A_COLOUR : B_COLOUR}
            onMouseEnter={() => setHover(s.i)} />
        ))}
        {a.pos[0] && <circle cx={px(a.pos[0].x)} cy={py(a.pos[0].y)} r={5} className="start-dot" />}
      </svg>
      <div className="dominance-side">
        <p className="dominance-score">
          <span><span className="key" style={{ background: A_COLOUR }} />{da.code} {wins.a}</span>
          <span><span className="key" style={{ background: B_COLOUR }} />{db.code} {wins.b}</span>
        </p>
        <p className="chart-note">
          {hovered
            ? `Mini-sector ${hovered.i + 1}: ${hovered.margin > 0 ? da.code : db.code} faster by ${Math.abs(hovered.margin).toFixed(3)} s`
            : `Mini-sectors won on each driver's fastest lap. The dot marks the start line. Hover a sector for the margin.`}
        </p>
      </div>
    </div>
  );
}
