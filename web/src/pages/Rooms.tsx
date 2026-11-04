import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { load, useData, type Index, type Meta, type Timing, type Track } from "../data";
import { dateLabel, eventName } from "../lib/format";
import { isLiveNow, sessionLabel, useSchedule, whenLabel, type ScheduledSession } from "../lib/schedule";
import { buildReplay } from "../lib/replay";
import { ROOMS_BASE } from "../lib/roomProtocol";
import { rank } from "../lib/search";
import { saveName, savedName } from "../lib/useRoom";
import SearchBox, { type Option } from "../components/SearchBox";

export const SERVER_DOWN = "Couldn't reach the rooms server. If you're running PitBox locally, start it with npm run dev in the rooms folder (or use dev.bat).";

/** Start a watch room for a live session or a replay (race or qualifying), or join one with a code. */
export default function Rooms() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const index = useData<Index>("index.json");
  const { sessions: schedule } = useSchedule();
  const now = Date.now();
  // live: this weekend and next, anything not finished yet
  const live = useMemo(() => schedule.filter((x) => (Date.parse(x.end ?? x.start) + 3600e3) > now && Date.parse(x.start) < now + 10 * 86400e3), [schedule]); // eslint-disable-line react-hooks/exhaustive-deps
  const replays = useMemo(() => (index.data?.sessions ?? []).filter((x) => x.type === "Race" || x.type === "Qualifying").sort((a, b) => b.start.localeCompare(a.start)), [index.data]);
  const initial = params.get("live") ? `live:${params.get("live")}` : params.get("race") ? `replay:${params.get("race")}` : null;
  const [pick, setPick] = useState<string | null>(initial);
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveOpt = (x: ScheduledSession): Option => ({
    key: `live:${x.key}`, group: "Live and upcoming", label: `${sessionLabel(x)}${isLiveNow(x, now) ? " · live now" : ""}`, detail: whenLabel(x.start, now),
  });
  const replayOpt = (r: (typeof replays)[number]): Option => ({
    key: `replay:${r.key}`, group: "Replays", label: `${eventName(r.country, r.type, r.name, r.meetingName)} ${r.year}`, detail: dateLabel(r.start),
  });
  const options: Option[] = [...live.map(liveOpt), ...replays.map(replayOpt)];
  const chosen = options.find((o) => o.key === pick);

  const create = async () => {
    if (!pick || !chosen) return setError("Pick a session to watch first.");
    if (!name.trim()) return setError("Add your name so friends know who's chatting.");
    setBusy(true); setError(null);
    try {
      const [kind, keyText] = pick.split(":");
      const key = Number(keyText);
      let body: Record<string, unknown>;
      if (kind === "live") {
        const x = live.find((l) => l.key === key) ?? schedule.find((l) => l.key === key);
        if (!x) throw new Error("That session isn't on the calendar any more.");
        const start = Date.parse(x.start);
        body = { kind: "live", session: key, title: `${sessionLabel(x)} ${new Date(start).getFullYear()}`, raceStart: start,
          raceEnd: x.end ? Date.parse(x.end) : start + 2 * 3600e3, sessionType: x.name };
      } else {
        const [meta, timing, track] = await Promise.all([
          load<Meta>(`sessions/${key}/meta.json`), load<Timing>(`sessions/${key}/timing.json`),
          load<Track>(`sessions/${key}/track.json`).catch(() => null),
        ]);
        const rp = buildReplay(meta, timing, track);
        body = { kind: "replay", session: key, title: `${eventName(meta.country, meta.type, meta.name, meta.meetingName)} ${meta.year}`,
          raceStart: rp.start, raceEnd: rp.end, sessionType: meta.name };
      }
      const res = await fetch(`${ROOMS_BASE}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      if (!res) throw new Error(SERVER_DOWN);
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? SERVER_DOWN);
      saveName(name.trim());
      nav(`/room/${out.code}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length !== 6) return setError("Room codes are 6 letters and numbers, like K7PQ2M.");
    if (name.trim()) saveName(name.trim());
    nav(`/room/${c}`);
  };

  return (
    <article className="rooms-page">
      <header className="page-head">
        <p className="kicker">Watch rooms</p>
        <h1>Watch together</h1>
        <p className="lede">Start a room for a live session (race, qualifying or sprint) or a replay, send the code to friends, and watch together. Chat, react, and call the result before the start.</p>
      </header>
      <div className="split">
        <section className="panel form-panel">
          <h2>Start a room</h2>
          <SearchBox label="What to watch" value={chosen?.label ?? ""}
            placeholder="A live session, or search a race or qualifying"
            search={(q) => (q.trim() ? rank(options, q, (o) => `${o.label} ${o.detail} ${o.group}`, undefined, 14) : options.slice(0, 14))}
            onPick={(o) => setPick(o.key)} />
          {chosen && <p className="chart-note">{chosen.group === "Replays" ? "Everyone watches the same replay; anyone can play, pause or skip." : "Everyone sees F1's live timing together. Picks lock at the scheduled start."}</p>}
          <label className="field">
            <span>Your name</span>
            <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Shown next to your messages" />
          </label>
          <button className="button" onClick={create} disabled={busy}>{busy ? "Starting…" : "Start the room"}</button>
        </section>
        <section className="panel form-panel">
          <h2>Join a room</h2>
          <label className="field">
            <span>Room code</span>
            <input value={code} maxLength={8} onChange={(e) => setCode(e.target.value)} placeholder="K7PQ2M" className="code-input"
              onKeyDown={(e) => e.key === "Enter" && join()} />
          </label>
          <button className="button secondary" onClick={join}>Join</button>
        </section>
      </div>
      {error && <p className="empty error" role="alert">{error}</p>}
    </article>
  );
}
