import { useEffect, useRef, useState } from "react";
import { teamColour, type Driver } from "../data";
import { properName } from "../lib/format";
import { POINTS, scorePicks, type Outcome } from "../lib/predictions";
import { REACTIONS, type ChatMessage, type Picks } from "../lib/roomProtocol";
import { rank } from "../lib/search";
import type { RoomState, useRoom } from "../lib/useRoom";
import SearchBox, { type Option } from "./SearchBox";

type Room = ReturnType<typeof useRoom>;

export function RoomBar({ state, code }: { state: RoomState; code: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/room/${code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("Copy this link", link); }
  };
  const status = state.status === "open" ? null : state.status === "connecting" ? "Connecting…" : state.status === "reconnecting" ? "Reconnecting…" : "Disconnected";
  return (
    <span className="room-bar">
      <span>Room <strong className="room-code">{code}</strong></span>
      <button className="link-button" onClick={copy}>{copied ? "Link copied" : "Copy invite link"}</button>
      <span className="members" aria-label={`${state.members.length} watching`}>
        {state.members.map((m) => <span key={m.id} className="member"><span className={`dot m${m.colour}`} />{m.name}{m.id === state.you?.id ? " (you)" : ""}</span>)}
      </span>
      {status && <span className="conn">{status}</span>}
      {state.lastClockBy && state.status === "open" && <span className="muted">Last change by {state.lastClockBy}</span>}
    </span>
  );
}

export function Reactions({ state }: { state: RoomState }) {
  return (
    <div className="reaction-layer" aria-hidden>
      {state.reactions.map((r) => (
        <span key={r.key} className="reaction" style={{ left: `${r.x}%` }}>{r.emoji}<small>{r.name}</small></span>
      ))}
    </div>
  );
}

/**
 * Room chat: your messages on the right, everyone else's on the left. `label` says where
 * the session was when a message was sent; `tag` (live rooms) is sent along with new messages.
 */
export function RoomChat({ room, label, tag, hint }: { room: Room; label: (m: ChatMessage) => string; tag?: () => string | undefined; hint: string }) {
  const { state, send } = room;
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [state.chat.length]);
  const submit = () => { if (text.trim() && send({ type: "chat", text, ...(tag ? { tag: tag() } : {}) })) setText(""); };
  return (
    <div className="panel room-chat">
      <div className="room-chat-head">
        <h2>Chat</h2>
        <span className="muted">{state.members.length} watching</span>
      </div>
      <ol className="msgs" ref={list} aria-live="polite">
        {state.chat.length === 0 && <li className="msgs-empty muted">{hint}</li>}
        {state.chat.map((m, i) => {
          const mine = m.from === state.you?.id;
          const prev = state.chat[i - 1];
          const first = !prev || prev.from !== m.from;
          return (
            <li key={m.id} className={`msg ${mine ? "mine" : "theirs"}${first ? " first" : ""}`}>
              {first && (
                <span className="msg-meta">
                  {!mine && <span className={`dot m${m.colour}`} />}
                  <strong>{mine ? "You" : m.name}</strong>
                  <span>· {label(m)}</span>
                </span>
              )}
              <p className="msg-bubble" title={label(m)}>{m.text}</p>
            </li>
          );
        })}
      </ol>
      <div className="react-row" role="group" aria-label="Reactions">
        {REACTIONS.map((e) => <button key={e} onClick={() => send({ type: "react", emoji: e })} aria-label={`React ${e}`}>{e}</button>)}
      </div>
      <form className="room-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input value={text} maxLength={300} placeholder="Message the room" aria-label="Message" onChange={(e) => setText(e.target.value)} />
        <button className="button" disabled={!text.trim() || state.status !== "open"}>Send</button>
      </form>
      {state.error && state.status === "open" && <p className="chart-note">{state.error}</p>}
    </div>
  );
}

/**
 * Call the result before the start; everyone's picks show once they lock and are scored at the end.
 * Races: winner, P2, P3, fastest lap, safety car. Qualifying: pole, P2, P3.
 */
export function PicksPanel({ room, drivers, quali, locked, finished, outcome, lockNote }: {
  room: Room; drivers: Driver[]; quali: boolean; locked: boolean; finished: boolean; outcome: Outcome | null; lockNote: string;
}) {
  const { state, send } = room;
  const byNumber = new Map(drivers.map((d) => [d.number, d]));
  const mine = state.you ? state.picks[state.you.id] : undefined;
  const [draft, setDraft] = useState<Picks>({});
  useEffect(() => { if (mine) setDraft(mine); }, [mine?.winner, mine?.p2, mine?.p3, mine?.fastestLap, mine?.safetyCar]); // eslint-disable-line react-hooks/exhaustive-deps
  const options: Option[] = drivers.map((d) => ({ key: String(d.number), label: `${d.code}  ${properName(d.name)}`, detail: d.team, swatch: teamColour(d) }));
  const label = (n?: number) => { const d = n != null ? byNumber.get(n) : undefined; return d ? `${d.code}  ${properName(d.name)}` : ""; };
  const code = (n?: number) => (n != null ? byNumber.get(n)?.code ?? `#${n}` : "–");
  const picker = (slot: "winner" | "p2" | "p3" | "fastestLap", text: string) => (
    <SearchBox key={slot} label={text} value={label(draft[slot])} placeholder={drivers.length ? "Pick a driver" : "Drivers appear when F1 publishes the entry list"}
      search={(q) => (q.trim() ? rank(options, q, (o) => `${o.label} ${o.detail} ${o.key}`, undefined, 24) : options)}
      onPick={(o) => setDraft((p) => ({ ...p, [slot]: Number(o.key) }))} />
  );
  const people = Object.entries(state.picks);
  const first = quali ? "Pole" : "Winner";

  if (!locked) {
    const keys: (keyof Picks)[] = quali ? ["winner", "p2", "p3"] : ["winner", "p2", "p3", "fastestLap", "safetyCar"];
    const saved = mine && keys.every((k) => mine[k] === draft[k]);
    return (
      <div className="panel predictions">
        <h2>{quali ? "Call the grid" : "Call the race"}</h2>
        <p className="muted">
          {lockNote} Scored at the end: exact {first.toLowerCase()} {POINTS.exact.winner}, exact P2 or P3 {POINTS.exact.p2}, right driver in the wrong top-three spot 1
          {quali ? "." : `, fastest lap ${POINTS.fastestLap}, safety car call ${POINTS.safetyCar}.`}
        </p>
        {picker("winner", quali ? "Pole" : "Winner")}
        {picker("p2", "Second")}
        {picker("p3", "Third")}
        {!quali && picker("fastestLap", "Fastest lap")}
        {!quali && (
          <fieldset className="sc-choice">
            <legend>Safety car or VSC at any point?</legend>
            <label><input type="radio" name="sc" checked={draft.safetyCar === true} onChange={() => setDraft((p) => ({ ...p, safetyCar: true }))} /> Yes</label>
            <label><input type="radio" name="sc" checked={draft.safetyCar === false} onChange={() => setDraft((p) => ({ ...p, safetyCar: false }))} /> No</label>
          </fieldset>
        )}
        <button className="button" onClick={() => send({ type: "predict", picks: draft })} disabled={state.status !== "open"}>
          {saved ? "Picks saved" : mine ? "Update picks" : "Save picks"}
        </button>
        <p className="chart-note">{people.length ? `${people.map(([, p]) => p.name).join(", ")} ${people.length === 1 ? "has" : "have"} picked. Picks stay hidden until the start.` : "Nobody has picked yet."}</p>
      </div>
    );
  }

  const scored = people.map(([id, p]) => ({ id, name: p.name, picks: p, ...(outcome ? scorePicks(p, outcome, quali) : { total: 0, lines: [] }) }));
  const showScores = finished && !!outcome;
  scored.sort((a, b) => (showScores ? b.total - a.total : a.name.localeCompare(b.name)));
  return (
    <div className="panel predictions">
      <h2>{showScores ? "Results" : "Everyone's picks"}</h2>
      {!showScores && <p className="muted">Picks are locked. Scores appear when the session ends.</p>}
      {people.length === 0 && <p className="muted">Nobody made picks for this session.</p>}
      {people.length > 0 && (
        <table className="results picks-table">
          <thead><tr><th>Name</th><th>{quali ? "Top three" : "Podium"}</th>{!quali && <th>Fastest</th>}{!quali && <th>SC</th>}{showScores && <th>Points</th>}</tr></thead>
          <tbody>
            {scored.map((r) => (
              <tr key={r.id} title={showScores ? r.lines.join(", ") || "No points" : undefined}>
                <td><strong>{r.name}</strong></td>
                <td>{[r.picks.winner, r.picks.p2, r.picks.p3].map(code).join(" ")}</td>
                {!quali && <td>{code(r.picks.fastestLap)}</td>}
                {!quali && <td>{r.picks.safetyCar == null ? "–" : r.picks.safetyCar ? "Yes" : "No"}</td>}
                {showScores && <td className="num"><strong>{r.total}</strong></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showScores && outcome && (
        <p className="chart-note">
          Result: {[outcome.winner, outcome.p2, outcome.p3].map(code).join(", ")}
          {quali ? "" : `; fastest lap ${code(outcome.fastestLap)}; safety car ${outcome.safetyCar ? "yes" : "no"}`}. Hover a row to see where the points came from.
        </p>
      )}
    </div>
  );
}
