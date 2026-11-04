import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Meta, Timing, Track } from "../data";
import { buildReplay } from "./replay";
import { buildQuali, qualiBoard } from "./quali";

// 2026 United States GP qualifying, if the pipeline has exported it
const dir = fileURLToPath(new URL("../../../data/public/sessions/11392/", import.meta.url));
const have = existsSync(dir + "meta.json");
const read = <T,>(f: string) => JSON.parse(readFileSync(dir + f, "utf8")) as T;

describe.skipIf(!have)("qualifying replay", () => {
  const meta = have ? read<Meta>("meta.json") : (null as unknown as Meta);
  const timing = have ? read<Timing>("timing.json") : (null as unknown as Timing);
  const track = have && existsSync(dir + "track.json") ? read<Track>("track.json") : null;
  const q = have ? buildQuali(meta, timing) : (null as never);
  const rp = have ? buildReplay(meta, timing, track) : (null as never);
  const code = (n: number) => meta.drivers.find((d) => d.number === n)?.code;

  it("finds the three parts and their sizes", () => {
    expect(q.flags).toEqual([1080000, 2400000, 3600000]);
    expect(q.sizes).toEqual([22, 16, 10]);
  });

  it("drops laps race control deleted for track limits", () => {
    // "CAR 87 (BEA) TIME 1:21.884 DELETED" style messages: none of those times may count
    const del = timing.raceControl.map((m) => /CAR (\d+)\b.*?TIME (\d+):(\d+\.\d+) DELETED/i.exec(m.msg)).filter(Boolean) as RegExpExecArray[];
    for (const x of del) expect(q.laps.some((l) => l.d === Number(x[1]) && l.dur === Math.round((Number(x[2]) * 60 + Number(x[3])) * 1000))).toBe(false);
  });

  it("knocks out the slowest at each flag, matching the official result", () => {
    const afterQ1 = qualiBoard(q, rp, 1080000 + 90_000);
    expect(afterQ1.part).toBe(1);
    expect(afterQ1.cutAfter).toBe(16);
    const q2 = qualiBoard(q, rp, q.partStart[1] + 60_000);
    expect(q2.part).toBe(2);
    expect(q2.rows.filter((r) => !r.knockedOut)).toHaveLength(16);
    expect(q2.rows.filter((r) => r.knockedOut).map((r) => r.pos)).toEqual([17, 18, 19, 20, 21, 22]);
    const end = qualiBoard(q, rp, 3600000 + 300_000);
    expect(end.done).toBe(true);
    const official = meta.result.filter((r) => r.position).map((r) => code(r.driver_number));
    expect(end.rows.map((r) => code(r.d))).toEqual(official);
  });

  it("orders each part by best lap so far", () => {
    const b = qualiBoard(q, rp, 2400000);
    const times = b.rows.filter((r) => !r.knockedOut && r.best != null).map((r) => r.best!);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });
});
