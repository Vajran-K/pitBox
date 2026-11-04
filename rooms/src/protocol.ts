// Messages between the browser and a watch room. Shared by the worker and the web app
// (web/src/lib/roomProtocol.ts re-exports this file's types).

export type ClockState = {
  playing: boolean;
  speed: number;
  /** session time (ms) at `anchor` */
  t: number;
  /** server wall time (ms since epoch) the clock was last changed */
  anchor: number;
};

export type Member = { id: string; name: string; colour: number };

export type ChatMessage = {
  id: string; from: string; name: string; colour: number; text: string;
  sentAt: number;       // server wall time
  raceT: number;        // replay time when sent, so the log can say "lap 23"
  tag?: string;         // live rooms: where the session was when sent ("Lap 23", "Q2"), from the sender's timing
};

export type Picks = { winner?: number; p2?: number; p3?: number; fastestLap?: number; safetyCar?: boolean };

/**
 * A room watches either a replay (shared clock over exported data) or a live session
 * (everyone sees F1's live timing; there is no clock). Older rooms have no `kind`: replay.
 * For live rooms raceStart/raceEnd are the scheduled start and end; picks lock at the start.
 */
export type RoomKind = "replay" | "live";
export type RoomInfo = {
  code: string; session: number; title: string; raceStart: number; raceEnd: number; createdAt: number;
  kind?: RoomKind;
  sessionType?: string; // "Race", "Qualifying", "Sprint", "Sprint Qualifying", "Practice"
};

/** Qualifying-style sessions are called by pole, P2 and P3; fastest lap and safety car don't apply. */
export const isQualiType = (t?: string) => /qualifying|shootout/i.test(t ?? "");

/** Live rooms: how the session ended, saved by the first browser that sees the final classification. */
export type Result = { winner?: number; p2?: number; p3?: number; fastestLap?: number; safetyCar: boolean };

export type ClientMessage =
  | { type: "hello"; id: string; name: string }
  | { type: "chat"; text: string; tag?: string }
  | { type: "react"; emoji: string }
  | { type: "clock"; op: "play" | "pause" | "seek" | "speed"; t?: number; speed?: number }
  | { type: "predict"; picks: Picks }
  | { type: "result"; result: Result }
  | { type: "ping"; c: number };

export type ServerMessage =
  | { type: "welcome"; you: Member; room: RoomInfo; clock: ClockState; members: Member[]; chat: ChatMessage[];
      picks: Record<string, Picks & { name: string }>; locked: boolean; now: number; result?: Result }
  | { type: "members"; members: Member[] }
  | { type: "chat"; message: ChatMessage }
  | { type: "react"; emoji: string; from: string; name: string }
  | { type: "clock"; clock: ClockState; by: string }
  | { type: "picks"; picks: Record<string, Picks & { name: string }>; locked: boolean }
  | { type: "result"; result: Result }
  | { type: "pong"; c: number; s: number }
  | { type: "error"; message: string };

export const REACTIONS = ["🔥", "😱", "😂", "👏", "🏁", "🟡"];
export const SPEEDS = [1, 4, 16, 64];
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

/** Session time the shared clock shows at server time `now`. */
export function clockAt(c: ClockState, now: number, end = Infinity): number {
  const t = c.playing ? c.t + (now - c.anchor) * c.speed : c.t;
  return Math.min(t, end);
}
