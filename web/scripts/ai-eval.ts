/**
 * Offline check of the AI layer against the real local model.
 *   npx vite-node scripts/ai-eval.ts [model] [sessionKey]
 * Asks questions whose right answer is known, compares the model's query with the
 * expected one (and with the built-in reader), then writes a recap and flags any
 * number or name in it that isn't in the fact sheet. Report: data/ai_eval.txt
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Meta, Timing } from "../src/data";
import { chat, listModels, pickModel, setOllamaBase } from "../src/lib/ai";
import { cleanSpec, parseLocally, resolveDrivers, specPrompt, SPEC_SCHEMA, type QuerySpec } from "../src/lib/ask";
import { recapFacts, writeRecap, type RecapResult } from "../src/lib/recap";

setOllamaBase(process.env.OLLAMA_HOST?.startsWith("http") ? process.env.OLLAMA_HOST : "http://127.0.0.1:11434");

const root = fileURLToPath(new URL("../../data/public/", import.meta.url));
const [argModel, argKey] = process.argv.slice(2);

function pickSession(): string {
  if (argKey) return argKey;
  if (existsSync(`${root}sessions/11396/meta.json`)) return "11396"; // 2026 United States GP
  const idx = JSON.parse(readFileSync(`${root}index.json`, "utf8"));
  const race = idx.sessions.find((s: { key: number; type?: string }) => existsSync(`${root}sessions/${s.key}/timing.json`));
  if (!race) throw new Error("No exported race found. Run the pipeline first.");
  return String(race.key);
}

type Case = { q: string; chart: QuerySpec["chart"]; drivers?: string[]; from?: number; to?: number; includeSlow?: boolean };
const CASES: Case[] = [
  { q: "NOR vs PIA lap times", chart: "lap_times", drivers: ["NOR", "PIA"] },
  { q: "How bad was Leclerc's tyre degradation?", chart: "tyre_degradation", drivers: ["LEC"] },
  { q: "gap between Verstappen and Hamilton from lap 10 to 30", chart: "gap", drivers: ["VER", "HAM"], from: 10, to: 30 },
  { q: "who had the quickest pit stops", chart: "pit_stops", drivers: [] },
  { q: "show me the running order through the race", chart: "positions", drivers: [] },
  { q: "who was fastest in each sector?", chart: "sector_times", drivers: [] },
  { q: "what was everyone's fastest lap", chart: "fastest_laps", drivers: [] },
  { q: "how did the two Ferraris compare on pace", chart: "lap_times", drivers: ["LEC", "HAM"] },
  { q: "Did Max lose a lot of time on old tyres?", chart: "tyre_degradation", drivers: ["VER"] },
  { q: "lap times for 16 and 81 including the pit laps", chart: "lap_times", drivers: ["LEC", "PIA"], includeSlow: true },
  { q: "how far behind Norris was Piastri over the race", chart: "gap", drivers: ["NOR", "PIA"] },
  { q: "who will win in Brazil next week?", chart: "unsupported" },
  { q: "was it raining during the race?", chart: "unsupported" },
  { q: "Russell's pace from lap 40 to the end", chart: "lap_times", drivers: ["RUS"], from: 40 },
];

function grade(c: Case, s: QuerySpec | null, meta: Meta): string[] {
  if (!s) return ["no usable query"];
  const bad: string[] = [];
  if (s.chart !== c.chart) bad.push(`chart ${s.chart} (want ${c.chart})`);
  if (c.drivers) {
    const code = (n: number) => meta.drivers.find((d) => d.number === n)?.code ?? String(n);
    const got = resolveDrivers(s.drivers, meta.drivers).map(code).sort().join(",");
    const want = [...c.drivers].sort().join(",");
    if (got !== want) bad.push(`drivers [${got}] (want [${want}])`);
  }
  if (c.from !== undefined && s.from_lap !== c.from) bad.push(`from_lap ${s.from_lap} (want ${c.from})`);
  if (c.to !== undefined && s.to_lap !== c.to) bad.push(`to_lap ${s.to_lap} (want ${c.to})`);
  if (c.from === undefined && c.to === undefined && (s.from_lap || s.to_lap) && c.chart !== "unsupported") bad.push(`invented laps ${s.from_lap}-${s.to_lap}`);
  if (c.includeSlow && s.exclude_slow_laps) bad.push("should include pit laps");
  return bad;
}

const out: string[] = [];
const log = (line = "") => { console.log(line); out.push(line); };

async function main() {
  const models = await listModels();
  const model = argModel ?? pickModel(models);
  if (!model) throw new Error("Ollama is running but has no models. Run: ollama pull qwen2.5:7b");
  const key = pickSession();
  const meta = JSON.parse(readFileSync(`${root}sessions/${key}/meta.json`, "utf8")) as Meta;
  const timing = JSON.parse(readFileSync(`${root}sessions/${key}/timing.json`, "utf8")) as Timing;
  const title = `${meta.year} ${meta.meetingName ?? meta.name}`;
  log(`PitBox AI check — ${new Date().toISOString()}`);
  log(`model: ${model}   session: ${key} (${title})   installed: ${models.join(", ")}`);
  log("");

  // warm-up so the first timing doesn't include loading the model into memory
  let t0 = Date.now();
  await chat({ model, system: "Reply with OK.", user: "OK?" });
  log(`model load + first reply: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  // how much of the model sits in GPU memory (Ollama's /api/ps)
  try {
    const ps = await (await fetch(`${process.env.OLLAMA_HOST?.startsWith("http") ? process.env.OLLAMA_HOST : "http://127.0.0.1:11434"}/api/ps`)).json();
    const m = (ps.models ?? []).find((x: { name: string }) => x.name === model);
    if (!m) log("on GPU: Ollama didn't say");
    else log(`on GPU: ${Math.round((100 * (m.size_vram ?? 0)) / m.size)}% of ${(m.size / 1e9).toFixed(1)} GB (100% = fully on the graphics card; 0% = running on the CPU)`);
  } catch { /* older Ollama */ }
  log("");

  let modelOk = 0, localOk = 0;
  const times: number[] = [];
  for (const c of CASES) {
    t0 = Date.now();
    let spec: QuerySpec | null = null, err = "";
    try { spec = cleanSpec(JSON.parse(await chat({ model, system: specPrompt(meta), user: c.q, schema: SPEC_SCHEMA }))); }
    catch (e) { err = (e as Error).message; }
    const ms = Date.now() - t0; times.push(ms);
    const bad = err ? [err] : grade(c, spec, meta);
    const local = parseLocally(c.q, meta.drivers);
    const localBad = c.chart === "unsupported" ? (local ? ["answered an unsupported question"] : []) : grade(c, local, meta);
    if (!bad.length) modelOk++;
    if (!localBad.length) localOk++;
    log(`${bad.length ? "FAIL" : "ok  "}  ${(ms / 1000).toFixed(1).padStart(5)} s  ${c.q}`);
    if (bad.length) log(`        model: ${bad.join("; ")}   ${spec ? JSON.stringify(spec) : ""}`);
    log(`        built-in reader: ${localBad.length ? localBad.join("; ") : "ok"}`);
  }
  times.sort((a, b) => a - b);
  log("");
  log(`questions: model ${modelOk}/${CASES.length}, built-in reader ${localOk}/${CASES.length}`);
  log(`time per question: median ${(times[times.length >> 1] / 1000).toFixed(1)} s, slowest ${(times.at(-1)! / 1000).toFixed(1)} s`);
  log("");

  // recap: the app's own write-check-retry path, plus the checker on its own over 3 drafts
  const facts = recapFacts(meta, timing, title);
  t0 = Date.now();
  const r = await writeRecap(model, facts);
  const wordCount = r.text.split(/\s+/).filter(Boolean).length;
  log(`recap (${((Date.now() - t0) / 1000).toFixed(1)} s, ${wordCount} words, ${r.rewritten} sentence(s) rewritten, ${r.dropped.length} left out):`);
  log(r.text);
  log("");
  for (const d of r.dropped) log(`left out: ${d.text}  (${d.issues.join(", ")})`);
  if (!r.dropped.length) log("left out: nothing");
  log("");
  const runs: RecapResult[] = [];
  for (let i = 0; i < 3; i++) runs.push(await writeRecap(model, facts));
  log(`3 more recaps: ${runs.map((x) => `${x.text.split(/\s+/).filter(Boolean).length} words / ${x.dropped.length} left out`).join(", ")}`);
  for (const x of runs) for (const d of x.dropped) log(`  left out: ${d.text}  (${d.issues.join(", ")})`);
  log("Read the recap above against the facts below too: the checker catches invented numbers, names and stock claims, not every wrong sentence.");
  log("");
  log("fact sheet given to the model:");
  facts.forEach((f) => log(`- ${f}`));

  const file = fileURLToPath(new URL("../../data/ai_eval.txt", import.meta.url));
  writeFileSync(file, out.join("\n") + "\n");
  console.log(`\nSaved to ${file}`);
}

main().catch((e) => { console.error(`\n${(e as Error).message}`); process.exit(1); });
