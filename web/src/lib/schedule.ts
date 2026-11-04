import { useEffect, useState } from "react";
import { useData, type Index } from "../data";
import { ROOMS_BASE } from "./roomProtocol";

export type ScheduledSession = {
  key: number; name: string; type: string; country: string; circuit?: string;
  meetingKey?: number; meetingName?: string | null; start: string; end?: string;
};
export type Weekend = { meetingKey: number | string; name: string; sessions: ScheduledSession[]; start: number; end: number };

// a session's slot runs from its start to its end (or 2 h if the end isn't known), plus a little run-off
const endOf = (s: ScheduledSession) => (s.end ? Date.parse(s.end) : Date.parse(s.start) + 2 * 3600e3) + 30 * 60e3;
export const isLiveNow = (s: ScheduledSession, now = Date.now()) => Date.parse(s.start) - 10 * 60e3 <= now && now < endOf(s);
export const sessionLabel = (s: ScheduledSession) => `${(s.meetingName ?? `${s.country} Grand Prix`).replace(/ Grand Prix$/, "")} ${s.name}`;

let cache: Promise<ScheduledSession[]> | null = null;

/**
 * This season's sessions. Comes from the rooms server (fresh from OpenF1, cached there),
 * falling back to the list the pipeline wrote into index.json when the server isn't running.
 */
export function useSchedule(): { sessions: ScheduledSession[]; loading: boolean } {
  const index = useData<Index & { upcoming?: ScheduledSession[] }>("index.json");
  const [remote, setRemote] = useState<ScheduledSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    cache ??= fetch(`${ROOMS_BASE}/api/schedule`).then(async (r) => {
      const body = await r.json();
      if (!Array.isArray(body.sessions) || !body.sessions.length) throw new Error("empty");
      return body.sessions as ScheduledSession[];
    });
    cache.then(setRemote, () => { cache = null; setFailed(true); });
  }, []);
  const sessions = remote ?? (failed || index.data ? index.data?.upcoming ?? [] : []);
  return { sessions: [...sessions].sort((a, b) => a.start.localeCompare(b.start)), loading: !remote && !failed && index.loading };
}

/** Group sessions into race weekends. */
export function weekends(sessions: ScheduledSession[]): Weekend[] {
  const map = new Map<number | string, Weekend>();
  for (const s of sessions) {
    const k = s.meetingKey ?? s.meetingName ?? s.country;
    const w = map.get(k) ?? { meetingKey: k, name: s.meetingName ?? `${s.country} Grand Prix`, sessions: [], start: Infinity, end: 0 };
    w.sessions.push(s);
    w.start = Math.min(w.start, Date.parse(s.start));
    w.end = Math.max(w.end, endOf(s));
    map.set(k, w);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

/** The weekend under way now (from first session to the end of the race), else the next one. */
export function currentOrNextWeekend(sessions: ScheduledSession[], now = Date.now()): { weekend: Weekend; underway: boolean } | null {
  const list = weekends(sessions);
  const on = list.find((w) => w.start - 12 * 3600e3 <= now && now < w.end);
  if (on) return { weekend: on, underway: now >= on.start - 10 * 60e3 };
  const next = list.find((w) => w.start > now);
  return next ? { weekend: next, underway: false } : null;
}

export function whenLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  const day = new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const h = (t - now) / 3600e3;
  const rel = h < 0 ? "" : h < 1 ? ` (in ${Math.max(1, Math.round(h * 60))} min)` : h < 48 ? ` (in ${Math.round(h)} h)` : ` (in ${Math.round(h / 24)} days)`;
  return `${day}, ${time}${rel}`;
}
