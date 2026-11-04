// F1 live timing: SignalR Core framing, the topics we subscribe to, and how updates
// merge into state. Shared by the Live relay (worker) and the browser.

export const F1_HOST = "livetiming.formula1.com";

/** Topics F1 serves without a login. Car telemetry and GPS (CarData.z, Position.z) need F1 TV, so they're left out. */
export const TOPICS = [
  "Heartbeat", "SessionInfo", "SessionStatus", "TrackStatus", "LapCount", "ExtrapolatedClock",
  "TimingData", "TimingAppData", "TimingStats", "DriverList", "TopThree",
  "RaceControlMessages", "WeatherData", "TeamRadio", "PitLaneTimeCollection", "TyreStintSeries",
];

export type LiveState = Record<string, unknown>;

/** Messages from the relay to the browser. */
export type LiveMessage =
  | { type: "snapshot"; state: LiveState; upstream: UpstreamStatus; at: number }
  | { type: "feed"; topic: string; data: unknown; ts: string }
  | { type: "status"; upstream: UpstreamStatus };

export type UpstreamStatus = "connecting" | "connected" | "offline" | "error";

const SEP = "\x1e";

/** Split a SignalR Core text frame into JSON records. */
export function frames(raw: string): unknown[] {
  return raw.split(SEP).filter(Boolean).map((p) => { try { return JSON.parse(p); } catch { return null; } }).filter(Boolean);
}

export function frame(obj: unknown): string {
  return JSON.stringify(obj) + SEP;
}

export const HANDSHAKE = frame({ protocol: "json", version: 1 });
export const SUBSCRIBE = frame({ type: 1, invocationId: "0", target: "Subscribe", arguments: [TOPICS] });
export const PING = frame({ type: 6 });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Merge one update into the current value of a topic, F1 style:
 *  - "_kf": true means the update is a full replacement
 *  - objects merge key by key
 *  - lists arrive as objects keyed by index ({"5": {...}}), and fill that slot
 *  - "_deleted": [keys] removes entries
 */
export function merge(target: unknown, update: unknown): unknown {
  if (isObj(update) && update._kf) {
    const { _kf, ...rest } = update; // eslint-disable-line @typescript-eslint/no-unused-vars
    return merge(undefined, rest);
  }
  if (!isObj(update)) return Array.isArray(update) ? update.map((u) => merge(undefined, u)) : update;

  if (Array.isArray(target)) {
    const out = [...target];
    for (const [k, v] of Object.entries(update)) {
      if (k === "_deleted") continue;
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0) out[i] = merge(out[i], v);
    }
    return out;
  }

  const out: Record<string, unknown> = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(update)) {
    if (k === "_deleted") continue;
    out[k] = merge(out[k], v);
  }
  const deleted = update._deleted;
  if (Array.isArray(deleted)) for (const k of deleted) delete out[String(k)];
  return out;
}

/** Apply a whole-state keyframe (the reply to Subscribe). */
export function applyKeyframes(state: LiveState, result: Record<string, unknown>): LiveState {
  const next = { ...state };
  for (const [topic, data] of Object.entries(result)) next[topic] = merge(undefined, data);
  return next;
}

export function applyFeed(state: LiveState, topic: string, data: unknown): LiveState {
  return { ...state, [topic]: merge(state[topic], data) };
}
