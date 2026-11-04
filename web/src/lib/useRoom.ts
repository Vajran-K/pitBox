import { useCallback, useEffect, useRef, useState } from "react";
import {
  clockAt, roomsWsUrl,
  type ChatMessage, type ClientMessage, type ClockState, type Member, type Picks, type Result, type RoomInfo, type ServerMessage,
} from "./roomProtocol";
import type { Clock } from "./useReplayClock";

export type Reaction = { key: number; emoji: string; name: string; x: number };

export type RoomState = {
  status: "connecting" | "open" | "reconnecting" | "failed";
  error?: string;
  you?: Member; room?: RoomInfo; clock?: ClockState;
  members: Member[]; chat: ChatMessage[];
  picks: Record<string, Picks & { name: string }>; locked: boolean;
  result?: Result;         // live rooms: the final classification, once someone has seen it
  offset: number;          // server time minus local time (ms)
  lastClockBy?: string;
  reactions: Reaction[];
};

// ---- small per-browser identity, kept in localStorage when it's available -----
function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode: fine, it just won't be remembered */ }
}
let sessionId: string | null = null;
export function myId(): string {
  const existing = stored("pitbox.id") ?? sessionId;
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionId = id;
  store("pitbox.id", id);
  return id;
}
export const savedName = () => stored("pitbox.name") ?? "";
export const saveName = (n: string) => store("pitbox.name", n);

/** Connect to a watch room and keep the connection alive. */
export function useRoom(code: string, name: string | null) {
  const [state, setState] = useState<RoomState>({ status: "connecting", members: [], chat: [], picks: {}, locked: false, offset: 0, reactions: [] });
  const wsRef = useRef<WebSocket | null>(null);
  const samples = useRef<{ rtt: number; offset: number }[]>([]);

  useEffect(() => {
    if (!name) return;
    let closedByUs = false, retries = 0, timer: number | undefined, pinger: number | undefined;

    const connect = () => {
      const ws = new WebSocket(roomsWsUrl(`/api/rooms/${code}/ws`));
      wsRef.current = ws;
      const send = (m: ClientMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
      ws.onopen = () => {
        retries = 0;
        send({ type: "hello", id: myId(), name });
        // a few quick pings to measure the clock offset, then one every 20 s
        samples.current = [];
        [0, 250, 500, 750, 1000].forEach((d) => window.setTimeout(() => send({ type: "ping", c: Date.now() }), d));
        pinger = window.setInterval(() => send({ type: "ping", c: Date.now() }), 20_000);
      };
      ws.onmessage = (e) => {
        let m: ServerMessage;
        try { m = JSON.parse(e.data); } catch { return; }
        setState((s) => reduce(s, m, samples.current));
      };
      ws.onclose = (e) => {
        window.clearInterval(pinger);
        if (closedByUs) return;
        if (e.code === 1008 || e.code === 4404) {
          setState((s) => ({ ...s, status: "failed", error: "This room no longer exists. Start a new one." }));
          return;
        }
        retries++;
        if (retries > 8) {
          setState((s) => ({ ...s, status: "failed", error: "Lost connection to the room. Check your internet, then reload the page." }));
          return;
        }
        setState((s) => ({ ...s, status: "reconnecting" }));
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** retries));
      };
    };
    connect();
    return () => {
      closedByUs = true;
      window.clearTimeout(timer);
      window.clearInterval(pinger);
      wsRef.current?.close();
    };
  }, [code, name]);

  // reactions fade after a few seconds
  useEffect(() => {
    if (!state.reactions.length) return;
    const t = window.setTimeout(() => setState((s) => ({ ...s, reactions: s.reactions.filter((r) => Date.now() - r.key < 2600) })), 2700);
    return () => window.clearTimeout(t);
  }, [state.reactions]);

  const send = useCallback((m: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true; }
    return false;
  }, []);

  return { state, send, setState };
}

function reduce(s: RoomState, m: ServerMessage, samples: { rtt: number; offset: number }[]): RoomState {
  switch (m.type) {
    case "welcome":
      return { ...s, status: "open", error: undefined, you: m.you, room: m.room, clock: m.clock, members: m.members,
        chat: m.chat, picks: m.picks, locked: m.locked, result: m.result, offset: samples.length ? s.offset : m.now - Date.now() };
    case "members": return { ...s, members: m.members };
    case "chat": return { ...s, chat: [...s.chat, m.message].slice(-150) };
    case "react": return { ...s, reactions: [...s.reactions, { key: Date.now() + Math.random(), emoji: m.emoji, name: m.name, x: 10 + Math.random() * 80 }].slice(-20) };
    case "clock": return { ...s, clock: m.clock, lastClockBy: m.by };
    case "picks": return { ...s, picks: m.picks, locked: m.locked };
    case "result": return { ...s, result: m.result };
    case "error": return { ...s, error: m.message };
    case "pong": {
      // NTP-style: the sample with the smallest round trip gives the best offset
      const now = Date.now(), rtt = now - m.c;
      samples.push({ rtt, offset: m.s - (m.c + rtt / 2) });
      if (samples.length > 12) samples.shift();
      const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      return { ...s, offset: best.offset };
    }
  }
}

/**
 * A replay Clock driven by the room: shows the shared time, and turns play/pause/seek
 * into room messages (applied locally straight away so controls feel instant).
 */
export function useRoomClock(room: ReturnType<typeof useRoom>, start: number, end: number): Clock {
  const { state, send, setState } = room;
  const c = state.clock ?? { playing: false, speed: 4, t: start, anchor: Date.now() };
  const [, tick] = useState(0);
  useEffect(() => {
    if (!c.playing) return;
    let raf = 0;
    const loop = () => { tick((n) => n + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [c.playing]);

  const serverNow = () => Date.now() + state.offset;
  const t = clockAt(c, serverNow(), end);
  const apply = (next: Partial<ClockState>, msg: ClientMessage) => {
    setState((s) => (s.clock ? { ...s, clock: { ...s.clock, t: clockAt(s.clock, serverNow(), end), anchor: serverNow(), ...next } } : s));
    send(msg);
  };
  return {
    // rooms open a minute before the start so people can make picks; don't clamp that away
    t: Math.max(start - 120_000, t), playing: c.playing && t < end, speed: c.speed,
    play: () => apply({ playing: true, ...(t >= end ? { t: start } : {}) }, { type: "clock", op: "play" }),
    pause: () => apply({ playing: false }, { type: "clock", op: "pause" }),
    toggle: () => (c.playing && t < end
      ? apply({ playing: false }, { type: "clock", op: "pause" })
      : apply({ playing: true, ...(t >= end ? { t: start } : {}) }, { type: "clock", op: "play" })),
    seek: (v: number) => apply({ t: Math.max(start - 120_000, Math.min(end, v)) }, { type: "clock", op: "seek", t: v }),
    setSpeed: (sp: number) => apply({ speed: sp }, { type: "clock", op: "speed", speed: sp }),
  };
}
