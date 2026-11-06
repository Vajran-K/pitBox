import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Meta } from "../data";
import { isGeneral } from "./chat";
import { generalFacts, loadHistory, loadSeasons, topics, type History } from "./f1facts";

const root = fileURLToPath(new URL("../../../data/public/", import.meta.url));
const have = existsSync(root + "history/summary.json");
let h: History;

beforeAll(async () => {
  if (!have) return;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const f = root + url.replace(/^\/data\//, "");
    return existsSync(f) ? new Response(readFileSync(f)) : new Response("missing", { status: 404 });
  }));
  h = await loadHistory();
});

async function factsFor(q: string, prev?: string) {
  const latest = h.summary.races[h.summary.races.length - 1].y;
  await loadSeasons(h, topics(q, h, latest).years);
  return generalFacts(q, h, prev).facts.join("\n");
}

describe.skipIf(!have)("general F1 facts", () => {
  it("finds drivers by surname, full name, nickname and code", () => {
    const latest = 2026;
    expect(topics("How many wins does Senna have?", h, latest).drivers).toEqual(["senna"]);
    expect(topics("Tell me about Michael Schumacher", h, latest).drivers).toEqual(["michael_schumacher"]);
    expect(topics("is lewis the goat", h, latest).drivers).toEqual(["hamilton"]);
    expect(topics("HAM vs VER career", h, latest).drivers).toEqual(["hamilton", "max_verstappen"]);
    // ordinary words aren't drivers
    expect(topics("Who has the most wins of all time?", h, latest).drivers).toEqual([]);
  });

  it("career totals", async () => {
    const f = await factsFor("How many races did Ayrton Senna win?");
    expect(f).toMatch(/Ayrton Senna \(Brazilian, born 1960-03-21\): 161 race starts, 41 wins/);
    expect(f).toMatch(/3 world titles \(1988, 1990, 1991\)/);
  });

  it("a season's champion and standings", async () => {
    const f = await factsFor("Who won the 2008 championship?");
    expect(f).toMatch(/2008 drivers' champion: Lewis Hamilton/);
    expect(f).toMatch(/2008 constructors' champion: Ferrari/);
  });

  it("the current season is labelled as still going", async () => {
    const f = await factsFor("Who is leading the championship?");
    expect(f).toMatch(/2026 season still going: \d+ of \d+ races done/);
  });

  it("a Grand Prix by name or circuit, with or without a year", async () => {
    expect(await factsFor("Who has won the most at Monaco?")).toMatch(/Monaco Grand Prix: held \d+ times .* Most wins: Ayrton Senna 6/);
    expect(await factsFor("Who won the British GP in 1992?")).toMatch(/1992 British Grand Prix .* won by Nigel Mansell/);
    expect(await factsFor("silverstone winners")).toMatch(/British Grand Prix: held/);
    // a nationality on its own isn't a Grand Prix
    expect(topics("Which British driver has the most wins?", h, 2026).gps).toEqual([]);
  });

  it("records, overall, by nationality and for teams", async () => {
    expect(await factsFor("Who has the most pole positions ever?")).toMatch(/Drivers with the most pole positions .*: 1\. Lewis Hamilton/);
    expect(await factsFor("Which British driver has the most wins?")).toMatch(/British drivers with the most wins: 1\. Lewis Hamilton/);
    expect(await factsFor("Which team has the most constructors titles?")).toMatch(/Teams with the most constructors' titles: 1\. Ferrari 16/);
  });

  it("team totals", async () => {
    expect(await factsFor("How many titles has Red Bull won?")).toMatch(/Red Bull: 6 constructors' titles/);
  });

  it("youngest winners and champions", async () => {
    expect(await factsFor("Who is the youngest race winner?")).toMatch(/Youngest race winners: 1\. Max Verstappen, 18 years/);
    expect(await factsFor("youngest world champion")).toMatch(/Youngest world champions: 1\. Sebastian Vettel, 23 years/);
  });

  it("follow-ups keep the subject", async () => {
    expect(await factsFor("and in 2010?", "How did Alonso do in 2006?")).toMatch(/Fernando Alonso in 2010: 2nd in the championship/);
  });

  it("tells this race's questions from general ones", async () => {
    const meta = JSON.parse(readFileSync(root + "sessions/11396/meta.json", "utf8")) as Meta;
    expect(await isGeneral("Who won?", meta)).toBe(false);
    expect(await isGeneral("Verstappen vs Hamilton lap times", meta)).toBe(false);
    expect(await isGeneral("How did Leclerc's tyres hold up?", meta)).toBe(false);
    expect(await isGeneral("Who won the 2008 championship?", meta)).toBe(true);
    expect(await isGeneral("How many wins does Senna have?", meta)).toBe(true);
    expect(await isGeneral("Who won at Monaco this year?", meta)).toBe(true);
    expect(await isGeneral("What is DRS?", meta)).toBe(true);
    expect(await isGeneral("Hamilton's career wins", meta)).toBe(true);
  });
});
