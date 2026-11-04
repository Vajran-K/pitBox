import { useEffect, useSyncExternalStore } from "react";
import { ROOMS_BASE } from "./roomProtocol";

/**
 * Team radio transcripts. Clips are fetched through the rooms server (F1's file host doesn't
 * allow browsers to read them directly), decoded to 16 kHz mono, and run through Whisper in a
 * Web Worker, one at a time, newest first. Results are kept for the visit.
 */

export type Transcript = { status: "queued" | "working" | "done" | "error"; text?: string; error?: string };
type Model = { state: "idle" | "loading" | "ready" | "error"; progress: number; device?: string; error?: string };

const transcripts = new Map<string, Transcript>();
let model: Model = { state: "idle", progress: 0 };
let enabled = readEnabled();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

function readEnabled(): boolean {
  try { return localStorage.getItem("pitbox.transcripts") === "on"; } catch { return false; }
}
export function setTranscriptsEnabled(on: boolean) {
  enabled = on;
  try { localStorage.setItem("pitbox.transcripts", on ? "on" : "off"); } catch { /* not remembered */ }
  emit();
  if (on) pump();
}

let worker: Worker | null = null;
const waiting = new Map<string, (r: { text?: string; error?: string }) => void>();
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), { type: "module" });
  if (model.state === "idle") { model = { state: "loading", progress: 0 }; emit(); }
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") { model = { ...model, state: "loading", progress: m.total ? m.loaded / m.total : 0 }; emit(); }
    else if (m.type === "ready") { model = { state: "ready", progress: 1, device: m.device }; emit(); }
    else if (m.type === "done" || m.type === "error") {
      if (m.type === "error" && !m.id) { model = { ...model, state: "error", error: m.message }; emit(); }
      const cb = m.id ? waiting.get(m.id) : undefined;
      if (cb) { waiting.delete(m.id); cb(m.type === "done" ? { text: m.text } : { error: m.message }); }
    }
  };
  worker.onerror = (e) => { model = { ...model, state: "error", error: e.message || "The speech model couldn't start." }; emit(); };
  return worker;
}

/** Where the browser fetches a clip from: through the rooms server. */
export const radioProxyUrl = (url: string) => `${ROOMS_BASE}/api/radio?u=${encodeURIComponent(url)}`;

async function decode(url: string): Promise<Float32Array> {
  const res = await fetch(radioProxyUrl(url));
  if (!res.ok) throw new Error(`Couldn't get the clip (${res.status}).`);
  const buf = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 16000, 16000);
  const audio = await ctx.decodeAudioData(buf);
  // mix to mono and resample to 16 kHz
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

const queue: string[] = [];
let busy = false;
async function pump() {
  if (busy || !enabled) return;
  const url = queue.pop(); // newest first
  if (!url) return;
  busy = true;
  transcripts.set(url, { status: "working" }); emit();
  try {
    const audio = await decode(url);
    const r = await new Promise<{ text?: string; error?: string }>((resolve) => {
      const id = Math.random().toString(36).slice(2);
      waiting.set(id, resolve);
      getWorker().postMessage({ id, audio }, [audio.buffer]);
    });
    transcripts.set(url, r.error ? { status: "error", error: r.error } : { status: "done", text: cleanup(r.text ?? "") });
  } catch (e) {
    transcripts.set(url, { status: "error", error: (e as Error).message });
  } finally {
    busy = false; emit(); pump();
  }
}

/** Whisper marks silence and noise in brackets; radio is mostly that between words. */
export function cleanup(text: string): string {
  const t = text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return t || "(no speech)";
}

function request(url: string) {
  if (transcripts.has(url) || queue.includes(url)) return;
  queue.push(url);
  transcripts.set(url, { status: "queued" });
}

/** Transcripts for these clips (requested when transcripts are on), plus the model's state. */
export function useTranscripts(urls: string[]) {
  useSyncExternalStore(subscribe, () => version);
  const key = urls.join("|");
  useEffect(() => {
    if (!enabled) return;
    urls.slice().reverse().forEach(request); // queue oldest first; the newest is taken first
    emit(); pump();
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { enabled, model, get: (url: string) => transcripts.get(url) };
}
