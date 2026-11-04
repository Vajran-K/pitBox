import { test } from "node:test";
import assert from "node:assert/strict";
import { clockAt, type ClockState } from "../src/protocol.ts";

test("paused clock stays put", () => {
  const c: ClockState = { playing: false, speed: 16, t: 5000, anchor: 1_000 };
  assert.equal(clockAt(c, 99_999), 5000);
});

test("playing clock advances at its speed from the anchor", () => {
  const c: ClockState = { playing: true, speed: 4, t: 5000, anchor: 1_000 };
  assert.equal(clockAt(c, 3_000), 5000 + 2000 * 4);
});

test("clock stops at the end of the race", () => {
  const c: ClockState = { playing: true, speed: 64, t: 0, anchor: 0 };
  assert.equal(clockAt(c, 1e9, 7_200_000), 7_200_000);
});
