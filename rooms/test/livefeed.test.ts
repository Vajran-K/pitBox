import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { applyFeed, applyKeyframes, frames, merge, type LiveState } from "../src/livefeed.ts";

test("objects merge key by key", () => {
  assert.deepEqual(merge({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 4 } }), { a: 1, b: { c: 2, d: 4 } });
});

test("_kf replaces the whole value", () => {
  assert.deepEqual(merge({ Messages: [{ m: "old" }], x: 1 }, { Messages: [{ m: "new" }], _kf: true }), { Messages: [{ m: "new" }] });
});

test("index-keyed updates fill list slots", () => {
  const sectors = [{ Value: "" }, { Value: "" }, { Value: "" }];
  assert.deepEqual(merge(sectors, { "1": { Value: "23.456" } }), [{ Value: "" }, { Value: "23.456" }, { Value: "" }]);
  assert.deepEqual(merge([{ m: 0 }], { "1": { m: 1 } }), [{ m: 0 }, { m: 1 }]);
});

test("_deleted removes keys", () => {
  assert.deepEqual(merge({ a: 1, b: 2 }, { _deleted: ["a"] }), { b: 2 });
});

test("SignalR frames split on the record separator", () => {
  assert.deepEqual(frames('{"type":6}\x1e{"type":1,"target":"feed"}\x1e'), [{ type: 6 }, { type: 1, target: "feed" }]);
});

// Replays the real FP1 capture (Mexico 2026) through the merge and checks the result makes sense.
const capture = new URL("../../spike/live_capture_FP1.jsonl", import.meta.url);
const gz = new URL("../../.cache/fp1_capture.jsonl.gz", import.meta.url);
const raw = existsSync(capture) ? readFileSync(capture, "utf8") : existsSync(gz) ? gunzipSync(readFileSync(gz)).toString("utf8") : null;

test("FP1 capture merges into a consistent timing screen", { skip: !raw && "no capture file" }, () => {
  let state: LiveState = {};
  let feeds = 0;
  for (const line of raw!.split("\n").filter(Boolean)) {
    const m = JSON.parse(line).m;
    if (m.type === 3 && m.result) state = applyKeyframes(state, m.result);
    if (m.type === 1 && m.target === "feed") { state = applyFeed(state, m.arguments[0], m.arguments[1]); feeds++; }
  }
  assert.ok(feeds > 3000, `expected thousands of updates, got ${feeds}`);
  const lines = (state.TimingData as { Lines: Record<string, { Position: string; Sectors: unknown[]; BestLapTime: { Value: string } }> }).Lines;
  const positions = Object.values(lines).map((l) => Number(l.Position)).sort((a, b) => a - b);
  assert.deepEqual(positions, positions.map((_, i) => i + 1), "positions are 1..N with no gaps or repeats");
  for (const l of Object.values(lines)) assert.ok(Array.isArray(l.Sectors) && l.Sectors.length === 3, "sectors stay a 3-item list");
  assert.ok(Object.values(lines).filter((l) => l.BestLapTime?.Value).length >= 10, "most cars have set a time");
  const rc = (state.RaceControlMessages as { Messages: { Message: string }[] }).Messages;
  assert.equal(rc.length, 6);
  assert.match(rc[0].Message, /GREEN LIGHT/);
  assert.equal((state.SessionStatus as { Status: string }).Status, "Started");
  assert.equal(Object.keys(state.DriverList as object).filter((k) => k !== "_kf").length, positions.length);
});
