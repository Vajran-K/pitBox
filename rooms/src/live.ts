import { DurableObject } from "cloudflare:workers";
import {
  F1_HOST, HANDSHAKE, PING, SUBSCRIBE, applyFeed, applyKeyframes, frames,
  type LiveMessage, type LiveState, type UpstreamStatus,
} from "./livefeed.ts";
import type { Env } from "./room.ts";

const UA = "PitBox/0.1 (personal project)";
const IDLE_MS = 60_000; // drop the F1 connection a minute after the last viewer leaves

/**
 * Relays F1's live timing to browsers. Connects to F1 only while someone is watching,
 * keeps the merged state so late joiners get a full picture, and forwards each update.
 * Browsers can't do this themselves: F1's negotiate step doesn't allow other origins.
 */
export class Live extends DurableObject<Env> {
  private state: LiveState = {};
  private upstream: WebSocket | null = null;
  private status: UpstreamStatus = "offline";
  private clients = new Set<WebSocket>();
  private pinger: ReturnType<typeof setInterval> | null = null;
  private retries = 0;
  private connecting: Promise<void> | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/schedule")) return this.schedule();
    if (url.pathname.endsWith("/state")) {
      return Response.json({ upstream: this.status, viewers: this.clients.size, topics: Object.keys(this.state) });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.clients.add(server);
    const drop = () => { this.clients.delete(server); if (!this.clients.size) this.ctx.storage.setAlarm(Date.now() + IDLE_MS); };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);
    this.send(server, { type: "snapshot", state: this.state, upstream: this.status, at: Date.now() });
    this.ensureUpstream();
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    if (this.clients.size) return;
    this.closeUpstream();
  }

  // ---- schedule ---------------------------------------------------------------------
  /**
   * This year's sessions from OpenF1, refreshed at most every 30 minutes. OpenF1 locks its
   * whole API while a session is live, so the last good copy is kept in storage and served then.
   */
  private async schedule(): Promise<Response> {
    const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" };
    type Cached = { fetched: number; sessions: unknown[] };
    const cached = await this.ctx.storage.get<Cached>("schedule");
    if (cached && Date.now() - cached.fetched < 30 * 60e3) return new Response(JSON.stringify(cached), { headers });
    try {
      const year = new Date().getUTCFullYear();
      const get = async (path: string) => {
        const r = await fetch(`https://api.openf1.org/v1/${path}?year=${year}`, { headers: { "User-Agent": UA } });
        if (!r.ok) throw new Error(`OpenF1 ${r.status}`);
        return r.json<Record<string, unknown>[]>();
      };
      const [sessions, meetings] = await Promise.all([get("sessions"), get("meetings")]);
      const names = new Map(meetings.map((m) => [m.meeting_key, m.meeting_name]));
      const out: Cached = {
        fetched: Date.now(),
        sessions: sessions.filter((x) => !x.is_cancelled).map((x) => ({
          key: x.session_key, name: x.session_name, type: x.session_type, country: x.country_name, circuit: x.circuit_short_name,
          meetingKey: x.meeting_key, meetingName: names.get(x.meeting_key) ?? null, start: x.date_start, end: x.date_end,
        })),
      };
      await this.ctx.storage.put("schedule", out);
      return new Response(JSON.stringify(out), { headers });
    } catch (e) {
      if (cached) return new Response(JSON.stringify({ ...cached, stale: true }), { headers });
      return new Response(JSON.stringify({ error: (e as Error).message, sessions: [] }), { status: 502, headers });
    }
  }

  // ---- F1 side -------------------------------------------------------------------
  private ensureUpstream() {
    if (this.upstream || this.connecting) return;
    this.connecting = this.connectUpstream().finally(() => { this.connecting = null; });
  }

  private async connectUpstream() {
    this.setStatus("connecting");
    try {
      const neg = await fetch(`https://${F1_HOST}/signalrcore/negotiate?negotiateVersion=1`, { method: "POST", headers: { "User-Agent": UA } });
      if (!neg.ok) throw new Error(`negotiate ${neg.status}`);
      const body = await neg.json<{ connectionToken?: string; connectionId?: string }>();
      const token = body.connectionToken ?? body.connectionId;
      if (!token) throw new Error("no connection token");
      const h = neg.headers as Headers & { getSetCookie?: () => string[] };
      const setCookies = h.getSetCookie?.() ?? (h.get("set-cookie") ? [h.get("set-cookie")!] : []);
      const cookies = setCookies.map((c: string) => c.split(";")[0]).join("; ");
      const res = await fetch(`https://${F1_HOST}/signalrcore?id=${encodeURIComponent(token)}`, {
        headers: { Upgrade: "websocket", "User-Agent": UA, ...(cookies ? { Cookie: cookies } : {}) },
      });
      const ws = res.webSocket;
      if (!ws) throw new Error(`upgrade refused (${res.status})`);
      ws.accept();
      this.upstream = ws;
      ws.addEventListener("message", (e) => this.onUpstream(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)));
      ws.addEventListener("close", () => this.onUpstreamClosed());
      ws.addEventListener("error", () => this.onUpstreamClosed());
      ws.send(HANDSHAKE);
      ws.send(SUBSCRIBE);
      this.pinger = setInterval(() => { try { ws.send(PING); } catch { /* closing */ } }, 15_000);
      this.retries = 0;
      this.setStatus("connected");
    } catch (e) {
      console.log("live: connect failed", (e as Error).message);
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  private onUpstream(raw: string) {
    for (const rec of frames(raw) as { type?: number; target?: string; arguments?: unknown[]; result?: Record<string, unknown> }[]) {
      if (rec.type === 3 && rec.result) {
        this.state = applyKeyframes({}, rec.result);
        this.broadcast({ type: "snapshot", state: this.state, upstream: this.status, at: Date.now() });
      } else if (rec.type === 1 && rec.target === "feed" && Array.isArray(rec.arguments)) {
        const [topic, data, ts] = rec.arguments as [string, unknown, string];
        this.state = applyFeed(this.state, topic, data);
        this.broadcast({ type: "feed", topic, data, ts });
      } else if (rec.type === 7) {
        this.upstream?.close();
      }
    }
  }

  private onUpstreamClosed() {
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
    this.upstream = null;
    this.setStatus("offline");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.clients.size) return;
    this.retries++;
    setTimeout(() => this.clients.size && this.ensureUpstream(), Math.min(60_000, 2_000 * 2 ** this.retries));
  }

  private closeUpstream() {
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
    try { this.upstream?.close(1000, "no viewers"); } catch { /* already closed */ }
    this.upstream = null;
    this.status = "offline";
  }

  // ---- browser side ----------------------------------------------------------------
  private setStatus(s: UpstreamStatus) {
    this.status = s;
    this.broadcast({ type: "status", upstream: s });
  }

  private send(ws: WebSocket, msg: LiveMessage) {
    try { ws.send(JSON.stringify(msg)); } catch { this.clients.delete(ws); }
  }

  private broadcast(msg: LiveMessage) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      try { ws.send(data); } catch { this.clients.delete(ws); }
    }
  }
}
