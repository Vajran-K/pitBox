import type { Lap, Meta, Stint, Timing, Track } from "../data";
import { interp } from "./race";

/**
 * Replay model. There's no full-race GPS (too heavy to download), so each car is
 * placed on one reference GPS lap: its progress through each sector, from its own
 * sector times, is mapped onto the same fraction of the reference lap's sector.
 * Lap and sector times are exact; position within a sector is an approximation.
 */

export type RefLap = { t: number[]; x: number[]; y: number[]; sectors: [number, number, number] };

export function referenceLap(track: Track, laps: Lap[]): RefLap {
  const ref = laps.find((l) => l.d === track.driver && l.lap === track.lap);
  const dur = (track.lapDuration ?? ref?.dur ?? track.x.length / 3.7) * 1000;
  const sec = (track.sectors ?? [ref?.s1 ?? null, ref?.s2 ?? null, ref?.s3 ?? null]).map((s) => (s ? s * 1000 : null));
  const sectors: [number, number, number] = sec.every((s) => s) ? (sec as [number, number, number]) : [dur / 3, dur / 3, dur / 3];
  const total = sectors[0] + sectors[1] + sectors[2];
  // older exports have no timestamps: assume evenly spaced GPS samples
  const raw = track.t ?? track.x.map((_, i) => (i / (track.x.length - 1)) * dur);
  const scale = total / (raw[raw.length - 1] || total);
  return { t: raw.map((v) => v * scale), x: track.x, y: track.y, sectors };
}

type DLap = { lap: number; start: number; end: number; s: [number, number, number] | null };

export type CarState = {
  d: number;
  status: "running" | "pit" | "finished" | "out" | "waiting";
  lap: number;          // lap currently being driven (or last completed when finished/out)
  completed: number;    // laps completed
  progress: number;     // completed + fraction of current lap, for ordering
  x: number; y: number;
  lineTime: number | null; // when it last crossed the line (ms)
  point: number;           // last timing point passed: 3 per lap (end of S1, end of S2, the line)
  pointTime: number | null; // when it passed that point (ms)
};

export type Replay = {
  start: number; end: number; totalLaps: number;
  ref: RefLap | null;
  laps: Map<number, DLap[]>;
  leaderLineTimes: number[]; // leaderLineTimes[n] = when the leader completed lap n (ms)
  finishOrder: Map<number, number>;
  points: Map<number, number[]>; // per driver: time at timing point p (index p-1); NaN if unknown
  leaderPoints: number[];        // earliest time any car passed timing point p (index p)
};

export function buildReplay(meta: Meta, timing: Timing, track: Track | null): Replay {
  const byDriver = new Map<number, Lap[]>();
  for (const l of timing.laps) byDriver.set(l.d, [...(byDriver.get(l.d) ?? []), l]);
  const laps = new Map<number, DLap[]>();
  for (const [d, list] of byDriver) {
    list.sort((a, b) => a.lap - b.lap);
    const out: DLap[] = [];
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l.dur == null) continue;
      let start = l.t;
      // lap 1 often has no start time; work back from the next lap
      if (start == null && list[i + 1]?.t != null) start = list[i + 1].t! - l.dur * 1000;
      if (start == null) continue;
      const s = l.s1 && l.s2 && l.s3 ? ([l.s1 * 1000, l.s2 * 1000, l.s3 * 1000] as [number, number, number]) : null;
      out.push({ lap: l.lap, start, end: start + l.dur * 1000, s });
    }
    if (out.length) laps.set(d, out);
  }
  const all = [...laps.values()].flat();
  const start = Math.min(...all.filter((l) => l.lap === 1).map((l) => l.start), ...all.map((l) => l.start));
  const end = Math.max(...all.map((l) => l.end)) + 15_000;
  const totalLaps = Math.max(...all.map((l) => l.lap));

  // leader at each line crossing = earliest car to complete lap n
  const leaderLineTimes: number[] = [start];
  for (let n = 1; n <= totalLaps; n++) {
    const ends = all.filter((l) => l.lap === n).map((l) => l.end);
    leaderLineTimes[n] = ends.length ? Math.min(...ends) : Infinity;
  }
  const finishOrder = new Map(meta.result.filter((r) => r.position).map((r) => [r.driver_number, r.position!]));

  // Timing points, like the official timing: end of sector 1, end of sector 2, the line.
  const points = new Map<number, number[]>();
  const leaderPoints: number[] = [start];
  for (const [d, list] of laps) {
    const pts: number[] = [];
    for (const l of list) {
      const base = (l.lap - 1) * 3;
      if (l.s) { pts[base] = l.start + l.s[0]; pts[base + 1] = l.start + l.s[0] + l.s[1]; }
      pts[base + 2] = l.end;
    }
    points.set(d, pts);
    pts.forEach((v, i) => { if (v != null && !(leaderPoints[i + 1] <= v)) leaderPoints[i + 1] = v; });
  }
  return { start, end, totalLaps, ref: track ? referenceLap(track, timing.laps) : null, laps, leaderLineTimes, finishOrder, points, leaderPoints };
}

/** Where a car is on the reference lap, given time `e` (ms) into its own lap. */
function placeOnTrack(ref: RefLap, lap: DLap, e: number): { x: number; y: number; f: number } {
  const R = ref.sectors;
  const total = R[0] + R[1] + R[2];
  let r: number;
  if (lap.s) {
    const [a, b, c] = lap.s;
    if (e < a) r = (e / a) * R[0];
    else if (e < a + b) r = R[0] + ((e - a) / b) * R[1];
    else r = R[0] + R[1] + Math.min(1, (e - a - b) / c) * R[2];
  } else {
    r = Math.min(1, e / (lap.end - lap.start)) * total;
  }
  return { x: interp(ref.t, ref.x, r), y: interp(ref.t, ref.y, r), f: r / total };
}

function findLap(list: DLap[], T: number): number {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= T) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function lastPoint(rp: Replay, d: number, T: number): { point: number; pointTime: number | null } {
  const pts = rp.points.get(d) ?? [];
  let point = 0, pointTime: number | null = null;
  for (let i = 0; i < pts.length; i++) {
    const v = pts[i];
    if (v == null) continue;
    if (v > T) break;
    point = i + 1; pointTime = v;
  }
  return { point, pointTime };
}

export function carStates(rp: Replay, timing: Timing, T: number): CarState[] {
  const ref = rp.ref;
  const startPoint = ref ? { x: ref.x[0], y: ref.y[0] } : { x: 0, y: 0 };
  const out: CarState[] = [];
  for (const [d, list] of rp.laps) {
    const i = findLap(list, T);
    const last = list[list.length - 1];
    if (i < 0) {
      out.push({ d, status: "waiting", lap: 0, completed: 0, progress: 0, ...startPoint, lineTime: null, point: 0, pointTime: null });
      continue;
    }
    const lap = list[i];
    if (T >= last.end) {
      const finished = last.lap === rp.totalLaps || rp.finishOrder.has(d);
      out.push({ d, status: finished ? "finished" : "out", lap: last.lap, completed: last.lap, progress: last.lap,
        ...startPoint, lineTime: last.end, ...lastPoint(rp, d, T) });
      continue;
    }
    if (T >= lap.end) {
      // between laps with a gap in the data: hold at the line
      out.push({ d, status: "running", lap: lap.lap + 1, completed: lap.lap, progress: lap.lap, ...startPoint, lineTime: lap.end, ...lastPoint(rp, d, T) });
      continue;
    }
    const pos = ref ? placeOnTrack(ref, lap, T - lap.start) : { ...startPoint, f: (T - lap.start) / (lap.end - lap.start) };
    const inPit = timing.pits.some((p) => p.d === d && T >= p.t && T <= p.t + (p.dur ?? 25) * 1000);
    out.push({
      d, status: inPit ? "pit" : "running", lap: lap.lap, completed: lap.lap - 1, progress: lap.lap - 1 + pos.f,
      x: pos.x, y: pos.y, lineTime: i > 0 ? list[i - 1].end : null, ...lastPoint(rp, d, T),
    });
  }
  const group = (c: CarState) => (c.status === "finished" ? 2 : c.status === "out" ? 0 : 1);
  return out.sort((a, b) =>
    group(b) - group(a)
    || (group(a) === 2 ? (rp.finishOrder.get(a.d) ?? 99) - (rp.finishOrder.get(b.d) ?? 99) : 0)
    || b.point - a.point
    || (a.pointTime ?? Infinity) - (b.pointTime ?? Infinity)
    || b.progress - a.progress);
}

/**
 * Gap to the leader at the last timing point this car passed (end of S1, S2 or the line):
 * the time between the leader passing that point and this car passing it. Exact.
 */
export function gapLabel(rp: Replay, c: CarState, leader: CarState): string {
  if (c.d === leader.d) return c.status === "finished" ? "Winner" : "Leader";
  if (c.status === "out") return "Out";
  if (c.pointTime == null || c.point === 0) return "";
  const leaderAt = rp.leaderPoints[c.point];
  if (leaderAt == null || !isFinite(leaderAt)) return "";
  // lapped: the leader had already passed the same point on a later lap
  let down = 0;
  while (rp.leaderPoints[c.point + 3 * (down + 1)] != null && rp.leaderPoints[c.point + 3 * (down + 1)] <= c.pointTime) down++;
  if (down > 0) return `+${down} ${down === 1 ? "lap" : "laps"}`;
  return `+${((c.pointTime - leaderAt) / 1000).toFixed(1)}`;
}

export function tyreAt(stints: Stint[], d: number, lap: number): { compound: string | null; age: number } | null {
  const s = stints.find((x) => x.d === d && lap >= (x.from ?? 0) && lap <= (x.to ?? 999));
  return s ? { compound: s.compound, age: (s.age ?? 0) + Math.max(0, lap - (s.from ?? lap)) } : null;
}

export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
