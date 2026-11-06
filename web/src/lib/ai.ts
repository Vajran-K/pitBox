import { ROOMS_BASE } from "./roomProtocol";

/**
 * Language model access, behind one small chat() function:
 *  - development: Ollama on this machine (free, private), through the Vite proxy at /ollama;
 *  - deployed: Cloudflare Workers AI through the rooms worker (free daily allowance).
 * Ollama is tried first; the cloud model is used when Ollama isn't there.
 */
export const CLOUD_MODEL = "cloud:workers-ai"; // the rooms server picks the actual model
export const isCloud = (model: string | null | undefined) => !!model?.startsWith("cloud:");
let lastCloudModel: string | null = null; // the model the rooms server actually used last
/** How to name a model in the chat: the cloud one by the model that answered. */
export const modelLabel = (model: string) => (isCloud(model) ? `${lastCloudModel ?? "Cloudflare Workers AI"}${lastCloudModel ? " on Cloudflare" : ""}` : model);
// a deployed site has no /ollama proxy; asking would just fetch the app's own page
const tryOllama = !import.meta.env.PROD || !!import.meta.env.VITE_OLLAMA;

let OLLAMA = "/ollama";
/** Point at Ollama directly (used by the offline eval script, which has no Vite proxy). */
export function setOllamaBase(url: string) { OLLAMA = url.replace(/\/$/, ""); }
const PREFERRED = ["qwen2.5:7b", "qwen2.5", "llama3.1:8b", "llama3.1", "gemma2:9b", "llama3.2", "mistral", "qwen2.5:3b", "phi3"];

export class AiUnavailable extends Error {}

export async function listModels(): Promise<string[]> {
  if (tryOllama) {
    const res = await fetch(`${OLLAMA}/api/tags`).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (body?.models?.length) return body.models.map((m: { name: string }) => m.name);
  }
  const cloud = await fetch(`${ROOMS_BASE}/api/ai`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (cloud?.available) return [CLOUD_MODEL];
  throw new AiUnavailable(import.meta.env.PROD
    ? "The AI model isn't available right now"
    : "Ollama isn't running. Install it from ollama.com, then run: ollama pull qwen2.5:7b");
}

export function pickModel(models: string[], saved?: string | null): string | null {
  if (saved && models.includes(saved)) return saved;
  for (const p of PREFERRED) {
    const hit = models.find((m) => m === p || m.startsWith(p + ":") || m.startsWith(p));
    if (hit) return hit;
  }
  return models[0] ?? null;
}

export function savedModel(): string | null {
  try { return localStorage.getItem("pitbox.model"); } catch { return null; }
}
export function saveModel(m: string) {
  try { localStorage.setItem("pitbox.model", m); } catch { /* not remembered */ }
}

/** One chat call. With `schema`, Ollama constrains the reply to that JSON shape. */
export async function chat(opts: { model: string; system: string; user: string; schema?: object; temperature?: number; signal?: AbortSignal }): Promise<string> {
  if (isCloud(opts.model)) {
    const res = await fetch(`${ROOMS_BASE}/api/ai/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: opts.signal,
      body: JSON.stringify({ system: opts.system, user: opts.user, schema: opts.schema, temperature: opts.temperature ?? 0.1 }),
    }).catch((e) => { if ((e as Error).name === "AbortError") throw e; return null; });
    if (!res) throw new AiUnavailable("Couldn't reach the AI model.");
    const body = await res.json().catch(() => ({}));
    if (res.status === 503) throw new AiUnavailable(body.error ?? "The AI model isn't available.");
    if (!res.ok) throw new Error(body.error ?? `The AI model returned an error (${res.status}).`);
    if (body.model) lastCloudModel = String(body.model);
    return String(body.content ?? "");
  }
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model, stream: false,
      messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
      ...(opts.schema ? { format: opts.schema } : {}),
      options: { temperature: opts.temperature ?? 0.1 },
    }),
  }).catch((e) => { if ((e as Error).name === "AbortError") throw e; return null; });
  if (!res) throw new AiUnavailable("Couldn't reach Ollama. Is it running?");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 404) throw new AiUnavailable(`The model "${opts.model}" isn't installed. Run: ollama pull ${opts.model}`);
    throw new Error(`Ollama returned an error (${res.status}). ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  return String(body.message?.content ?? "");
}
