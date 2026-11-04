import { useEffect, useRef, useState } from "react";
import { applyFeed, type LiveMessage, type LiveState, type UpstreamStatus } from "../../../rooms/src/livefeed";
import { roomsWsUrl } from "./roomProtocol";

export type LiveConn = { state: LiveState; upstream: UpstreamStatus | "relay-down"; updates: number; lastUpdate: number | null };

/** Connect to the live-timing relay and keep the merged state. */
export function useLive(): LiveConn {
  const [conn, setConn] = useState<LiveConn>({ state: {}, upstream: "connecting", updates: 0, lastUpdate: null });
  const pending = useRef<LiveState | null>(null);
  const count = useRef(0);
  useEffect(() => {
    let ws: WebSocket | null = null, closed = false, retry = 0, timer: number | undefined;
    let state: LiveState = {};
    // batch rapid updates into at most ~10 renders a second
    const flush = window.setInterval(() => {
      if (pending.current) {
        const s = pending.current, n = count.current;
        pending.current = null;
        setConn((c) => ({ ...c, state: s, updates: n, lastUpdate: n !== c.updates ? Date.now() : c.lastUpdate }));
      }
    }, 100);
    const connect = () => {
      ws = new WebSocket(roomsWsUrl("/api/live/ws"));
      ws.onopen = () => { retry = 0; };
      ws.onmessage = (e) => {
        let m: LiveMessage;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === "snapshot") { state = m.state; pending.current = state; setConn((c) => ({ ...c, upstream: m.upstream })); }
        else if (m.type === "status") setConn((c) => ({ ...c, upstream: m.upstream }));
        else if (m.type === "feed") {
          state = applyFeed(state, m.topic, m.data);
          pending.current = state;
          count.current++;
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setConn((c) => ({ ...c, upstream: "relay-down" }));
        timer = window.setTimeout(connect, Math.min(15_000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => { closed = true; window.clearTimeout(timer); window.clearInterval(flush); ws?.close(); };
  }, []);
  return conn;
}


// ---- reading the F1 topics -----------------------------------------------------
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const get = (s: LiveState, k: string) => (s[k] ?? {}) as Any;

export type SectorCell = { value: string; mark: "overall" | "personal" | "" };
export type LiveRow = {
  n: string; pos: number; code: string; name: string; team: string; colour: string;
  gap: string; interval: string; last: SectorCell; best: string; bestOverall: boolean;
  sectors: SectorCell[]; tyre: { compound: string; laps: number; fresh: boolean } | null;
  pits: number; state: "" | "In pit" | "Pit exit" | "Out" | "Stopped"; laps: number | null;
  knockedOut: boolean; // qualifying: eliminated in an earlier part
};

const mark = (o: Any | undefined): SectorCell["mark"] => (o?.OverallFastest ? "overall" : o?.PersonalFastest ? "personal" : "");

export function liveRows(s: LiveState): LiveRow[] {
  const lines = (get(s, "TimingData").Lines ?? {}) as Record<string, Any>;
  const drivers = get(s, "DriverList") as Record<string, Any>;
  const app = (get(s, "TimingAppData").Lines ?? {}) as Record<string, Any>;
  const rows: LiveRow[] = [];
  for (const [n, l] of Object.entries(lines)) {
    const d = drivers[n] ?? {};
    const stints = (app[n]?.Stints ?? []) as Any[];
    const st = Array.isArray(stints) ? stints.filter(Boolean).at(-1) : undefined;
    const quali = Array.isArray(l.Stats) ? l.Stats.filter(Boolean).at(-1) : undefined;
    const bestTimes = Array.isArray(l.BestLapTimes) ? l.BestLapTimes.filter((b: Any) => b?.Value).at(-1) : undefined;
    rows.push({
      n, pos: Number(l.Position) || 99,
      code: d.Tla ?? n, name: d.FullName ?? "", team: d.TeamName ?? "", colour: d.TeamColour ? `#${d.TeamColour}` : "var(--muted)",
      gap: String(l.GapToLeader ?? l.TimeDiffToFastest ?? quali?.TimeDiffToFastest ?? ""),
      interval: String(l.IntervalToPositionAhead?.Value ?? l.TimeDiffToPositionAhead ?? quali?.TimeDiffToPositionAhead ?? ""),
      last: { value: l.LastLapTime?.Value ?? "", mark: mark(l.LastLapTime) },
      best: l.BestLapTime?.Value ?? bestTimes?.Value ?? "", bestOverall: !!l.BestLapTime?.OverallFastest,
      sectors: (Array.isArray(l.Sectors) ? l.Sectors : [0, 1, 2].map((i) => l.Sectors?.[i])).slice(0, 3)
        .map((x: Any) => ({ value: x?.Value ?? "", mark: mark(x) })),
      tyre: st && st.Compound ? { compound: String(st.Compound), laps: Number(st.TotalLaps) || 0, fresh: String(st.New) === "true" } : null,
      pits: Number(l.NumberOfPitStops) || 0,
      state: l.Retired ? "Out" : l.Stopped ? "Stopped" : l.InPit ? "In pit" : l.PitOut ? "Pit exit" : "",
      laps: l.NumberOfLaps ?? null,
      knockedOut: !!l.KnockedOut,
    });
  }
  return rows.sort((a, b) => a.pos - b.pos);
}

export const TRACK_STATUS: Record<string, { label: string; tone: "green" | "yellow" | "sc" | "red" }> = {
  "1": { label: "Track clear", tone: "green" },
  "2": { label: "Yellow flag", tone: "yellow" },
  "4": { label: "Safety car", tone: "sc" },
  "5": { label: "Red flag", tone: "red" },
  "6": { label: "Virtual safety car", tone: "sc" },
  "7": { label: "VSC ending", tone: "sc" },
};

export function sessionHeader(s: LiveState) {
  const info = get(s, "SessionInfo");
  const status = get(s, "SessionStatus").Status ?? info.SessionStatus ?? "";
  const track = TRACK_STATUS[String(get(s, "TrackStatus").Status ?? "")];
  const lap = get(s, "LapCount");
  const w = get(s, "WeatherData");
  const part = Number(get(s, "TimingData").SessionPart) || null;
  return {
    key: Number(info.Key) || null,
    part,  // qualifying: 1, 2 or 3
    meeting: info.Meeting?.Name as string | undefined,
    session: info.Name as string | undefined,
    type: info.Type as string | undefined,
    path: info.Path as string | undefined,
    status: String(status),
    live: status === "Started" || status === "Aborted",
    track,
    lap: lap.CurrentLap ? { current: Number(lap.CurrentLap), total: Number(lap.TotalLaps) || null } : null,
    weather: w.AirTemp ? { air: w.AirTemp, track: w.TrackTemp, humidity: w.Humidity, rain: String(w.Rainfall) === "1", wind: w.WindSpeed } : null,
  };
}

/** Session time remaining, counting down locally between F1's clock updates. */
export function remaining(s: LiveState, now = Date.now()): string | null {
  const c = get(s, "ExtrapolatedClock");
  if (!c.Remaining) return null;
  const [h, m, sec] = String(c.Remaining).split(":").map(Number);
  let left = (h * 3600 + m * 60 + sec) * 1000;
  // count down between updates, unless the clock is from an old session (then show it as it was)
  const since = c.Utc ? now - Date.parse(c.Utc) : 0;
  if (c.Extrapolating && c.Utc && since < left + 3600e3) left -= since;
  left = Math.max(0, left);
  const t = Math.floor(left / 1000);
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function raceControl(s: LiveState): { utc: string; text: string; flag?: string }[] {
  const msgs = get(s, "RaceControlMessages").Messages;
  const list = (Array.isArray(msgs) ? msgs : Object.values(msgs ?? {})) as Any[];
  return list.filter(Boolean).map((m) => ({ utc: m.Utc, text: m.Message, flag: m.Flag })).reverse();
}

export function teamRadio(s: LiveState): { utc: string; n: string; url: string }[] {
  const path = get(s, "SessionInfo").Path as string | undefined;
  const caps = get(s, "TeamRadio").Captures;
  const list = (Array.isArray(caps) ? caps : Object.values(caps ?? {})) as Any[];
  if (!path) return [];
  return list.filter(Boolean).map((c) => ({ utc: c.Utc, n: String(c.RacingNumber), url: `https://livetiming.formula1.com/static/${path}${c.Path}` })).reverse();
}

/** The drivers in the live session, as PitBox's usual Driver shape, in timing order. */
export function liveDrivers(s: LiveState): { number: number; code: string; name: string; team: string; colour: string | null }[] {
  const list = get(s, "DriverList") as Record<string, Any>;
  const order = new Map(liveRows(s).map((r) => [r.n, r.pos]));
  return Object.entries(list).filter(([, d]) => d && typeof d === "object" && d.Tla)
    .map(([n, d]) => ({ number: Number(n), code: String(d.Tla), name: String(d.FullName ?? d.Tla), team: String(d.TeamName ?? ""), colour: d.TeamColour ? String(d.TeamColour) : null }))
    .sort((a, b) => (order.get(String(a.number)) ?? 99) - (order.get(String(b.number)) ?? 99));
}

const secs = (v: string) => {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(v.trim());
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : Infinity;
};

/** How the session ended, for scoring room picks: top three, fastest lap and whether a safety car came out. */
export function liveOutcome(s: LiveState): { winner?: number; p2?: number; p3?: number; fastestLap?: number; safetyCar: boolean } {
  const rows = liveRows(s).filter((r) => r.pos < 99);
  const best = rows.filter((r) => r.best).sort((a, b) => secs(a.best) - secs(b.best))[0];
  const sc = raceControl(s).some((m) => /SAFETY CAR DEPLOYED|VSC DEPLOYED/i.test(m.text));
  return { winner: Number(rows[0]?.n) || undefined, p2: Number(rows[1]?.n) || undefined, p3: Number(rows[2]?.n) || undefined, fastestLap: best ? Number(best.n) : undefined, safetyCar: sc };
}

/** True once F1 marks the session as over. */
export const sessionOver = (status: string) => /^(Finished|Finalised|Ends)$/i.test(status);
