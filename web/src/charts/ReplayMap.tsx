import { useMemo } from "react";
import { teamColour, type Driver } from "../data";
import type { CarState, RefLap } from "../lib/replay";
import { useWidth } from "../lib/useWidth";

/** Track outline from the reference GPS lap with every running car drawn on it. */
export default function ReplayMap({ refLap, cars, drivers, selected, onSelect }: {
  refLap: RefLap; cars: CarState[]; drivers: Map<number, Driver>; selected: number | null; onSelect: (d: number | null) => void;
}) {
  const [box, width] = useWidth<HTMLDivElement>(600);
  const geo = useMemo(() => {
    const xs = refLap.x, ys = refLap.y;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY };
  }, [refLap]);
  const pad = 34;
  const size = Math.max(260, width);
  const k = Math.min((size - pad * 2) / (geo.maxX - geo.minX || 1), (size * 0.75 - pad * 2) / (geo.maxY - geo.minY || 1));
  const h = (geo.maxY - geo.minY) * k + pad * 2;
  const ox = (size - (geo.maxX - geo.minX) * k) / 2;
  const px = (x: number) => ox + (x - geo.minX) * k;
  const py = (y: number) => h - pad - (y - geo.minY) * k;
  const outline = refLap.x.map((x, i) => `${px(x)},${py(refLap.y[i])}`).join(" ");
  const running = cars.filter((c) => c.status === "running" || c.status === "pit");
  // draw the selected car last so it sits on top
  const order = [...running].sort((a, b) => (a.d === selected ? 1 : b.d === selected ? -1 : 0));

  return (
    <div className="replay-map" ref={box}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} role="img" aria-label={`Track map with ${running.length} cars on track`}
        onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
        <polyline points={outline} className="track-base" />
        <polyline points={outline} className="track-line" />
        <line x1={px(refLap.x[0]) - 8} x2={px(refLap.x[0]) + 8} y1={py(refLap.y[0])} y2={py(refLap.y[0])} className="finish" />
        {order.map((c) => {
          const d = drivers.get(c.d);
          const on = selected === c.d;
          return (
            <g key={c.d} transform={`translate(${px(c.x)}, ${py(c.y)})`} className={`car${on ? " on" : ""}${c.status === "pit" ? " in-pit" : ""}`}
              onClick={() => onSelect(on ? null : c.d)}>
              <circle r={on ? 9 : 7} fill={teamColour(d)} />
              <text x={11} y={4} className="car-code">{d?.code}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
