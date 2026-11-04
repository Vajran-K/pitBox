import { useEffect, useRef, useState } from "react";
import type { Meta, Timing } from "../data";
import { AiUnavailable } from "../lib/ai";
import { describeSpec } from "../lib/ask";
import { reply, type BotTurn, type Turn } from "../lib/chat";
import { AnswerView, ModelLine, type ModelState } from "./AskPanel";

/** Side panel chat about one race. The conversation is kept by the parent, so closing it doesn't lose anything. */
export default function ChatDrawer({ meta, timing, title, ai, open, onClose, turns, setTurns, examples, pending, clearPending, switcher }: {
  meta: Meta; timing: Timing; title: string; ai: ModelState; open: boolean; onClose: () => void;
  turns: Turn[]; setTurns: (f: (t: Turn[]) => Turn[]) => void; examples: string[];
  pending: string | null; clearPending: () => void; switcher?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const send = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setText(""); setBusy(true);
    const history = turns;
    setTurns((t) => [...t, { role: "user", text: q }]);
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      const bot = await reply({
        q, history, meta, timing, title, model: ai.offline ? null : ai.model, signal: ctrl.signal,
        onModelError: (e) => { if (e instanceof AiUnavailable) ai.setOffline(e.message); },
      });
      setTurns((t) => [...t, bot]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setTurns((t) => [...t, { role: "bot", text: `Something went wrong: ${(e as Error).message}`, spec: null, answer: null, facts: [], via: "", worded: "summary" }]);
    } finally { setBusy(false); }
  };

  // a question chosen from the race page (an example chip) is sent as soon as the panel opens
  useEffect(() => {
    if (open && pending && !busy) { const q = pending; clearPending(); send(q); }
  }, [open, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [turns.length, busy]);
  useEffect(() => () => abort.current?.abort(), []);

  if (!open) return null;
  return (
    <aside className="chat" role="dialog" aria-label={`Chat about the ${title}`}>
      <header className="chat-head">
        <div>
          <strong>Ask PitBox</strong>
          <span className="muted"> · {title}</span>
        </div>
        <div className="chat-actions">
          {turns.length > 0 && <button className="link-button" onClick={() => { abort.current?.abort(); setTurns(() => []); setBusy(false); }}>New chat</button>}
          <button className="chat-close" onClick={onClose} aria-label="Close chat">×</button>
        </div>
      </header>
      {switcher && <div className="chat-switch">{switcher}</div>}

      <div className="chat-body" aria-live="polite">
        {turns.length === 0 && (
          <div className="chat-empty">
            <p>Ask anything about this race: who won and who led, retirements, lap times, gaps, tyres, pit stops, sectors. Follow-ups work too ("now add Leclerc", "only laps 20 to 40").</p>
            <div className="chips">{examples.map((e) => <button key={e} className="chip" onClick={() => send(e)}>{e}</button>)}</div>
          </div>
        )}
        {turns.map((t, i) => t.role === "user"
          ? <p key={i} className="bubble user">{t.text}</p>
          : <BotBubble key={i} turn={t} meta={meta} />)}
        {busy && <p className="bubble bot typing" aria-label="PitBox is answering"><span /><span /><span /></p>}
        <div ref={end} />
      </div>

      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this race…" aria-label="Message" />
        <button className="button" disabled={busy || !text.trim()}>Send</button>
      </form>
      <div className="chat-foot"><ModelLine ai={ai} /></div>
    </aside>
  );
}

function BotBubble({ turn, meta }: { turn: BotTurn; meta: Meta }) {
  const showChart = turn.answer && turn.answer.kind !== "none";
  return (
    <div className="bubble bot">
      <p>{turn.text}</p>
      {showChart && <div className="chat-answer"><AnswerView answer={turn.answer!} /></div>}
      {turn.spec && (
        <details className="chat-meta">
          <summary>
            {turn.spec.chart === "race_facts" ? "From the race facts" : `Read as: ${describeSpec(turn.spec, meta)}`}
            {" · "}{turn.via}{turn.worded === "summary" && turn.via !== "built-in reader" ? ", PitBox's own summary" : ""}
          </summary>
          <ul className="facts">{turn.facts.map((f) => <li key={f}>{f}</li>)}</ul>
          <p className="muted">{turn.worded === "model" ? "The reply was checked against these computed facts." : "Shown as computed; the model's wording didn't match the facts exactly or no model is running."}</p>
        </details>
      )}
    </div>
  );
}
