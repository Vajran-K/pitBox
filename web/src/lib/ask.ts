import type { Driver, Meta, Timing } from "../data";
import { lapTime, properName } from "./format";
import { lapPositions, stintsByDriver } from "./race";
import { fold } from "./search";

/**
 * "Ask PitBox": a question becomes a small, strict query (a QuerySpec). The language
 * model only ever writes the spec; every number shown is computed here from the data,
 * so the answer can't contain made-up figures.
 */

export const CHARTS = ["lap_times", "positions", "gap", "tyre_degradation", "pit_stops", "fastest_laps", "sector_times", "race_facts", "unsupported"] as const;
export type ChartKind = (typeof CHARTS)[number];

export type QuerySpec = {
  chart: ChartKind;
  drivers: string[];          // as the person wrote them: codes, surnames, numbers or teams
  from_lap: number | null;
  to_lap: number | null;
  exclude_slow_laps: boolean; // drop pit laps and safety-car laps from lap-time charts
  note: string;               // for "unsupported": a short reason
};

/** JSON schema handed to Ollama's structured-output mode. */
export const SPEC_SCHEMA = {
  type: "object",
  properties: {
    chart: { type: "string", enum: [...CHARTS] },
    drivers: { type: "array", items: { type: "string" } },
    from_lap: { type: ["integer", "null"] },
    to_lap: { type: ["integer", "null"] },
    exclude_slow_laps: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["chart", "drivers", "from_lap", "to_lap", "exclude_slow_laps", "note"],
};

export function specPrompt(meta: Meta): string {
  const field = meta.drivers.map((d) => `${d.code} ${properName(d.name)} (${d.team}, #${d.number})`).join("; ");
  return `You turn questions about one Formula 1 session into a JSON query. Reply with JSON only.
Charts:
- lap_times: lap time on every lap, for some drivers
- positions: running order lap by lap
- gap: time gap between exactly two drivers, lap by lap
- tyre_degradation: lap time against tyre age for each stint (tyre wear, degradation, pace on old tyres)
- pit_stops: table of pit stops and pit lane times
- fastest_laps: table of each driver's fastest lap
- sector_times: each driver's best sector times
- race_facts: who won, the podium, who led, retirements, safety cars or red flags, how many stops people made, or "what happened" / a summary of the race (no chart, answered in words)
- unsupported: anything else (weather, opinions, other races, predictions, greetings); put a short reason in note
Rules: in "drivers" write the 3-letter code of each driver the user names (for a team, both its drivers' codes). Leave "drivers" empty when no specific driver is named, including questions about everyone, all drivers or the whole field. Use from_lap/to_lap only if the user gives laps, otherwise null. For a follow-up (for example "add Leclerc", "only laps 20 to 40", "what about Russell?"), keep the previous chart and anything the user didn't change. Set exclude_slow_laps true for lap_times and tyre_degradation unless the user asks to include pit or safety-car laps.
Drivers in this session: ${field}.`;
}

// ---- resolving names ---------------------------------------------------------
/** Turn what the person typed (code, surname, number, team) into car numbers. */
export function resolveDrivers(words: string[], drivers: Driver[]): number[] {
  const out: number[] = [];
  const expanded = words.flatMap((w) => {
    const q = fold(w).replace(/[^a-z0-9 ]/g, "").trim();
    // "LEC Charles Leclerc" or "Max Verstappen": fall back to the words one by one
    return q.includes(" ") && !drivers.some((d) => fold(properName(d.name)) === q || fold(d.team ?? "") === q) ? q.split(" ") : [q];
  });
  for (const w of expanded) {
    const q = w;
    if (!q) continue;
    const exact = drivers.filter((d) =>
      fold(d.code ?? "") === q || String(d.number) === q ||
      fold(properName(d.name)).split(" ").includes(q) || fold(properName(d.name)) === q);
    const one = q.replace(/s$/, ""); // "Ferraris" -> "Ferrari"
    // whole words only, so "will" isn't Williams; several words ("red bull") may match a phrase
    const teamHit = (d: Driver) => {
      const t = fold(d.team ?? "");
      const words = t.split(/\s+/).filter((w) => !["racing", "team", "f1"].includes(w));
      return q.includes(" ") ? t.includes(q) : words.includes(q) || words.includes(one);
    };
    const team = exact.length ? [] : drivers.filter((d) => q.length >= 3 && teamHit(d));
    for (const d of exact.length ? exact : team) if (!out.includes(d.number)) out.push(d.number);
  }
  return out;
}

// ---- a small rule-based reader, used when no model is running ------------------
const KEYWORDS: [ChartKind, RegExp][] = [
  ["tyre_degradation", /\b(degrad\w*|tyre wear|tire wear|wear|old tyres|tyre life|deg)\b/],
  ["pit_stops", /\b(pit ?stops?|pit lane|pitted|quickest stops?)\b/],
  ["race_facts", /\b(who won|winner|won|podium|who led|led|leader|retir\w*|dnf|did not finish|safety car|red flag|what happened|summary|summari[sz]e|strateg\w*|how many stops)\b/],
  ["gap", /\b(gap|interval|behind|ahead of|between)\b/],
  ["positions", /\b(positions?|running order|overtak\w*|places?|order)\b/],
  ["sector_times", /\bsectors?\b/],
  ["fastest_laps", /\b(fastest laps?|quickest laps?|best laps?)\b/],
  ["lap_times", /\b(lap ?times?|pace|laps?|compare|vs|versus)\b/],
];

// Driver codes that are also ordinary words ("who had", "per lap") count only when typed in capitals.
const WORDY = new Set(["had", "per", "law", "nor", "ant", "col", "bot", "lin", "str", "sai", "alo", "bea", "gas"]);

export function parseLocally(question: string, drivers: Driver[]): QuerySpec | null {
  const q = fold(question);
  const chart = KEYWORDS.find(([, re]) => re.test(q))?.[0];
  const range = /laps? (\d+)\s*(?:-|to|and|–|until)\s*(\d+)/.exec(q);
  const fromOnly = range ? null : /\b(?:from|after|since) laps? (\d+)/.exec(q) ?? /\blaps? (\d+)\s*(?:-|to|until)\s*(?:the )?(?:end|finish|flag)/.exec(q);
  const untilOnly = range || fromOnly ? null : /\b(?:until|up to|before|first) laps? (\d+)/.exec(q);
  // numbers that are laps, not car numbers
  const lapNums = new Set([...q.matchAll(/laps? (\d+)/g)].map((m) => m[1]).concat(range ? [range[2]] : []));
  const named: string[] = [];
  for (const raw of question.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean)) {
    const t = fold(raw).replace(/[^a-z0-9]/g, "");
    if (!t || ["lap", "laps", "the"].includes(t) || lapNums.has(t)) continue;
    if (WORDY.has(t) && raw !== raw.toUpperCase()) continue;
    if (resolveDrivers([t], drivers).length && !named.includes(t)) named.push(t);
  }
  if (!chart && !named.length) return null;
  return {
    chart: chart ?? "lap_times", drivers: named,
    from_lap: range ? Number(range[1]) : fromOnly ? Number(fromOnly[1]) : null,
    to_lap: range ? Number(range[2]) : untilOnly ? Number(untilOnly[1]) : null,
    exclude_slow_laps: !/\b(includ\w*|with)\b.{0,15}\b(pit|safety|sc|slow|vsc)\b/.test(q), note: "",
  };
}

/** Accept whatever the model returned, keeping only the fields and values we understand. */
export function cleanSpec(raw: unknown): QuerySpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const chart = CHARTS.includes(r.chart as ChartKind) ? (r.chart as ChartKind) : null;
  if (!chart) return null;
  const lap = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 200 ? (v as number) : null);
  return {
    chart,
    // a long list means the model listed the whole field for an "everyone" question
    drivers: Array.isArray(r.drivers) && r.drivers.length < 8 ? r.drivers.map(String) : [],
    from_lap: lap(r.from_lap), to_lap: lap(r.to_lap),
    exclude_slow_laps: r.exclude_slow_laps !== false,
    note: typeof r.note === "string" ? r.note.slice(0, 200) : "",
  };
}

// ---- running a spec -------------------------------------------------------------
export type SeriesOut = { id: string; label: string; driver: number; points: { x: number; y: number; note?: string }[] };
export type Answer =
  | { kind: "lines"; title: string; yLabel: string; xLabel: "lap" | "age"; series: SeriesOut[]; reverseY?: boolean; zeroLine?: boolean; summary: string }
  | { kind: "table"; title: string; columns: string[]; rows: (string | number)[][]; summary: string }
  | { kind: "none"; message: string };

const COMPOUND = (c: string | null) => (c ? c[0] + c.slice(1).toLowerCase() : "Unknown");

function slowLaps(timing: Timing): Set<string> {
  // pit in/out laps, and laps far slower than the driver's typical pace (safety car, incidents)
  const out = new Set<string>();
  const byDriver = new Map<number, number[]>();
  for (const l of timing.laps) if (l.dur) byDriver.set(l.d, [...(byDriver.get(l.d) ?? []), l.dur]);
  const median = new Map([...byDriver].map(([d, v]) => [d, [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]]));
  const pitLaps = new Set(timing.pits.map((p) => `${p.d}-${p.lap}`));
  for (const l of timing.laps) {
    if (l.pitOut || pitLaps.has(`${l.d}-${l.lap}`) || l.lap === 1 || (l.dur && l.dur > (median.get(l.d) ?? 1e9) * 1.07)) out.add(`${l.d}-${l.lap}`);
  }
  return out;
}

export function runSpec(spec: QuerySpec, meta: Meta, timing: Timing): Answer {
  const drivers = new Map(meta.drivers.map((d) => [d.number, d]));
  const code = (n: number) => drivers.get(n)?.code ?? String(n);
  const finishOrder = meta.result.map((r) => r.driver_number);
  let chosen = resolveDrivers(spec.drivers, meta.drivers);
  const unknown = spec.drivers.filter((w) => resolveDrivers([w], meta.drivers).length === 0);
  const lastLap = Math.max(0, ...timing.laps.map((l) => l.lap));
  const from = Math.max(1, spec.from_lap ?? 1), to = Math.min(lastLap, spec.to_lap ?? lastLap);
  const inRange = (lap: number) => lap >= from && lap <= to;
  const rangeText = from === 1 && to === lastLap ? "" : `, laps ${from}–${to}`;
  const unknownText = unknown.length ? ` Couldn't find ${unknown.map((u) => `"${u}"`).join(", ")} in this session.` : "";

  if (spec.chart === "race_facts") return { kind: "none", message: "" }; // answered in words from the fact sheet

  if (spec.chart === "unsupported") {
    return { kind: "none", message: `${spec.note || "That isn't something PitBox can chart from this race's data."} Try lap times, positions, the gap between two drivers, tyre degradation, pit stops, fastest laps or sector times.` };
  }

  if (spec.chart === "pit_stops") {
    const rows = timing.pits.filter((p) => !chosen.length || chosen.includes(p.d))
      .sort((a, b) => (a.dur ?? 999) - (b.dur ?? 999))
      .map((p) => [code(p.d), p.lap, p.dur != null ? `${p.dur.toFixed(1)} s` : "–"]);
    return { kind: "table", title: "Pit stops", columns: ["Driver", "Lap", "Pit lane time"], rows,
      summary: `${rows.length} stops, quickest pit lane time first.${unknownText}` };
  }

  if (spec.chart === "fastest_laps" || spec.chart === "sector_times") {
    const pool = chosen.length ? chosen : finishOrder;
    const best = pool.map((d) => {
      const laps = timing.laps.filter((l) => l.d === d && l.dur && !l.pitOut && inRange(l.lap));
      const f = laps.sort((a, b) => a.dur! - b.dur!)[0];
      const minOf = (k: "s1" | "s2" | "s3") => Math.min(...laps.map((l) => l[k] ?? Infinity));
      return { d, f, s: [minOf("s1"), minOf("s2"), minOf("s3")] };
    }).filter((x) => x.f);
    if (spec.chart === "fastest_laps") {
      best.sort((a, b) => a.f!.dur! - b.f!.dur!);
      const top = best[0]?.f?.dur ?? 0;
      return { kind: "table", title: `Fastest laps${rangeText}`, columns: ["Driver", "Lap time", "On lap", "Gap"],
        rows: best.map((b) => [code(b.d), lapTime(b.f!.dur), b.f!.lap, b.f!.dur === top ? "–" : `+${(b.f!.dur! - top).toFixed(3)}`]),
        summary: `${code(best[0].d)} set the fastest lap.${unknownText}` };
    }
    const fmt = (v: number) => (isFinite(v) ? v.toFixed(3) : "–");
    return { kind: "table", title: `Best sector times${rangeText}`, columns: ["Driver", "Sector 1", "Sector 2", "Sector 3", "Ideal lap"],
      rows: best.sort((a, b) => a.s.reduce((x, y) => x + y) - b.s.reduce((x, y) => x + y))
        .map((b) => [code(b.d), fmt(b.s[0]), fmt(b.s[1]), fmt(b.s[2]), lapTime(b.s.reduce((x, y) => x + y))]),
      summary: `Ideal lap adds up each driver's best three sectors.${unknownText}` };
  }

  if (!chosen.length) chosen = finishOrder.slice(0, spec.chart === "positions" ? 5 : 2);

  if (spec.chart === "gap") {
    const [a, b] = chosen.length >= 2 ? chosen : finishOrder.slice(0, 2);
    const end = (d: number) => new Map(timing.laps.filter((l) => l.d === d && l.t != null && l.dur).map((l) => [l.lap, l.t! + l.dur! * 1000]));
    const ea = end(a), eb = end(b);
    const points = [...ea.keys()].filter((lap) => eb.has(lap) && inRange(lap)).sort((x, y) => x - y)
      .map((lap) => ({ x: lap, y: Math.round((eb.get(lap)! - ea.get(lap)!) / 100) / 10 }));
    const last = points[points.length - 1];
    return { kind: "lines", title: `Gap from ${code(a)} to ${code(b)}${rangeText}`, yLabel: `Seconds ${code(b)} is behind ${code(a)}`, xLabel: "lap",
      zeroLine: true, series: [{ id: String(b), label: code(b), driver: b, points }],
      summary: last ? `At the end of lap ${last.x}, ${code(b)} was ${last.y >= 0 ? `${last.y} s behind` : `${-last.y} s ahead of`} ${code(a)}.${unknownText}` : `No laps in common.${unknownText}` };
  }

  if (spec.chart === "positions") {
    const byLap = lapPositions(meta, timing.laps);
    const series = chosen.map((d) => ({ id: String(d), label: code(d), driver: d,
      points: [...byLap].filter(([lap, m]) => m.has(d) && (lap === 0 || inRange(lap))).map(([lap, m]) => ({ x: lap, y: m.get(d)! })) }));
    return { kind: "lines", title: `Positions${rangeText}`, yLabel: "Position", xLabel: "lap", reverseY: true, series,
      summary: `Lap 0 is the starting grid.${unknownText}` };
  }

  const slow = spec.exclude_slow_laps ? slowLaps(timing) : new Set<string>();
  if (spec.chart === "tyre_degradation") {
    const stints = stintsByDriver(timing.stints);
    const series: SeriesOut[] = [];
    for (const d of chosen) for (const s of stints.get(d) ?? []) {
      const points = timing.laps.filter((l) => l.d === d && l.dur && l.lap >= s.from && l.lap <= s.to && inRange(l.lap) && !slow.has(`${d}-${l.lap}`))
        .map((l) => ({ x: (s.age ?? 0) + (l.lap - s.from), y: Math.round(l.dur! * 1000) / 1000, note: `lap ${l.lap}` }));
      if (points.length >= 3) series.push({ id: `${d}-${s.n}`, label: `${code(d)} ${COMPOUND(s.compound)} (stint ${s.n})`, driver: d, points });
    }
    const trend = series.map((s) => {
      const n = s.points.length, mx = s.points.reduce((a, p) => a + p.x, 0) / n, my = s.points.reduce((a, p) => a + p.y, 0) / n;
      const slope = s.points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / (s.points.reduce((a, p) => a + (p.x - mx) ** 2, 0) || 1);
      return `${s.label}: ${slope >= 0 ? "+" : ""}${slope.toFixed(3)} s per lap`;
    });
    return { kind: "lines", title: `Tyre degradation${rangeText}`, yLabel: "Lap time (s)", xLabel: "age", series,
      summary: `Trend (straight-line fit, fuel burn not removed): ${trend.join("; ")}.${spec.exclude_slow_laps ? " Pit, first-lap and safety-car laps left out." : ""}${unknownText}` };
  }

  // lap_times
  const series = chosen.map((d) => ({ id: String(d), label: code(d), driver: d,
    points: timing.laps.filter((l) => l.d === d && l.dur && inRange(l.lap) && !slow.has(`${d}-${l.lap}`))
      .sort((a, b) => a.lap - b.lap).map((l) => ({ x: l.lap, y: Math.round(l.dur! * 1000) / 1000, note: lapTime(l.dur) })) }));
  const avg = series.map((s) => `${s.label} ${lapTime(s.points.reduce((a, p) => a + p.y, 0) / (s.points.length || 1))}`);
  return { kind: "lines", title: `Lap times${rangeText}`, yLabel: "Lap time (s)", xLabel: "lap", series,
    summary: `Average of the laps shown: ${avg.join(", ")}.${spec.exclude_slow_laps ? " Pit, first-lap and safety-car laps left out." : ""}${unknownText}` };
}

/** One line saying how the question was read, so people can see and correct it. */
export function describeSpec(spec: QuerySpec, meta: Meta): string {
  const names = resolveDrivers(spec.drivers, meta.drivers).map((n) => meta.drivers.find((d) => d.number === n)?.code).filter(Boolean);
  const what: Record<ChartKind, string> = {
    lap_times: "Lap times", positions: "Positions by lap", gap: "Gap between two drivers", tyre_degradation: "Tyre degradation",
    pit_stops: "Pit stops", fastest_laps: "Fastest laps", sector_times: "Best sector times", race_facts: "Race facts", unsupported: "Not something PitBox can chart",
  };
  const everyone = ["pit_stops", "fastest_laps", "sector_times"].includes(spec.chart);
  const who = names.length ? ` for ${names.join(", ")}` : spec.chart === "unsupported" || spec.chart === "race_facts" ? "" : everyone ? " for everyone" : " (no driver named, so the leaders)";
  const laps = spec.from_lap || spec.to_lap ? `, laps ${spec.from_lap ?? 1}–${spec.to_lap ?? "end"}` : "";
  return `${what[spec.chart]}${who}${laps}`;
}
