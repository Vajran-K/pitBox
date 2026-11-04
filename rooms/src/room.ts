import { DurableObject } from "cloudflare:workers";
import {
  REACTIONS, SPEEDS, clockAt, isQualiType,
  type ChatMessage, type ClientMessage, type ClockState, type Member, type Picks, type Result, type RoomInfo, type ServerMessage,
} from "./protocol.ts";

const MAX_CHAT = 150;               // messages kept per room
const MAX_TEXT = 300;               // characters per message
const MIN_GAP_MS = 400;             // per-person chat/reaction rate limit
const IDLE_EXPIRY_MS = 24 * 3600e3; // rooms delete themselves after a day without anyone in them

type Attachment = Member & { lastSent: number };
type Stored = { info: RoomInfo; clock: ClockState; chat: ChatMessage[]; picks: Record<string, Picks & { name: string }>; result?: Result };

export interface Env { ROOMS: DurableObjectNamespace<Room>; LIVE: DurableObjectNamespace; AI?: Ai }

/**
 * One watch room. Holds the shared replay clock, chat, and predictions; fans every
 * change out to the connected browsers. Uses the WebSocket Hibernation API so an
 * idle room costs nothing while people are connected but quiet.
 */
export class Room extends DurableObject<Env> {
  private state: Stored | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<Stored>("room")) ?? null;
    });
  }

  // ---- called by the worker ------------------------------------------------
  async create(info: RoomInfo): Promise<boolean> {
    if (this.state) return false; // code already taken
    this.state = {
      info,
      clock: { playing: false, speed: 4, t: info.raceStart - 60_000, anchor: Date.now() },
      chat: [], picks: {},
    };
    await this.save();
    await this.ctx.storage.setAlarm(Math.max(Date.now(), info.kind === "live" ? info.raceEnd : 0) + IDLE_EXPIRY_MS);
    return true;
  }

  async info(): Promise<RoomInfo | null> {
    return this.state?.info ?? null;
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.state) return new Response("No such room", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- WebSocket events --------------------------------------------------------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.state || typeof raw !== "string" || raw.length > 4000) return;
    let msg: ClientMessage;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment() as Attachment | null;

    if (msg.type === "ping") return this.send(ws, { type: "pong", c: Number(msg.c) || 0, s: Date.now() });

    if (msg.type === "hello") {
      const id = cleanId(msg.id);
      const name = cleanName(msg.name);
      if (!id || !name) return this.send(ws, { type: "error", message: "Pick a name between 1 and 24 characters." });
      const att: Attachment = { id, name, colour: colourFor(id), lastSent: 0 };
      ws.serializeAttachment(att);
      if (this.state.picks[id]) this.state.picks[id].name = name;
      const s = this.state;
      this.send(ws, {
        type: "welcome", you: { id, name, colour: att.colour }, room: s.info, clock: s.clock,
        members: this.members(), chat: s.chat, picks: s.picks, locked: this.locked(), now: Date.now(),
        ...(s.result ? { result: s.result } : {}),
      });
      this.broadcast({ type: "members", members: this.members() }, ws);
      await this.ctx.storage.setAlarm(Date.now() + IDLE_EXPIRY_MS);
      return;
    }
    if (!me) return this.send(ws, { type: "error", message: "Say hello first." });

    if (msg.type === "chat" || msg.type === "react") {
      const now = Date.now();
      if (now - me.lastSent < MIN_GAP_MS) return;
      ws.serializeAttachment({ ...me, lastSent: now });
      if (msg.type === "react") {
        if (!REACTIONS.includes(msg.emoji)) return;
        return this.broadcast({ type: "react", emoji: msg.emoji, from: me.id, name: me.name });
      }
      const text = String(msg.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      if (!text) return;
      const live = this.state.info.kind === "live";
      const tag = live ? String(msg.tag ?? "").replace(/[^\w .:+/-]/g, "").slice(0, 24) : "";
      const message: ChatMessage = {
        id: crypto.randomUUID(), from: me.id, name: me.name, colour: me.colour, text,
        sentAt: now, raceT: live ? now : clockAt(this.state.clock, now, this.state.info.raceEnd),
        ...(tag ? { tag } : {}),
      };
      this.state.chat = [...this.state.chat, message].slice(-MAX_CHAT);
      await this.save();
      return this.broadcast({ type: "chat", message });
    }

    if (msg.type === "clock") {
      if (this.state.info.kind === "live") return; // live sessions have no shared clock
      const s = this.state, now = Date.now();
      const current = clockAt(s.clock, now, s.info.raceEnd);
      const lo = s.info.raceStart - 120_000, hi = s.info.raceEnd;
      let next: ClockState = { ...s.clock, t: current, anchor: now };
      if (msg.op === "play") next = { ...next, playing: true, t: current >= hi ? lo : current };
      else if (msg.op === "pause") next = { ...next, playing: false };
      else if (msg.op === "seek" && Number.isFinite(msg.t)) next = { ...next, t: Math.max(lo, Math.min(hi, Number(msg.t))) };
      else if (msg.op === "speed" && SPEEDS.includes(Number(msg.speed))) next = { ...next, speed: Number(msg.speed) };
      else return;
      s.clock = next;
      await this.save();
      const wasLocked = Object.keys(s.picks).length > 0 && this.locked();
      this.broadcast({ type: "clock", clock: next, by: me.name });
      if (wasLocked) this.broadcast({ type: "picks", picks: s.picks, locked: true });
      return;
    }

    if (msg.type === "result") {
      // live rooms only, once, and only after the session's scheduled start
      const s = this.state;
      if (s.info.kind !== "live" || s.result || Date.now() < s.info.raceStart) return;
      const r = msg.result ?? ({} as Result);
      const num = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 100 ? (v as number) : undefined);
      s.result = { winner: num(r.winner), p2: num(r.p2), p3: num(r.p3), fastestLap: num(r.fastestLap), safetyCar: r.safetyCar === true };
      if (!s.result.winner) { s.result = undefined; return; }
      await this.save();
      return this.broadcast({ type: "result", result: s.result });
    }

    if (msg.type === "predict") {
      if (this.locked()) return this.send(ws, { type: "error", message: "Predictions closed when the session started." });
      const p = msg.picks ?? {};
      const num = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 100 ? (v as number) : undefined);
      const quali = isQualiType(this.state.info.sessionType);
      this.state.picks[me.id] = {
        name: me.name, winner: num(p.winner), p2: num(p.p2), p3: num(p.p3),
        ...(quali ? {} : { fastestLap: num(p.fastestLap), safetyCar: typeof p.safetyCar === "boolean" ? p.safetyCar : undefined }),
      };
      await this.save();
      return this.broadcast({ type: "picks", picks: this.state.picks, locked: false });
    }
  }

  async webSocketClose(ws: WebSocket) {
    try { ws.close(); } catch { /* already closed */ }
    this.broadcast({ type: "members", members: this.members() }, ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    // still in use, or a live session still to come: push expiry back; otherwise clean up
    const liveAhead = this.state?.info.kind === "live" && Date.now() < this.state.info.raceEnd;
    if (this.ctx.getWebSockets().length > 0 || liveAhead) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_EXPIRY_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  // ---- helpers -------------------------------------------------------------------
  private locked(): boolean {
    const s = this.state!;
    if (s.info.kind === "live") return Date.now() >= s.info.raceStart;
    return clockAt(s.clock, Date.now(), s.info.raceEnd) >= s.info.raceStart;
  }

  private members(): Member[] {
    const seen = new Map<string, Member>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && ws.readyState === WebSocket.READY_STATE_OPEN) seen.set(a.id, { id: a.id, name: a.name, colour: a.colour });
    }
    return [...seen.values()];
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket closing */ }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(data); } catch { /* socket closing */ }
    }
  }

  private async save() {
    await this.ctx.storage.put("room", this.state);
  }
}

function cleanName(v: unknown): string {
  return String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

function cleanId(v: unknown): string {
  const s = String(v ?? "");
  return /^[a-zA-Z0-9-]{8,64}$/.test(s) ? s : "";
}

/** Stable colour slot (0-5) per person, so their chat dot doesn't change between visits. */
export function colourFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}
