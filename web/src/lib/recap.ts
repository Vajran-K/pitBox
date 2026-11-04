import type { Meta, Timing } from "../data";
import { chat } from "./ai";
import { lapTime, properName } from "./format";
import { fastestLaps, lapPositions, neutralisedLaps, stintsByDriver } from "./race";

/**
 * The facts a race recap may use, worked out from the data. The model is told to use
 * these and nothing else; the same list is shown next to the recap so it can be checked.
 */
export function recapFacts(meta: Meta, timing: Timing, title: string): string[] {
  const d = new Map(meta.drivers.map((x) => [x.number, x]));
  const name = (n?: number) => (n != null && d.get(n) ? properName(d.get(n)!.name) : "unknown");
  const team = (n?: number) => (n != null ? d.get(n)?.team ?? "" : "");
  const grid = new Map(meta.grid.map((g) => [g.driver_number, g.position]));
  const res = meta.result;
  const totalLaps = Math.max(0, ...timing.laps.map((l) => l.lap));
  const facts: string[] = [`Race: ${title}, ${totalLaps} laps.`];

  const [p1, p2, p3] = res.filter((r) => r.position).slice(0, 3);
  const start = (n: number) => grid.get(n) === 1 ? "started from pole position" : grid.get(n) ? `started P${grid.get(n)}` : "grid position unknown";
  if (p1) facts.push(`Winner: ${name(p1.driver_number)} (${team(p1.driver_number)}), ${start(p1.driver_number)}.`);
  if (p2) facts.push(`Second: ${name(p2.driver_number)} (${team(p2.driver_number)})${typeof p2.gap_to_leader === "number" ? `, finished ${p2.gap_to_leader.toFixed(1)} seconds behind the winner` : ""}.`);
  if (p3) facts.push(`Third: ${name(p3.driver_number)} (${team(p3.driver_number)}).`);

  const pole = meta.grid.find((g) => g.position === 1);
  if (pole && pole.driver_number !== p1?.driver_number) facts.push(`${name(pole.driver_number)} started from pole and finished P${res.find((r) => r.driver_number === pole.driver_number)?.position ?? "outside the classification"}.`);

  // who led, and when it changed
  const byLap = lapPositions(meta, timing.laps);
  const leaders: { lap: number; d: number }[] = [];
  for (const [lap, m] of [...byLap].sort((a, b) => a[0] - b[0])) {
    if (lap === 0) continue;
    const lead = [...m].find(([, p]) => p === 1)?.[0];
    if (lead != null && leaders[leaders.length - 1]?.d !== lead) leaders.push({ lap, d: lead });
  }
  if (leaders.length > 1) {
    // laps led per driver, counted here so the model never has to add them up
    const spans = leaders.map((l, i) => ({ d: l.d, from: l.lap, to: (leaders[i + 1]?.lap ?? totalLaps + 1) - 1 }));
    const per = new Map<number, { laps: number; ranges: string[] }>();
    for (const sp of spans) {
      const e = per.get(sp.d) ?? { laps: 0, ranges: [] };
      e.laps += sp.to - sp.from + 1; e.ranges.push(sp.from === sp.to ? `${sp.from}` : `${sp.from}–${sp.to}`);
      per.set(sp.d, e);
    }
    const parts = [...per].map(([dn, e]) => `${name(dn)} led ${e.laps} ${e.laps === 1 ? "lap" : "laps"} (${e.laps === 1 ? "lap" : "laps"} ${e.ranges.join(" and ")})`);
    facts.push(`Who led: ${parts.join("; ")}. The lead changed hands ${leaders.length - 1} ${leaders.length === 2 ? "time" : "times"}.`);
  } else if (leaders.length === 1) facts.push(`${name(leaders[0].d)} led every lap.`);

  const movers = res.filter((r) => r.position && grid.get(r.driver_number))
    .map((r) => ({ d: r.driver_number, gain: grid.get(r.driver_number)! - r.position!, from: grid.get(r.driver_number)!, to: r.position! }))
    .sort((a, b) => b.gain - a.gain);
  const gainers = movers.filter((m) => m.gain >= 3).slice(0, 3);
  if (gainers.length) facts.push(`Biggest gains: ${gainers.map((m) => `${name(m.d)} P${m.from} to P${m.to}`).join("; ")}.`);
  const losers = movers.filter((m) => m.gain <= -3).slice(-2);
  if (losers.length) facts.push(`Biggest losses: ${losers.map((m) => `${name(m.d)} P${m.from} to P${m.to}`).join("; ")}.`);

  const best = [...fastestLaps(timing.laps).values()].sort((a, b) => (a.dur ?? 1e9) - (b.dur ?? 1e9))[0];
  if (best) facts.push(`Fastest lap: ${name(best.d)}, ${lapTime(best.dur)} on lap ${best.lap}.`);

  const neutral = neutralisedLaps(timing.raceControl, totalLaps);
  for (const n of neutral) facts.push(`${n.kind === "SC" ? "Safety car" : n.kind === "VSC" ? "Virtual safety car" : "Red flag"}: laps ${n.from}${n.to !== n.from ? `–${n.to}` : ""}.`);
  if (!neutral.length) facts.push("No safety car, virtual safety car or red flag.");

  const stints = stintsByDriver(timing.stints);
  if (p1) {
    const s = stints.get(p1.driver_number) ?? [];
    if (s.length) facts.push(`Winner's tyres: ${s.map((x) => (x.compound ?? "unknown").toLowerCase()).join(", then ")} (${s.length - 1} ${s.length - 1 === 1 ? "stop" : "stops"}).`);
  }
  const stops = res.map((r) => (stints.get(r.driver_number)?.length ?? 1) - 1);
  if (stops.length) {
    const counts = new Map<number, number>();
    stops.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
    facts.push(`Strategies: ${[...counts].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${c} ${c === 1 ? "driver" : "drivers"} made ${n} ${n === 1 ? "stop" : "stops"}`).join(", ")}.`);
  }

  const out = res.filter((r) => r.dnf || r.dns || r.dsq);
  if (out.length) facts.push(`Did not finish: ${out.map((r) => `${name(r.driver_number)} (${r.dsq ? "disqualified" : r.dns ? "did not start" : `retired after ${r.number_of_laps ?? 0} of ${totalLaps} laps`})`).join("; ")}.`);
  return facts;
}

export const RECAP_SYSTEM = `You write short Formula 1 race recaps for fans, as JSON.
Each sentence must restate one or two of the numbered facts and give their numbers in "facts".
Use ONLY those facts: no other names or numbers, no causes of retirements, quotes, weather or penalties, and nothing about the season, championship, careers, records, or a "first" win, victory or podium.
Copy numbers exactly as written; never add up, round or convert them.
Write 7 to 10 sentences, plain English, past tense, starting with the result.`;

const RECAP_SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: { facts: { type: "array", items: { type: "integer" } }, text: { type: "string" } },
        required: ["facts", "text"],
      },
    },
  },
  required: ["sentences"],
};

// Claims a small model tends to add on its own. Flagged when the facts don't mention them.
const CLAIMS = /\b(first|maiden|debut|season|championship|title|career|record|dominant|dominat\w*|consistently|comfortabl\w*|minutes?|hours?|crash\w*|collision|engine|gearbox|penalt\w*|team orders|rain\w*|wet|mechanical|incident|spin\w*)\b/gi;
const LED_ALL = /\b(led (every|all|the whole|the entire)|from start to finish|lights to flag|wire to wire|led (consistently|throughout)|until the end)\b/gi;
const ORDINARY = new Set(["The", "He", "His", "She", "Her", "It", "In", "After", "With", "On", "At", "By", "A", "An", "This", "That", "Meanwhile", "Despite", "While", "Later", "Grand", "Prix", "However", "Behind", "Further", "Also", "Conversely", "Elsewhere", "Both", "Their", "They", "Lap", "Laps", "P", "Only", "There", "Three", "Two", "One"]);

/**
 * Things in a text that the facts don't support: numbers, names and common invented claims.
 * With `cited`, numbers must come from those facts (so "led 32 laps" can't borrow "lap 32").
 */
export function checkRecap(text: string, facts: string[], cited?: string[]): string[] {
  const f = facts.join(" ");
  const fl = f.toLowerCase();
  const nf = (cited?.length ? cited : facts).join(" ");
  const issues = new Set<string>();
  for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) if (!new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}(?![\\d])`).test(nf)) issues.add(`the number ${n}`);
  for (const w of text.match(/\b[A-Z][a-zà-ÿ]+\b/g) ?? []) if (!ORDINARY.has(w) && !f.includes(w)) issues.add(`"${w}"`);
  for (const m of text.match(CLAIMS) ?? []) if (!fl.includes(m.toLowerCase())) issues.add(`"${m.toLowerCase()}"`);
  if (!/led every lap/.test(fl)) for (const m of text.match(LED_ALL) ?? []) issues.add(`"${m.toLowerCase()}"`);
  // "led (for) 32 (out of 56) laps" must match a count the facts give, not a lap number
  for (const m of text.matchAll(/\b(?:led|leading|leads) (?:for )?(?:the )?(\d+)\b/gi)) if (!fl.includes(`led ${m[1]} lap`)) issues.add(`"led ${m[1]}" laps`);
  return [...issues];
}

type Sentence = { facts: number[]; text: string };
const parseSentences = (raw: string): Sentence[] => {
  try {
    const v = JSON.parse(raw);
    return (Array.isArray(v?.sentences) ? v.sentences : [])
      .filter((x: Sentence) => typeof x?.text === "string" && x.text.trim())
      .map((x: Sentence) => ({ facts: (Array.isArray(x.facts) ? x.facts : []).filter(Number.isInteger), text: x.text.trim() }));
  } catch { return []; }
};

export type RecapResult = { text: string; dropped: { text: string; issues: string[] }[]; rewritten: number };

/**
 * Write a recap sentence by sentence, each citing the facts it uses. Sentences that fail
 * the check get one rewrite; any still failing are left out (and reported), so one bad
 * clause doesn't spoil the whole recap.
 */
export async function writeRecap(model: string, facts: string[], signal?: AbortSignal): Promise<RecapResult> {
  const numbered = facts.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const check = (s: Sentence) => checkRecap(s.text, facts, s.facts.map((i) => facts[i - 1]).filter(Boolean));
  const raw = await chat({ model, system: RECAP_SYSTEM, user: `Facts:\n${numbered}`, schema: RECAP_SCHEMA, temperature: 0.3, signal });
  let sentences = parseSentences(raw);
  const bad = sentences.map((s, i) => ({ i, issues: check(s) })).filter((b) => b.issues.length);
  let rewritten = 0;
  if (bad.length) {
    const ask = bad.map((b) => `- "${sentences[b.i].text}" (problem: ${b.issues.join(", ")})`).join("\n");
    const fixRaw = await chat({
      model, system: RECAP_SYSTEM, schema: RECAP_SCHEMA, temperature: 0.1, signal,
      user: `Facts:\n${numbered}\n\nRewrite each of these sentences so it says only what its facts say, in the same order, one sentence each:\n${ask}`,
    });
    const fixes = parseSentences(fixRaw);
    sentences = sentences.slice();
    bad.forEach((b, k) => { if (fixes[k] && !check(fixes[k]).length) { sentences[b.i] = fixes[k]; rewritten++; } });
  }
  const kept: string[] = [], dropped: RecapResult["dropped"] = [];
  for (const s of sentences) {
    const issues = check(s);
    if (issues.length) dropped.push({ text: s.text, issues }); else kept.push(s.text);
  }
  // two paragraphs: the result first, the rest after
  const cut = Math.min(kept.length, Math.max(2, Math.ceil(kept.length / 2)));
  const text = [kept.slice(0, cut).join(" "), kept.slice(cut).join(" ")].filter(Boolean).join("\n\n");
  return { text, dropped, rewritten };
}
