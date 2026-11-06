import { CODE_ALPHABET, type RoomInfo } from "./protocol.ts";
import { Room, type Env } from "./room.ts";
import { Live } from "./live.ts";

export { Room, Live };

/**
 * PitBox rooms API.
 *   POST /api/rooms                 { session, title, raceStart, raceEnd } -> { code }
 *   GET  /api/rooms/:code           -> RoomInfo, or 404
 *   GET  /api/rooms/:code/ws        WebSocket upgrade into the room
 *   GET  /api/live/ws               WebSocket: F1 live timing, relayed
 *   GET  /api/live/state            relay status (for checking it works)
 *   GET  /api/schedule              this year's sessions (OpenF1, cached; survives OpenF1's live-session lock)
 *   GET  /api/radio?u=<clip url>    a team radio clip from F1, with CORS so the browser can transcribe it
 *   GET  /api/ai                    { available, model }: is the cloud AI model set up (deployed only)
 *   POST /api/ai/chat               { system, user, schema?, temperature? } -> { content }
 *
 * Deployed, the website and this worker are on different addresses, so every answer carries CORS headers.
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const res = await route(request, env);
    if (res.status === 101 || res.webSocket) return res; // WebSocket upgrades pass through untouched
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
};

async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "rooms", code?, "ws"?]
    if (parts[0] === "api" && parts[1] === "radio") return radio(url.searchParams.get("u") ?? "");
    if (parts[0] === "api" && parts[1] === "ai") return ai(request, env, parts[2]);
    if (parts[0] === "api" && (parts[1] === "schedule" || (parts[1] === "live" && (parts[2] === "ws" || parts[2] === "state")))) {
      // one relay for everyone: F1 sees a single connection however many people watch
      return env.LIVE.get(env.LIVE.idFromName("f1")).fetch(request);
    }
    if (parts[0] !== "api" || parts[1] !== "rooms") return json({ error: "Not found" }, 404);

    if (parts.length === 2 && request.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400); }
      const session = Number(body.session), raceStart = Number(body.raceStart), raceEnd = Number(body.raceEnd);
      const title = String(body.title ?? "").slice(0, 80);
      const kind = body.kind === "live" ? "live" : "replay";
      const sessionType = String(body.sessionType ?? "Race").replace(/[^\w ]/g, "").slice(0, 30) || "Race";
      if (!Number.isInteger(session) || session <= 0 || !Number.isFinite(raceStart) || !(raceEnd > raceStart) || !title)
        return json({ error: "A room needs a race: session, title, raceStart and raceEnd." }, 400);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const info: RoomInfo = { code, session, title, raceStart, raceEnd, createdAt: Date.now(), kind, sessionType };
        if (await env.ROOMS.get(env.ROOMS.idFromName(code)).create(info)) return json({ code }, 201);
      }
      return json({ error: "Couldn't find a free room code. Try again." }, 503);
    }

    const code = (parts[2] ?? "").toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: "Room codes are 6 letters and numbers." }, 400);
    const room = env.ROOMS.get(env.ROOMS.idFromName(code));

    if (parts.length === 3 && request.method === "GET") {
      const info = await room.info();
      return info ? json(info) : json({ error: `There's no room ${code}. Check the code, or start a new room.` }, 404);
    }
    if (parts.length === 4 && parts[3] === "ws") return room.fetch(request);
    return json({ error: "Not found" }, 404);
}

// ---- AI (Cloudflare Workers AI, free daily allowance) ---------------------------------
// Tried in order; the first that answers is remembered. Cloudflare retires models from time to
// time (llama-3.1-8b-instruct went in May 2026; llama-3.1-8b-instruct-fp8 and qwen3-30b-a3b-fp8
// go on 20 Nov 2026), so a retired or unsupported one just falls through. Small models first:
// they cost the fewest free-allowance neurons per question.
const AI_MODELS = [
  { id: "@cf/google/gemma-4-26b-a4b-it", name: "Gemma 4 26B" },
  { id: "@cf/qwen/qwen3.8-27b", name: "Qwen3.8 27B" },
  { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1" },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B" },
];
let working = 0; // index into AI_MODELS of the model that last worked
const recent = new Map<string, number[]>(); // per-visitor request times, this instance only

/** Model output, as text: unwraps objects, and drops reasoning blocks and ```json fences. */
function asText(r: unknown): string {
  if (r && typeof r === "object") return JSON.stringify(r);
  return String(r ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
}

/**
 * The deployed site's language model. PitBox only ever asks it to turn a question into a small
 * query or to reword facts PitBox computed, so prompts are capped and visitors are rate limited
 * to keep everyone inside the free allowance.
 */
async function ai(request: Request, env: Env, action?: string): Promise<Response> {
  if (!action) return json({ available: !!env.AI, model: env.AI ? `${AI_MODELS[working].name} (Cloudflare Workers AI)` : null });
  if (action !== "chat" || request.method !== "POST") return json({ error: "Not found" }, 404);
  if (!env.AI) return json({ error: "The AI model isn't set up on this server." }, 503);
  const who = request.headers.get("CF-Connecting-IP") ?? "local";
  const now = Date.now();
  const times = (recent.get(who) ?? []).filter((t) => now - t < 10 * 60e3);
  if (times.length >= 40) return json({ error: "Too many AI requests. Try again in a few minutes." }, 429);
  recent.set(who, [...times, now]);
  if (recent.size > 5000) recent.clear();

  let body: { system?: unknown; user?: unknown; schema?: unknown; temperature?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400); }
  const system = String(body.system ?? "").slice(0, 8000), user = String(body.user ?? "").slice(0, 6000);
  if (!user) return json({ error: "Nothing to answer." }, 400);
  const temperature = Math.max(0, Math.min(1, Number(body.temperature ?? 0.1) || 0));
  const schema = body.schema && typeof body.schema === "object" ? body.schema : null;
  const errors: string[] = [];
  for (let k = 0; k < AI_MODELS.length; k++) {
    const i = (working + k) % AI_MODELS.length;
    const m = AI_MODELS[i];
    try {
      const out = await env.AI.run(m.id as never, {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature, max_tokens: 700,
        ...(schema ? { response_format: { type: "json_schema", json_schema: schema } } : {}),
      } as never) as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
      const content = asText(out?.response ?? out?.choices?.[0]?.message?.content);
      if (!content) throw new Error("empty answer");
      if (schema) JSON.parse(content); // a model that ignored the schema counts as a failure
      working = i;
      return json({ content, model: m.name });
    } catch (e) {
      errors.push(`${m.id}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  console.log("ai: every model failed", errors);
  return json({ error: `The AI model couldn't answer. ${errors[0] ?? ""}` }, 502);
}

/** Team radio clips live on F1's static host, which doesn't send CORS headers. Only those clips are passed through. */
async function radio(u: string): Promise<Response> {
  let target: URL;
  try { target = new URL(u); } catch { return json({ error: "Bad clip address." }, 400); }
  if (target.protocol !== "https:" || target.hostname !== "livetiming.formula1.com" || !/^\/static\/[\w./-]+\.mp3$/.test(target.pathname))
    return json({ error: "Only F1 team radio clips can be fetched." }, 400);
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(target.toString()).catch(() => undefined);
  const res = hit ?? await fetch(target.toString(), { headers: { "User-Agent": "PitBox/0.1 (personal project)" } });
  if (!res.ok) return json({ error: `F1 returned ${res.status} for that clip.` }, 502);
  const out = new Response(res.body, { headers: {
    "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*",
  } });
  if (!hit && cache) await cache.put(target.toString(), out.clone()).catch(() => undefined);
  return out;
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
