import type { Meta, Timing } from "../data";
import { chat } from "./ai";
import { cleanSpec, describeSpec, parseLocally, runSpec, specPrompt, SPEC_SCHEMA, type Answer, type QuerySpec } from "./ask";
import { lapTime, properName } from "./format";
import { checkRecap, recapFacts } from "./recap";
import { fold } from "./search";

/**
 * Chat about one race. Each message goes through the same grounded path as before:
 * the model turns it into a query (with the previous query as context, so follow-ups
 * work), PitBox computes the answer, and the model then puts the computed facts into
 * words. That reply is checked against those facts; if it says anything they don't,
 * PitBox shows its own plain summary instead.
 */

export type UserTurn = { role: "user"; text: string };
export type BotTurn = {
  role: "bot"; text: string; spec: QuerySpec | null; answer: Answer | null;
  facts: string[]; via: string; worded: "model" | "summary";
};
export type Turn = UserTurn | BotTurn;

const sec = (y: number) => (y >= 60 ? lapTime(y) : `${y} s`);

/** The computed result, as plain sentences the model may reword. */
export function answerFacts(a: Answer, meta?: Meta): string[] {
  if (a.kind === "none") return a.message ? [a.message] : [];
  // who the codes are, so a reply may say "Leclerc" instead of "LEC"
  const codes = new Set(a.kind === "table" ? a.rows.slice(0, 8).map((r) => String(r[0])) : a.series.map((s) => s.label.split(" ")[0]));
  const who = meta ? meta.drivers.filter((d) => codes.has(d.code)).map((d) => `${d.code} is ${properName(d.name)} (${d.team})`) : [];
  const names = who.length ? [`Drivers: ${who.join("; ")}.`] : [];
  if (a.kind === "table") {
    const rows = a.rows.slice(0, 8).map((r) => `${r[0]}: ${a.columns.slice(1).map((c, i) => `${c.toLowerCase()} ${r[i + 1]}`).join(", ")}.`);
    return [`${a.title} (${a.rows.length} rows, in this order):`, ...rows, a.summary, ...names].filter(Boolean);
  }
  const pos = !!a.reverseY;
  const x = (v: number) => (a.xLabel === "lap" ? (v === 0 ? "the grid" : `lap ${v}`) : `${v} laps old`);
  const y = (v: number) => (pos ? `P${v}` : a.zeroLine ? `${v} s` : sec(v));
  const out = [`${a.title}.`];
  for (const s of a.series.slice(0, 6)) {
    if (!s.points.length) continue;
    const lo = s.points.reduce((m, p) => (p.y < m.y ? p : m)), hi = s.points.reduce((m, p) => (p.y > m.y ? p : m));
    const last = s.points[s.points.length - 1];
    out.push(pos
      ? `${s.label}: best ${y(lo.y)} (${x(lo.x)}), worst ${y(hi.y)} (${x(hi.x)}), ${y(last.y)} at ${x(last.x)}.`
      : a.zeroLine
        ? `${s.label}: largest gap ${y(hi.y)} (${x(hi.x)}), smallest ${y(lo.y)} (${x(lo.x)}), ${y(last.y)} at ${x(last.x)}.`
        : `${s.label}: quickest ${y(lo.y)} (${x(lo.x)}), slowest shown ${y(hi.y)} (${x(hi.x)}).`);
  }
  out.push(a.summary, ...names);
  return out;
}

// question topic -> the fact-sheet lines that answer it
const TOPICS: [RegExp, RegExp][] = [
  [/\b(won|win|winner|victory|podium|result|finish(ed)? (first|second|third)|top three)\b/, /^(Winner|Second|Third)\b/],
  [/\b(led|lead|leader|leading|front)\b/, /^Who led|led every lap/],
  [/\b(retir\w*|dnf|did not finish|out of the race|crash\w*)\b/, /^Did not finish/],
  [/\b(safety car|vsc|red flag|neutrali[sz]ed|yellow)\b/, /safety car|red flag/i],
  [/\b(stops?|strateg\w*|tyres?|tires?|compounds?)\b/, /^(Strategies|Winner's tyres)/],
  [/\b(fastest lap|quickest lap)\b/, /^Fastest lap/],
  [/\b(gain\w*|lost|loss\w*|moved|places|overtak\w*|climb\w*|dropp?\w*)\b/, /^Biggest/],
  [/\b(pole|grid|start\w*)\b/, /pole|started/],
  [/\b(laps?|long|distance)\b/, /^Race:/],
];

/** Fact-sheet lines that answer the question; all of them for "what happened" or anything unmatched. */
export function relevantFacts(q: string, facts: string[]): string[] {
  const t = fold(q);
  if (/\b(what happened|summary|summari[sz]e|recap|overall|tell me about)\b/.test(t)) return facts;
  const hits = facts.filter((f) => TOPICS.some(([qre, fre]) => qre.test(t) && fre.test(f)));
  return hits.length ? hits : facts;
}

export const EXPLAIN_SYSTEM = `You answer questions about one Formula 1 race for a fan, in a chat.
Use ONLY the facts given. Answer in 1 to 3 short sentences, plain English. Copy numbers and lap times exactly as written; never add them up, round or convert them.
If the facts don't answer the question, say that PitBox's data for this race doesn't show it. Never mention "the facts" or "the data provided"; just answer.`;

export async function reply(opts: {
  q: string; history: Turn[]; meta: Meta; timing: Timing; title: string;
  model: string | null; signal?: AbortSignal; onModelError?: (e: Error) => void;
}): Promise<BotTurn> {
  const { q, history, meta, timing, title, model, signal } = opts;
  const prev = [...history].reverse().find((t): t is BotTurn => t.role === "bot" && !!t.spec && t.spec.chart !== "unsupported");
  const prevQ = [...history].reverse().find((t): t is UserTurn => t.role === "user");

  // 1. message -> query
  let spec: QuerySpec | null = null, via = "";
  let live = model; // dropped if the model fails, so the reply falls back cleanly
  if (live) {
    try {
      const context = prev && prevQ
        ? `Previous question: "${prevQ.text}" (read as: ${describeSpec(prev.spec!, meta)}; query ${JSON.stringify(prev.spec)}).\nNew message: ${q}`
        : q;
      spec = cleanSpec(JSON.parse(await chat({ model: live, system: specPrompt(meta), user: context, schema: SPEC_SCHEMA, signal })));
      via = live;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      opts.onModelError?.(e as Error);
      live = null;
    }
  }
  if (!spec) { spec = parseLocally(q, meta.drivers); via = "built-in reader"; }
  if (!spec) {
    return { role: "bot", spec: null, answer: null, facts: [], via, worded: "summary",
      text: "I can answer questions about this race: who won and who led, retirements and safety cars, lap times, positions, the gap between two drivers, tyre wear, pit stops, fastest laps and sectors. Try \"how did Leclerc's tyres hold up?\"" };
  }

  // 2. compute
  const sheet = recapFacts(meta, timing, title);
  const answer = spec.chart === "race_facts" ? null : runSpec(spec, meta, timing);
  const facts = spec.chart === "race_facts" ? relevantFacts(q, sheet) : answerFacts(answer!, meta);
  const fallback = spec.chart === "race_facts" ? facts.join(" ")
    : answer!.kind === "none" ? answer!.message : answer!.summary;

  // 3. put it into words, then check the words
  if (live && spec.chart !== "unsupported") {
    try {
      const text = (await chat({ model: live, system: EXPLAIN_SYSTEM, user: `Question: ${q}\nFacts:\n- ${facts.join("\n- ")}`, temperature: 0.2, signal })).trim();
      if (text && !checkRecap(text, facts).length) return { role: "bot", text, spec, answer, facts, via, worded: "model" };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      opts.onModelError?.(e as Error);
    }
  }
  return { role: "bot", text: fallback, spec, answer, facts, via, worded: "summary" };
}
