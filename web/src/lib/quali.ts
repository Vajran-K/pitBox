import type { Meta, Timing } from "../data";
import type { Replay } from "./replay";

/**
 * Qualifying replay. The session is three parts, each ended by a chequered flag (from race
 * control). In each part, drivers are ordered by their best lap of that part so far; the
 * slowest are knocked out at the flag. Laps race control deleted (track limits) don't count.
 * Who goes through comes from the official result, so eliminations always match it.
 */

export type QualiModel = {
  flags: number[];              // session time of each part's chequered flag
  partStart: number[];          // first lap start in each part
  sizes: number[];              // drivers taking part in Q1, Q2, Q3
  finalPos: Map<number, number>;
  laps: { d: number; part: number; start: number; end: number; dur: number }[]; // valid timed laps
  prefix: "Q" | "SQ";
};

export type QualiRow = {
  d: number; pos: number; best: number | null; gap: number | null; laps: number;
  onTrack: boolean; knockedOut: boolean; outIn: number | null; // part they were knocked out in
};

export type QualiBoard = { part: number; label: string; rows: QualiRow[]; cutAfter: number | null; done: boolean };

const DELETED = /CAR (\d+)\b.*?TIME (\d+):(\d+\.\d+) DELETED/i;

export function buildQuali(meta: Meta, timing: Timing): QualiModel {
  const flags = timing.raceControl.filter((m) => /CHEQUERED/i.test(m.msg) || m.flag === "CHEQUERED").map((m) => m.t).sort((a, b) => a - b);
  // a flag within a few seconds of another is the same flag reported twice
  const parts = flags.filter((t, i) => i === 0 || t - flags[i - 1] > 60_000).slice(0, 3);
  const deleted = new Set<string>();
  for (const m of timing.raceControl) {
    const x = DELETED.exec(m.msg);
    if (x) deleted.add(`${x[1]}:${Math.round((Number(x[2]) * 60 + Number(x[3])) * 1000)}`);
  }
  const partOf = (start: number) => { const i = parts.findIndex((f) => start <= f); return i < 0 ? parts.length : i + 1; };
  const laps: QualiModel["laps"] = [];
  for (const l of timing.laps) {
    if (l.t == null || l.dur == null || l.pitOut) continue;
    const dur = Math.round(l.dur * 1000);
    if (deleted.has(`${l.d}:${dur}`)) continue;
    laps.push({ d: l.d, part: Math.min(3, partOf(l.t)), start: l.t, end: l.t + dur, dur });
  }
  const n = meta.drivers.length || new Set(timing.laps.map((l) => l.d)).size;
  const sizes = [n, 10 + Math.round((n - 10) / 2), 10];
  // a part starts when the first car leaves the pits for it (in-laps from the last part start just after the flag)
  const partStart = [1, 2, 3].map((p) => {
    const outLaps = timing.laps.filter((l) => l.t != null && l.pitOut && Math.min(3, partOf(l.t)) === p && (p === 1 || l.t > parts[p - 2] + 60_000));
    return outLaps.length ? Math.min(...outLaps.map((l) => l.t!)) : Infinity;
  });
  const finalPos = new Map(meta.result.filter((r) => r.position).map((r) => [r.driver_number, r.position!]));
  return { flags: parts, partStart, sizes, finalPos, laps, prefix: /sprint/i.test(meta.name) ? "SQ" : "Q" };
}

/** Which part of qualifying (1-3) is on at session time T. */
export function partAt(q: QualiModel, T: number): number {
  for (let i = 0; i < q.flags.length; i++) if (T <= q.flags[i] + 60_000 || T < (q.partStart[i + 1] ?? Infinity)) return i + 1;
  return Math.min(3, q.flags.length + 1);
}

export function qualiBoard(q: QualiModel, rp: Replay, T: number): QualiBoard {
  const part = partAt(q, T);
  const finished = q.flags.length >= 3 && T > q.flags[2] + 120_000;
  const reached = (d: number, p: number) => p === 1 || (q.finalPos.get(d) ?? 99) <= q.sizes[p - 1];
  const drivers = [...rp.laps.keys()];
  const best = (d: number, p: number) => {
    const times = q.laps.filter((l) => l.d === d && l.part === p && l.end <= T).map((l) => l.dur);
    return times.length ? Math.min(...times) : null;
  };
  const onTrack = (d: number) => (rp.laps.get(d) ?? []).some((l) => l.start <= T && T < l.end);
  const lapsDone = (d: number) => q.laps.filter((l) => l.d === d && l.end <= T).length;

  const inPart = drivers.filter((d) => reached(d, part));
  const running = inPart.map((d) => ({ d, b: best(d, part) }))
    // no time yet: by car number, so the order doesn't give the result away
    .sort((a, b) => (a.b ?? Infinity) - (b.b ?? Infinity) || a.d - b.d);
  const fastest = running[0]?.b ?? null;
  const rows: QualiRow[] = running.map((r, i) => ({
    d: r.d, pos: i + 1, best: r.b, gap: r.b != null && fastest != null && i > 0 ? r.b - fastest : null, laps: lapsDone(r.d),
    onTrack: onTrack(r.d), knockedOut: false, outIn: null,
  }));
  // knocked out earlier: below, in their final order, with their time from the part they went out in
  const out = drivers.filter((d) => !reached(d, part)).sort((a, b) => (q.finalPos.get(a) ?? 99) - (q.finalPos.get(b) ?? 99));
  for (const d of out) {
    const p = [1, 2, 3].filter((x) => reached(d, x)).pop() ?? 1;
    rows.push({ d, pos: q.finalPos.get(d) ?? rows.length + 1, best: best(d, p), gap: null, laps: lapsDone(d), onTrack: onTrack(d), knockedOut: true, outIn: p });
  }
  // at the very end, show the official order
  if (finished) rows.sort((a, b) => (q.finalPos.get(a.d) ?? 99) - (q.finalPos.get(b.d) ?? 99)).forEach((r) => (r.pos = q.finalPos.get(r.d) ?? r.pos));
  const cutAfter = !finished && part < 3 ? q.sizes[part] : null;
  const over = part <= q.flags.length && T > q.flags[part - 1];
  const label = finished ? "Final" : `${q.prefix}${part}${over ? " finished" : ""}`;
  return { part, label, rows, cutAfter, done: finished };
}

export const lapTimeMs = (ms: number | null) => {
  if (ms == null) return "";
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
};
