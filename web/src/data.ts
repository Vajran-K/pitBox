import { useEffect, useState } from "react";

// ---- shapes written by the pipeline -------------------------------------
export type SessionBrief = {
  key: number; year: number; name: string; type: string; country: string;
  circuit: string; start: string; hasTelemetry: boolean;
  meetingName?: string | null; location?: string | null;
};
export type Index = { generated: string; historySeasons: number[]; sessions: SessionBrief[] };

export type Driver = { number: number; code: string; name: string; team: string; colour: string | null };
export type ResultRow = {
  position: number | null; driver_number: number; number_of_laps: number | null;
  dnf: boolean; dns: boolean; dsq: boolean; duration: number | null; gap_to_leader: number | string | null;
};
export type Meta = SessionBrief & {
  meeting: number; location: string; end: string; gmtOffset: string | null; drivers: Driver[];
  result: ResultRow[]; grid: { position: number; driver_number: number }[];
};
export type Lap = { d: number; lap: number; t: number | null; dur: number | null; s1: number | null; s2: number | null; s3: number | null; pitOut: boolean; st: number | null };
export type Stint = { d: number; n: number; from: number; to: number; compound: string | null; age: number | null };
export type RaceControl = { t: number; lap: number | null; cat: string; flag: string | null; d: number | null; msg: string };
export type Timing = {
  laps: Lap[]; stints: Stint[]; pits: { d: number; lap: number; t: number; dur: number | null }[];
  raceControl: RaceControl[]; positions: { t: number; d: number; p: number }[];
  radio: { t: number; d: number; url: string }[];
};
export type Telemetry = {
  driver: number;
  car: { t: number[]; speed: number[]; throttle: number[]; brake: number[]; gear: number[]; rpm: number[]; drs: number[] };
  pos: { t: number[]; x: number[]; y: number[] };
};
export type Track = {
  driver: number; lap: number; bounds: [number, number, number, number]; x: number[]; y: number[];
  t?: number[]; lapDuration?: number; sectors?: (number | null)[]; // added in pipeline v2; older exports lack them
};

export type HistoryResult = {
  pos: number | null; posText: string; driver: string; team: string; grid: number | null;
  laps: number | null; status: string; points: number; fastestLapRank: number | null;
};
export type SeasonData = {
  year: number;
  races: { round: number; name: string; date: string; circuit: string; results: HistoryResult[]; sprint: HistoryResult[] }[];
  driverStandings: { pos: number; driver: string; teams: string[]; points: number; wins: number }[];
  constructorStandings: { pos: number; team: string; points: number; wins: number }[];
};
export type HistDriver = { id: string; code: string | null; number: string | null; first: string; last: string; dob: string | null; nationality: string | null };
export type Career = { starts: number; wins: number; podiums: number; poles: number; points: number; fastestLaps: number; titles: number; seasons: number[]; teams: string[] };
export type DriverRace = { year: number; round: number; race: string; date: string; pos: number | null; posText: string; grid: number | null; team: string; points: number; status: string };
export type Team = { id: string; name: string };

// ---- loading ------------------------------------------------------------
const cache = new Map<string, Promise<unknown>>();

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`/data/${path}`);
  if (!res.ok) throw new Error(`Couldn't load ${path} (HTTP ${res.status}). Run the pipeline to export it.`);
  if (!path.endsWith(".gz")) return res.json();
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json();
  }
  return JSON.parse(new TextDecoder().decode(buf)); // server already decompressed it
}

export function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetchJson(path);
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path) as Promise<T>;
}

export type Loaded<T> = { data?: T; error?: string; loading: boolean };

export function useData<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ loading: !!path });
  useEffect(() => {
    if (!path) { setState({ loading: false }); return; }
    let live = true;
    setState({ loading: true });
    load<T>(path).then(
      (data) => live && setState({ data, loading: false }),
      (e: Error) => live && setState({ error: e.message, loading: false }),
    );
    return () => { live = false; };
  }, [path]);
  return state;
}

export function teamColour(d: Driver | undefined): string {
  return d?.colour ? `#${d.colour}` : "var(--muted)";
}
