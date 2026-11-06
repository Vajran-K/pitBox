import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useMatch } from "react-router-dom";
import { useData, type Index, type Meta, type Timing } from "../data";
import type { Turn } from "../lib/chat";
import { dateLabel, eventName } from "../lib/format";
import { rank } from "../lib/search";
import ChatDrawer from "./ChatDrawer";
import { useModel } from "./AskPanel";
import SearchBox from "./SearchBox";

/**
 * One chat for the whole site. It answers anything about F1; questions about "this race"
 * mean the race page you're on, or anywhere else the latest race (switchable in the chat). Each race
 * keeps its own conversation while the site is open.
 */
type Ctx = { open: boolean; openChat: (q?: string, raceKey?: number) => void; close: () => void };
const ChatCtx = createContext<Ctx>({ open: false, openChat: () => {}, close: () => {} });
export const useChat = () => useContext(ChatCtx);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const openChat = useCallback((q?: string, raceKey?: number) => {
    if (raceKey) setChosen(raceKey);
    if (q) setPending(q);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, openChat, close }), [open, openChat, close]);
  return (
    <ChatCtx.Provider value={value}>
      {children}
      <GlobalChat open={open} close={close} openChat={openChat} pending={pending} clearPending={() => setPending(null)}
        chosen={chosen} setChosen={setChosen} />
    </ChatCtx.Provider>
  );
}

function examples(meta: Meta): string[] {
  const [a, b] = meta.result.slice(0, 2).map((r) => meta.drivers.find((d) => d.number === r.driver_number)?.code ?? "");
  return ["Who won, and who led?", `${a} vs ${b} lap times`, `Tyre degradation for ${a} and ${b}`, "Who has the most world titles?", "Who won the 2008 championship?", "What is DRS?"];
}

function GlobalChat({ open, close, openChat, pending, clearPending, chosen, setChosen }: {
  open: boolean; close: () => void; openChat: Ctx["openChat"]; pending: string | null; clearPending: () => void;
  chosen: number | null; setChosen: (k: number) => void;
}) {
  const ai = useModel();
  const loc = useLocation();
  const onRace = useMatch("/race/:key");
  const onReplay = useMatch("/race/:key/replay");
  const inRoom = useMatch("/room/:code");
  const index = useData<Index>("index.json");
  const races = useMemo(() => (index.data?.sessions ?? []).filter((s) => s.type === "Race").sort((a, b) => b.start.localeCompare(a.start)), [index.data]);

  // the race this page is about wins; otherwise the one picked in the chat, otherwise the latest
  const pageKey = Number(onRace?.params.key ?? onReplay?.params.key) || null;
  useEffect(() => { if (pageKey) setChosen(pageKey); }, [pageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = pageKey ?? chosen ?? races[0]?.key ?? null;
  const meta = useData<Meta>(open && key ? `sessions/${key}/meta.json` : null);
  const timing = useData<Timing>(open && key ? `sessions/${key}/timing.json` : null);

  const [convos, setConvos] = useState<Record<number, Turn[]>>({});
  const turns = key ? convos[key] ?? [] : [];
  const setTurns = useCallback((f: (t: Turn[]) => Turn[]) => {
    if (key) setConvos((c) => ({ ...c, [key]: f(c[key] ?? []) }));
  }, [key]);

  useEffect(() => { close(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = meta.data ? `${eventName(meta.data.country, meta.data.type, meta.data.name, meta.data.meetingName)} ${meta.data.year}` : "";
  const switcher = races.length > 1 && (
    <SearchBox label="Race" value={title} placeholder="Switch race…"
      search={(q) => (q.trim() ? rank(races, q, (r) => `${eventName(r.country, r.type, r.name, r.meetingName)} ${r.year} ${r.circuit}`) : races.slice(0, 8))
        .map((r) => ({ key: String(r.key), label: `${eventName(r.country, r.type, r.name, r.meetingName)} ${r.year}`, detail: dateLabel(r.start) }))}
      onPick={(o) => setChosen(Number(o.key))} />
  );

  return (
    <>
      {!open && !inRoom && races.length > 0 && (
        <button className="chat-fab" onClick={() => openChat()} aria-label="Ask PitBox about F1">
          <span aria-hidden="true">💬</span> Ask PitBox
        </button>
      )}
      {open && (!meta.data || !timing.data) && (
        <aside className="chat" role="dialog" aria-label="Ask PitBox">
          <header className="chat-head"><strong>Ask PitBox</strong><button className="chat-close" onClick={close} aria-label="Close chat">×</button></header>
          <div className="chat-body"><p className="muted">{meta.error ?? timing.error ?? (races.length ? "Loading the race…" : "No races exported yet. Run the pipeline first.")}</p></div>
        </aside>
      )}
      {meta.data && timing.data && (
        <ChatDrawer meta={meta.data} timing={timing.data} title={title} ai={ai} open={open} onClose={close}
          turns={turns} setTurns={setTurns} examples={examples(meta.data)} pending={pending} clearPending={clearPending}
          switcher={pageKey ? null : switcher} />
      )}
    </>
  );
}
