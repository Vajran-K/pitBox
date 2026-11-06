import type { Meta, Timing } from "../data";
import { chat, modelLabel } from "./ai";
import { generalFacts, hasTopics, loadHistory, loadSeasons, topics } from "./f1facts";
import { cleanSpec, describeSpec, parseLocally, runSpec, specPrompt, SPEC_SCHEMA, type Answer, type QuerySpec } from "./ask";
import { lapTime, properName } from "./format";
import { checkRecap, recapFacts } from "./recap";
import { fold } from "./search";

/**
 * Chat about a race, or about anything in F1. Questions about the race on screen go through
 * the grounded race path below; anything else (other races, seasons, careers, records, rules)
 * goes to generalReply().
 *
 * Race questions: Each message goes through the same grounded path as before:
 * the model turns it into a query (with the previous query as context, so follow-ups
 * work), PitBox computes the answer, and the model then puts the computed facts into
 * words. That reply is checked against those facts; if it says anything they don't,
 * PitBox shows its own plain summary instead.
 */

export type UserTurn = { role: "user"; text: string };
export type BotTurn = {
  role: "bot"; text: string; spec: QuerySpec | null; answer: Answer | null;
  facts: string[]; via: string; worded: "model" | "summary";
  scope?: "race" | "general";
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

// ---- general F1 ------------------------------------------------------------------------

/** Words that mean the question is about F1 in general rather than the race on screen. */
const GENERAL = /\b(champions?|championships?|titles?|careers?|all time|of all time|ever|history|historically|records?|greatest|goat|standings|seasons?|calendar|rules?|regulations?|points system|youngest|oldest|born|nationality|debut|rookie|contract|team principal|engine supplier|how many (races|wins|titles|poles|podiums|times)|most (wins|titles|poles|podiums|races))\b/;
const EXPLAIN = /\b(drs|ers|kers|mgu|parc ferme|porpois\w*|ground effect|downforce|blue flags?|super ?licen[cs]e|budget cap|cost cap|sprint format|track limits|undercut|overcut|slipstream|dirty air|formation lap|chequered flag|pit lane speed|halo|power units?|hybrid era|turbo era|f1 cars?|formula (1|one))\b/;

/** Is this about something other than the race on screen? (Other years, drivers or Grands Prix, records, rules.) */
export async function isGeneral(q: string, meta: Meta): Promise<boolean> {
  const t = fold(q);
  if (GENERAL.test(t) || EXPLAIN.test(t)) return true;
  const years = [...t.matchAll(/\b(19[5-9]\d|20\d\d)\b/g)].map((m) => Number(m[1]));
  if (years.some((y) => y !== meta.year)) return true;
  const h = await loadHistory().catch(() => null);
  if (!h) return false;
  const tp = topics(q, h, meta.year);
  const here = new Set(meta.drivers.map((d) => fold(d.name).split(" ").pop()));
  if (tp.drivers.some((id) => { const d = h.drivers.find((x) => x.id === id); return d && !here.has(fold(d.last).split(" ").pop()); })) return true;
  const thisGp = fold(meta.meetingName ?? "");
  if (tp.gps.some((g) => fold(g) !== thisGp)) return true;
  return false;
}

export const GENERAL_SYSTEM = (today: string) => `You are PitBox, a Formula 1 assistant chatting with a fan. Today is ${today}.
Answer any question about Formula 1: drivers, teams, seasons, races, records, rules, cars, tracks and history.
When facts are given, they come from the official results and are newer and more reliable than your memory: use them for everything they cover, copy names and numbers exactly, and if your memory disagrees, the facts win.
For anything the facts don't cover, answer from your own F1 knowledge. Your knowledge ends a while ago, so for recent seasons that the facts don't cover, say you're not sure rather than guess. If you don't know, say so.
Answer in 1 to 4 short sentences of plain English; use a short list only for a ranking. Never mention "the facts", "the data" or "PitBox's data"; just answer.
If the question isn't about Formula 1 or motorsport, say in one sentence that you only answer F1 questions.`;

/** A question about F1 in general: facts from PitBox's history where it has them, the model's own knowledge for the rest. */
export async function generalReply(opts: { q: string; history: Turn[]; model: string | null; signal?: AbortSignal; onModelError?: (e: Error) => void }): Promise<BotTurn> {
  const { q, history, model, signal } = opts;
  const prevQ = [...history].reverse().find((t): t is UserTurn => t.role === "user")?.text;
  let facts: string[] = [];
  try {
    const h = await loadHistory();
    const latest = h.summary.races[h.summary.races.length - 1]?.y ?? new Date().getFullYear();
    const tp = topics(q, h, latest);
    const yrs = tp.years.length ? tp.years : prevQ && !hasTopics(tp) ? topics(prevQ, h, latest).years : [];
    await loadSeasons(h, yrs);
    facts = generalFacts(q, h, prevQ).facts;
  } catch { /* no history exported: the model answers on its own */ }
  const known = facts.length > 1; // the first line only says how far the data goes

  if (model) {
    try {
      const earlier = history.slice(-4).map((t) => `${t.role === "user" ? "Fan" : "PitBox"}: ${t.text}`).join("\n");
      const user = `${earlier ? `Earlier in this chat:\n${earlier}\n\n` : ""}Question: ${q}${facts.length ? `\nFacts:\n- ${facts.join("\n- ")}` : ""}`;
      const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const text = (await chat({ model, system: GENERAL_SYSTEM(today), user, temperature: 0.3, signal })).trim();
      if (text) return { role: "bot", text, spec: null, answer: null, facts: known ? facts : [], via: modelLabel(model), worded: "model", scope: "general" };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      opts.onModelError?.(e as Error);
    }
  }
  // no model: PitBox's own facts, when the question was about something it has
  return {
    role: "bot", spec: null, answer: null, facts: known ? facts : [], via: "built-in reader", worded: "summary", scope: "general",
    text: known ? facts.slice(1).join(" ")
      : "The AI model isn't available right now, so I can only answer from PitBox's data: drivers' careers, champions, race winners and records since 1950, and anything about a race. Try \"Who won the 2008 championship?\" or \"Who has the most poles?\"",
  };
}

// ---- the race on screen ---------------------------------------------------------------

export async function reply(opts: {
  q: string; history: Turn[]; meta: Meta; timing: Timing; title: string;
  model: string | null; signal?: AbortSignal; onModelError?: (e: Error) => void;
}): Promise<BotTurn> {
  const { q, history, meta, timing, title, model, signal } = opts;
  if (await isGeneral(q, meta)) return generalReply(opts);
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
      via = modelLabel(live);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      opts.onModelError?.(e as Error);
      live = null;
    }
  }
  // not something about this race the charts can answer: answer it as a general F1 question
  if (spec?.chart === "unsupported") return generalReply({ ...opts, model: live });
  if (!spec) { spec = parseLocally(q, meta.drivers); via = "built-in reader"; }
  if (!spec) return generalReply({ ...opts, model: live });

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
      if (text && !checkRecap(text, facts).length) return { role: "bot", text, spec, answer, facts, via, worded: "model", scope: "race" };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      opts.onModelError?.(e as Error);
    }
  }
  return { role: "bot", text: fallback, spec, answer, facts, via, worded: "summary", scope: "race" };
}
