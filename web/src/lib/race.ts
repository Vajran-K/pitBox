import type { Lap, Meta, RaceControl, Stint, Telemetry } from "../data";

/** Running order at the end of every lap; lap 0 is the starting grid. */
export function lapPositions(meta: Meta, laps: Lap[]): Map<number, Map<number, number>> {
  const byLap = new Map<number, { d: number; end: number }[]>();
  for (const l of laps) {
    if (l.t == null || l.dur == null) continue;
    const row = byLap.get(l.lap) ?? [];
    row.push({ d: l.d, end: l.t + l.dur * 1000 });
    byLap.set(l.lap, row);
  }
  const out = new Map<number, Map<number, number>>();
  out.set(0, new Map(meta.grid.map((g) => [g.driver_number, g.position])));
  for (const [lap, rows] of [...byLap].sort((a, b) => a[0] - b[0])) {
    rows.sort((a, b) => a.end - b.end);
    out.set(lap, new Map(rows.map((r, i) => [r.d, i + 1])));
  }
  return out;
}

export type Neutralised = { kind: "SC" | "VSC" | "Red"; from: number; to: number };

/** Safety car, VSC and red-flag periods as lap ranges, from race control messages. */
export function neutralisedLaps(rc: RaceControl[], lastLap: number): Neutralised[] {
  const out: Neutralised[] = [];
  let open: { kind: Neutralised["kind"]; from: number } | null = null;
  const close = (lap: number) => {
    if (open) out.push({ ...open, to: Math.max(open.from, lap) });
    open = null;
  };
  for (const m of rc) {
    const msg = m.msg.toUpperCase();
    const lap = m.lap ?? 0;
    if (msg.includes("VIRTUAL SAFETY CAR DEPLOYED")) { close(lap); open = { kind: "VSC", from: lap }; }
    else if (msg.includes("SAFETY CAR DEPLOYED")) { close(lap); open = { kind: "SC", from: lap }; }
    else if (m.flag === "RED") { close(lap); open = { kind: "Red", from: lap }; }
    else if (open && (msg.includes("SAFETY CAR IN THIS LAP") || msg.includes("VIRTUAL SAFETY CAR ENDING") || (open.kind === "Red" && m.flag === "GREEN"))) close(lap);
  }
  close(lastLap);
  return out;
}

export function fastestLaps(laps: Lap[]): Map<number, Lap> {
  const best = new Map<number, Lap>();
  for (const l of laps) {
    if (l.dur == null || l.pitOut) continue;
    const cur = best.get(l.d);
    if (!cur || (cur.dur ?? Infinity) > l.dur) best.set(l.d, l);
  }
  return best;
}

export function stintsByDriver(stints: Stint[]): Map<number, Stint[]> {
  const m = new Map<number, Stint[]>();
  for (const s of stints) m.set(s.d, [...(m.get(s.d) ?? []), s].sort((a, b) => a.n - b.n));
  return m;
}

export type LapTrace = {
  t: number[]; dist: number[]; speed: number[]; throttle: number[]; brake: number[]; gear: number[];
  total: number; pos: { x: number; y: number; f: number }[];
};

/** Slice one lap out of a driver's telemetry, adding distance (m) from integrated speed. */
export function lapTrace(tel: Telemetry, lap: Lap): LapTrace | null {
  if (lap.t == null || lap.dur == null) return null;
  const start = lap.t, end = lap.t + lap.dur * 1000;
  const c = tel.car;
  const idx: number[] = [];
  for (let i = 0; i < c.t.length; i++) if (c.t[i] >= start && c.t[i] <= end) idx.push(i);
  if (idx.length < 20) return null;
  const t: number[] = [], dist: number[] = [], speed: number[] = [], throttle: number[] = [], brake: number[] = [], gear: number[] = [];
  let d = 0, prevT = start, prevV = c.speed[idx[0]] ?? 0;
  for (const i of idx) {
    const v = c.speed[i] ?? prevV;
    d += (((prevV + v) / 2) / 3.6) * ((c.t[i] - prevT) / 1000);
    prevT = c.t[i]; prevV = v;
    t.push(c.t[i] - start); dist.push(d); speed.push(v);
    throttle.push(Math.min(100, c.throttle[i] ?? 0)); brake.push(c.brake[i] ? 100 : 0); gear.push(c.gear[i] ?? 0);
  }
  const total = d || 1;
  const pos: LapTrace["pos"] = [];
  for (let i = 0; i < tel.pos.t.length; i++) {
    const pt = tel.pos.t[i];
    if (pt < start || pt > end || (!tel.pos.x[i] && !tel.pos.y[i])) continue;
    pos.push({ x: tel.pos.x[i], y: tel.pos.y[i], f: interp(t, dist, pt - start) / total });
  }
  return { t, dist, speed, throttle, brake, gear, total, pos };
}

/** Linear interpolation of ys at x (xs ascending). */
export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  const k = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + k * (ys[hi] - ys[lo]);
}

/** Time (ms into the lap) when a trace reached a fraction of its lap distance. */
export function timeAtFraction(tr: LapTrace, f: number): number {
  return interp(tr.dist, tr.t, f * tr.total);
}
