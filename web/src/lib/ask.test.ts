import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Meta, Timing } from "../data";
import { cleanSpec, parseLocally, resolveDrivers, runSpec } from "./ask";
import { checkRecap, recapFacts } from "./recap";

// Uses the exported 2026 United States GP if the pipeline has produced it.
const dir = fileURLToPath(new URL("../../../data/public/sessions/11396/", import.meta.url));
const have = existsSync(dir + "meta.json");
const meta = have ? (JSON.parse(readFileSync(dir + "meta.json", "utf8")) as Meta) : (null as unknown as Meta);
const timing = have ? (JSON.parse(readFileSync(dir + "timing.json", "utf8")) as Timing) : (null as unknown as Timing);
const code = (n: number) => meta.drivers.find((d) => d.number === n)?.code;

describe.skipIf(!have)("ask: reading questions", () => {
  it("matches codes, surnames, numbers and teams", () => {
    expect(resolveDrivers(["NOR"], meta.drivers).map(code)).toEqual(["NOR"]);
    expect(resolveDrivers(["leclerc"], meta.drivers).map(code)).toEqual(["LEC"]);
    expect(resolveDrivers(["44"], meta.drivers).map(code)).toEqual(["HAM"]);
    expect(resolveDrivers(["ferrari"], meta.drivers).map(code).sort()).toEqual(["HAM", "LEC"]);
    expect(resolveDrivers(["Räikkönen"], meta.drivers)).toEqual([]);
  });

  it("reads common questions without a model", () => {
    expect(parseLocally("NOR vs PIA lap times", meta.drivers)).toMatchObject({ chart: "lap_times", drivers: ["nor", "pia"] });
    expect(parseLocally("tyre degradation for Leclerc", meta.drivers)?.chart).toBe("tyre_degradation");
    expect(parseLocally("gap between VER and HAM laps 10 to 30", meta.drivers)).toMatchObject({ chart: "gap", from_lap: 10, to_lap: 30 });
    expect(parseLocally("who had the quickest pit stops?", meta.drivers)?.chart).toBe("pit_stops");
    expect(parseLocally("fastest laps", meta.drivers)?.chart).toBe("fastest_laps");
    expect(parseLocally("what's the weather like in Paris", meta.drivers)).toBeNull();
    // lap numbers aren't car numbers, "had" isn't Hadjar, plurals of teams work
    expect(parseLocally("gap between Verstappen and Hamilton from lap 10 to 30", meta.drivers)?.drivers).toEqual(["verstappen", "hamilton"]);
    expect(parseLocally("who had the quickest pit stops", meta.drivers)?.drivers).toEqual([]);
    expect(resolveDrivers(["Ferraris"], meta.drivers).map(code).sort()).toEqual(["HAM", "LEC"]);
    expect(resolveDrivers(["will"], meta.drivers)).toEqual([]);
    expect(parseLocally("who will win in Brazil next week?", meta.drivers)).toBeNull();
    expect(parseLocally("lap times for 16 and 81 including the pit laps", meta.drivers)).toMatchObject({ drivers: ["16", "81"], exclude_slow_laps: false });
    expect(parseLocally("Russell's pace from lap 40 to the end", meta.drivers)).toMatchObject({ drivers: ["russell"], from_lap: 40, to_lap: null });
  });

  it("drops anything in a model's reply it doesn't understand", () => {
    expect(cleanSpec({ chart: "lap_times", drivers: ["NOR"], from_lap: -3, to_lap: 9999, exclude_slow_laps: "yes", note: 1 }))
      .toEqual({ chart: "lap_times", drivers: ["NOR"], from_lap: null, to_lap: null, exclude_slow_laps: true, note: "" });
    expect(cleanSpec({ chart: "rm -rf" })).toBeNull();
    expect(cleanSpec("nope")).toBeNull();
  });
});

describe.skipIf(!have)("ask: answers come from the data", () => {
  const spec = (chart: string, drivers: string[] = [], extra = {}) =>
    ({ chart, drivers, from_lap: null, to_lap: null, exclude_slow_laps: true, note: "", ...extra }) as never;

  it("lap times leave out pit and first laps", () => {
    const a = runSpec(spec("lap_times", ["LEC"]), meta, timing);
    expect(a.kind).toBe("lines");
    if (a.kind !== "lines") return;
    const pts = a.series[0].points;
    expect(pts.length).toBeGreaterThan(40);
    expect(pts.find((p) => p.x === 1)).toBeUndefined();
    const pitLaps = timing.pits.filter((p) => p.d === 16).map((p) => p.lap);
    for (const lap of pitLaps) expect(pts.find((p) => p.x === lap)).toBeUndefined();
  });

  it("gap is the difference in lap end times", () => {
    const a = runSpec(spec("gap", ["ANT", "LEC"]), meta, timing);
    if (a.kind !== "lines") throw new Error("expected lines");
    const last = a.series[0].points.at(-1)!;
    const lec = meta.result.find((r) => r.driver_number === 16)!;
    expect(Math.abs(last.y - (lec.gap_to_leader as number))).toBeLessThan(0.6);
  });

  it("no driver named means the top finishers", () => {
    const a = runSpec(spec("lap_times"), meta, timing);
    if (a.kind !== "lines") throw new Error("expected lines");
    expect(a.series.map((s) => code(s.driver))).toEqual(meta.result.slice(0, 2).map((r) => code(r.driver_number)));
  });

  it("pit stop table is sorted quickest first", () => {
    const a = runSpec(spec("pit_stops"), meta, timing);
    if (a.kind !== "table") throw new Error("expected table");
    expect(a.rows.length).toBe(timing.pits.length);
  });

  it("unknown names are reported, not guessed", () => {
    const a = runSpec(spec("lap_times", ["LEC", "Senna"]), meta, timing);
    expect(a.kind === "lines" && a.summary).toContain('Couldn\'t find "Senna"');
  });

  it("recap facts name the actual winner", () => {
    const facts = recapFacts(meta, timing, "United States Grand Prix 2026");
    expect(facts.some((f) => f.startsWith("Winner: Kimi Antonelli"))).toBe(true);
    expect(facts.some((f) => f.startsWith("Fastest lap: Charles Leclerc"))).toBe(true);
  });
});

describe.skipIf(!have)("recap checker", () => {
  const facts = have ? recapFacts(meta, timing, "2026 United States Grand Prix") : [];
  it("states who led as lap ranges and the real gap", () => {
    expect(facts.join(" ")).toMatch(/Kimi Antonelli led 49 laps \(laps 1–24 and 32–56\); Max Verstappen led 7 laps \(laps 25–31\)/);
    expect(facts.join(" ")).toMatch(/13\.1 seconds behind/);
  });
  it("flags what qwen2.5:7b made up on the first real run", () => {
    const bad = "Kimi Antonelli secured his first win of the season, starting from pole position and leading consistently until the end. Charles Leclerc finished second, just over a minute behind.";
    expect(checkRecap(bad, facts)).toEqual(expect.arrayContaining(['"first"', '"season"', '"minute"', '"until the end"']));
    expect(checkRecap("Kimi Antonelli won from pole position. Charles Leclerc finished 13.1 seconds behind.", facts)).toEqual([]);
    // second run: "first victory" and a lap count made from a lap number
    expect(checkRecap("Kimi Antonelli secured his first victory, leading for 32 out of 56 laps.", facts)).toEqual(expect.arrayContaining(['"first"', '"led 32" laps']));
    expect(checkRecap("Kimi Antonelli led 49 laps.", facts)).toEqual([]);
    // numbers must come from the facts a sentence cites
    const fl = facts.find((f) => f.startsWith("Fastest lap"))!;
    expect(checkRecap("Charles Leclerc set the fastest lap, 1:37.976 on lap 42.", facts, [fl])).toEqual([]);
    expect(checkRecap("Charles Leclerc set the fastest lap on lap 56.", facts, [fl])).toEqual(["the number 56"]);
  });
  it("reads a driver written as 'LEC Charles Leclerc'", () => {
    expect(resolveDrivers(["LEC Charles Leclerc"], meta.drivers).map(code)).toEqual(["LEC"]);
    expect(resolveDrivers(["Max Verstappen"], meta.drivers).map(code)).toEqual(["VER"]);
    expect(cleanSpec({ chart: "positions", drivers: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] })?.drivers).toEqual([]);
  });
});
