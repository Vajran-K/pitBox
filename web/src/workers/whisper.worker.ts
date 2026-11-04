/// <reference lib="webworker" />
/**
 * Speech to text for team radio, in the browser (Whisper via transformers.js). The model is
 * downloaded once from Hugging Face and cached by the browser; nothing is sent to a server.
 */
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-base.en";
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

type In = { id: string; audio: Float32Array };
type Out =
  | { type: "progress"; loaded: number; total: number; file: string }
  | { type: "ready"; device: string }
  | { type: "done"; id: string; text: string }
  | { type: "error"; id?: string; message: string };

const post = (m: Out) => (self as unknown as Worker).postMessage(m);

async function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  const gpu = "gpu" in navigator && !!(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter().catch(() => null));
  const device = gpu ? "webgpu" : "wasm";
  const files = new Map<string, { loaded: number; total: number }>();
  const p = (await pipeline("automatic-speech-recognition", MODEL, {
    device,
    dtype: gpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status === "progress" && e.file) {
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
        const all = [...files.values()];
        post({ type: "progress", loaded: all.reduce((a, f) => a + f.loaded, 0), total: all.reduce((a, f) => a + f.total, 0), file: e.file });
      }
    },
  })) as AutomaticSpeechRecognitionPipeline;
  post({ type: "ready", device });
  return p;
}

self.onmessage = async (e: MessageEvent<In>) => {
  const { id, audio } = e.data;
  try {
    asr ??= load();
    const run = await asr;
    const out = await run(audio, { chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
    post({ type: "done", id, text });
  } catch (err) {
    asr = null;
    post({ type: "error", id, message: (err as Error).message });
  }
};
