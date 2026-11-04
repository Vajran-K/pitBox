import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Meta, Timing } from "../data";
import { parseLocally } from "./ask";
import { answerFacts, relevantFacts, reply, type Turn } from "./chat";
import { recapFacts } from "./recap";

const dir = fileURLToPath(new URL("../../../data/public/sessions/11396/", import.meta.url));
const have = existsSync(dir + "meta.json");
const meta = have ? (JSON.parse(readFileSync(dir + "meta.json", "utf8")) as Meta) : (null as unknown as Meta);
const timing = have ? (JSON.parse(readFileSync(dir + "timing.json", "utf8")) as Timing) : (null as unknown as Timing);
const title = "United States Grand Prix 2026";

/** A stand-in for Ollama: the first call returns `spec`, the second returns `words`. */
function fakeModel(spec: object, words: string) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push(body.messages[1].content);
    const content = body.format ? JSON.stringify(spec) : words;
    return new Response(JSON.stringify({ message: { content } }), { status: 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const lapSpec = (drivers: string[]) => ({ chart: "lap_times", drivers, from_lap: null, to_lap: null, exclude_slow_laps: true, note: "" });

describe.skipIf(!have)("race chat", () => {
  it("reads race-fact questions without a model", async () => {
    expect(parseLocally("who won?", meta.drivers)?.chart).toBe("race_facts");
    expect(parseLocally("did anyone retire", meta.drivers)?.chart).toBe("race_facts");
    const r = await reply({ q: "who led the race?", history: [], meta, timing, title, model: null });
    expect(r.spec?.chart).toBe("race_facts");
    expect(r.text).toMatch(/Kimi Antonelli led 49 laps/);
  });

  it("picks the fact lines that match the question", () => {
    const facts = recapFacts(meta, timing, title);
    expect(relevantFacts("who retired?", facts)).toEqual([expect.stringMatching(/^Did not finish/)]);
    expect(relevantFacts("hello there", facts)).toEqual(facts);
  });

  it("turns a chart into sentences with real lap times", async () => {
    const r = await reply({ q: "LEC lap times", history: [], meta, timing, title, model: null });
    const f = answerFacts(r.answer!);
    expect(f.join(" ")).toMatch(/LEC: quickest 1:37\.976 \(lap 42\)/);
  });

  it("keeps the model's wording when it matches the computed facts", async () => {
    fakeModel(lapSpec(["LEC"]), "Leclerc's quickest lap was a 1:37.976 on lap 42.");
    const r = await reply({ q: "how quick was Leclerc", history: [], meta, timing, title, model: "qwen2.5:7b" });
    expect(r.worded).toBe("model");
    expect(r.text).toMatch(/1:37\.976/);
  });

  it("falls back to PitBox's own summary when the model makes something up", async () => {
    fakeModel(lapSpec(["LEC"]), "Leclerc won the race by 5.2 seconds, his first win of the season.");
    const r = await reply({ q: "how quick was Leclerc", history: [], meta, timing, title, model: "qwen2.5:7b" });
    expect(r.worded).toBe("summary");
    expect(r.text).toMatch(/^Average of the laps shown/);
  });

  it("sends the previous question along so follow-ups work", async () => {
    const first = await reply({ q: "NOR vs PIA lap times", history: [], meta, timing, title, model: null });
    const history: Turn[] = [{ role: "user", text: "NOR vs PIA lap times" }, first];
    const calls = fakeModel(lapSpec(["NOR", "PIA", "LEC"]), "");
    const r = await reply({ q: "now add Leclerc", history, meta, timing, title, model: "qwen2.5:7b" });
    expect(calls[0]).toMatch(/Previous question: "NOR vs PIA lap times"/);
    expect(r.answer?.kind === "lines" && r.answer.series.map((s) => s.label)).toEqual(["NOR", "PIA", "LEC"]);
  });

  it("uses the built-in reader when the model is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const errors: Error[] = [];
    const r = await reply({ q: "pit stops", history: [], meta, timing, title, model: "qwen2.5:7b", onModelError: (e) => errors.push(e) });
    expect(r.via).toBe("built-in reader");
    expect(r.answer?.kind).toBe("table");
    expect(errors.length).toBe(1);
  });
});
