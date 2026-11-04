import { useEffect, useState } from "react";
import type { Meta, Timing } from "../data";
import { AiUnavailable, isCloud, listModels, pickModel, saveModel, savedModel } from "../lib/ai";
import { useChat } from "./GlobalChat";
import type { Answer } from "../lib/ask";
import { recapFacts, writeRecap } from "../lib/recap";
import { eventName } from "../lib/format";
import LineChart from "../charts/LineChart";
import SearchBox from "./SearchBox";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

export type ModelState = ReturnType<typeof useModel>;

export function useModel() {
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  useEffect(() => {
    listModels().then(
      (m) => { setModels(m); setModel(pickModel(m, savedModel())); if (!m.length) setOffline("Ollama is running but has no models. Run: ollama pull qwen2.5:7b"); },
      (e: Error) => { setModels([]); setOffline(e.message); },
    );
  }, []);
  return { models, model, setModel: (m: string) => { setModel(m); saveModel(m); }, offline, setOffline };
}

function examples(meta: Meta): string[] {
  const [a, b] = meta.result.slice(0, 2).map((r) => meta.drivers.find((d) => d.number === r.driver_number)?.code ?? "");
  return [`${a} vs ${b} lap times`, `Tyre degradation for ${a} and ${b}`, `Gap between ${a} and ${b}`, "Who had the quickest pit stops?", "Best sector times"];
}

/** Race-page entry to the site-wide chat, plus the written recap. */
export default function AskPanel({ meta, timing }: { meta: Meta; timing: Timing }) {
  const ai = useModel();
  const chat = useChat();
  const title = `${eventName(meta.country, meta.type, meta.name, meta.meetingName)} ${meta.year}`;
  const ex = examples(meta);
  return (
    <section className="ask" id="ask">
      <h2>Ask about this race</h2>
      <div className="panel ask-intro">
        <p>Chat with PitBox about the {title}. It answers from this race's data: every number in a reply is worked out by PitBox, not made up by the AI.</p>
        <div className="buttons">
          <button className="button" onClick={() => chat.openChat(undefined, meta.key)}>Chat about this race</button>
        </div>
        <div className="chips">{ex.map((e) => <button key={e} className="chip" onClick={() => chat.openChat(e, meta.key)}>{e}</button>)}</div>
      </div>
      <Recap meta={meta} timing={timing} ai={ai} />
    </section>
  );
}

export function ModelLine({ ai }: { ai: ModelState }) {
  const [changing, setChanging] = useState(false);
  if (ai.models === null) return <p className="chart-note">Looking for a local AI model…</p>;
  if (ai.offline) return <p className="chart-note">AI model unavailable: {ai.offline}. Simple questions still work with the built-in reader.</p>;
  return (
    <div className="model-line">
      {changing ? (
        <SearchBox label="Model" value={ai.model ?? ""} placeholder="Installed models"
          search={(q) => ai.models!.filter((m) => m.includes(q.trim())).map((m) => ({ key: m, label: m }))}
          onPick={(o) => { ai.setModel(o.key); setChanging(false); }} />
      ) : (
        isCloud(ai.model)
          ? <p className="chart-note">Using a free AI model on <strong>Cloudflare Workers AI</strong>. Every number still comes from PitBox's own calculations.</p>
          : <p className="chart-note">Using <strong>{ai.model}</strong> on this computer through Ollama. <button className="link-button" onClick={() => setChanging(true)}>Change model</button></p>
      )}
    </div>
  );
}

export function AnswerView({ answer }: { answer: Answer }) {
  if (answer.kind === "none") return <p>{answer.message}</p>;
  if (answer.kind === "table") return (
    <>
      <h3>{answer.title}</h3>
      <table className="results">
        <thead><tr>{answer.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{answer.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? "num" : undefined}>{v}</td>)}</tr>)}</tbody>
      </table>
      <p className="chart-note">{answer.summary}</p>
    </>
  );
  const drivers = [...new Set(answer.series.map((s) => s.driver))];
  const colourOf = (d: number, i: number) => SERIES[drivers.indexOf(d)] ?? `var(--m${(drivers.indexOf(d) + i) % 6})`;
  return (
    <>
      <h3>{answer.title}</h3>
      {answer.series.every((s) => !s.points.length) ? <p className="muted">No laps match.</p> : (
        <LineChart
          series={answer.series.map((s, i) => ({ id: s.id, label: s.label, colour: colourOf(s.driver, i), points: s.points }))}
          xLabel={(x) => (answer.xLabel === "lap" ? (x === 0 ? "Grid" : `Lap ${x}`) : `${x} laps old`)}
          yLabel={answer.yLabel} height={300} reverseY={answer.reverseY} fitY={!answer.reverseY} zeroLine={answer.zeroLine} />
      )}
      <p className="chart-note">{answer.summary}</p>
    </>
  );
}

function Recap({ meta, timing, ai }: { meta: Meta; timing: Timing; ai: ModelState }) {
  const [text, setText] = useState<string | null>(null);
  const [dropped, setDropped] = useState<{ text: string; issues: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = `${eventName(meta.country, meta.type, meta.name, meta.meetingName)} ${meta.year}`;
  const facts = recapFacts(meta, timing, title);
  const write = async () => {
    if (!ai.model) return;
    setBusy(true); setError(null);
    try {
      const r = await writeRecap(ai.model, facts);
      setText(r.text); setDropped(r.dropped);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof AiUnavailable) ai.setOffline(e.message);
    } finally { setBusy(false); }
  };
  return (
    <div className="panel recap">
      <h3>Race recap</h3>
      <div className="recap-grid">
        <div>
          {text ? text.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>) : (
            <p className="muted">{ai.offline ? (import.meta.env.PROD ? "The AI model isn't available right now, so recaps are off." : "Start Ollama to have these facts written up as a short recap.") : "Turn the facts into a short written recap."}</p>
          )}
          {!ai.offline && ai.model && <button className="button secondary" onClick={write} disabled={busy}>{busy ? "Writing…" : text ? "Write it again" : "Write the recap"}</button>}
          {error && <p className="chart-note">{error}</p>}
          {text && <p className="chart-note">Written by {ai.model} from the facts on the right; every sentence was checked against the facts it cites.</p>}
          {text && dropped.length > 0 && (
            <details className="chart-note">
              <summary>{dropped.length} {dropped.length === 1 ? "sentence" : "sentences"} left out for saying more than the facts</summary>
              <ul>{dropped.map((d) => <li key={d.text}>{d.text} <span className="warn">({d.issues.join(", ")})</span></li>)}</ul>
            </details>
          )}
        </div>
        <div>
          <p className="muted facts-head">The facts it's given</p>
          <ul className="facts">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
