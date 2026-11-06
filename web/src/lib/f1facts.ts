import { load, type HistDriver, type Career, type SeasonData, type Team } from "../data";
import { fold } from "./search";

/**
 * Facts for general F1 questions (any driver, team, season, Grand Prix or record since 1950),
 * computed from PitBox's history exports. The chat gives these to the model so the numbers it
 * quotes are the real ones; anything they don't cover the model answers from its own knowledge.
 */

export type Summary = {
  champions: {
    year: number; final: boolean; races: number; scheduled: number;
    drivers: { driver: string; teams: string[]; points: number; wins: number }[];
    constructors: { team: string; points: number; wins: number }[];
  }[];
  races: { y: number; r: number; name: string; circuit: string; date: string; podium: [string, string][]; pole: string | null }[];
  teams: Record<string, { wins: number; podiums: number; poles: number; titles: number; driverTitles: number; first: number; last: number; seasons: number }>;
};
type Circuit = { id: string; name: string; locality: string | null; country: string | null };

export type History = {
  drivers: HistDriver[]; teams: Team[]; circuits: Circuit[];
  careers: Record<string, Career>; summary: Summary;
  seasons: Map<number, SeasonData>;
};

let loading: Promise<History> | null = null;
/** The history files (about 120 KB compressed), loaded once on the first general question. */
export function loadHistory(): Promise<History> {
  loading ??= Promise.all([
    load<HistDriver[]>("history/drivers.json"), load<Team[]>("history/constructors.json"), load<Circuit[]>("history/circuits.json"),
    load<Record<string, Career>>("history/careers.json"), load<Summary>("history/summary.json"),
  ]).then(([drivers, teams, circuits, careers, summary]) => ({ drivers, teams, circuits, careers, summary, seasons: new Map() }));
  loading.catch(() => { loading = null; });
  return loading;
}

/** Full season files for the years a question names (standings beyond the top three, every race's result). */
export async function loadSeasons(h: History, years: number[]): Promise<void> {
  await Promise.all(years.filter((y) => !h.seasons.has(y)).map((y) =>
    load<SeasonData>(`history/seasons/${y}.json`).then((s) => { h.seasons.set(y, s); }).catch(() => {})));
}

// ---- finding what a question is about --------------------------------------------------

/** Words that are also surnames or team names but in a question usually aren't one. */
const COMMON = new Set(("will more most many best first last race races team teams world title titles grand prix pole poles wins win won " +
  "winner fast long young old new rose bell black brown green white may rich price law stop start lap laps time times point points car cars " +
  "engine speed driver drivers record season seasons year years champion how who what when which does did has have the and for with from " +
  "ever all history born age oldest youngest name number much lost lose march shadow eagle arrows ensign hope fry gay hall ward " +
  "rain wet dry safety").split(" "));
const NICKNAMES: Record<string, string> = {
  lewis: "hamilton", ayrton: "senna", lando: "norris", oscar: "piastri", charles: "leclerc", fernando: "alonso", nando: "alonso",
  sebastian: "vettel", seb: "vettel", niki: "lauda", jenson: "button", checo: "perez", schumi: "michael_schumacher", kimi: "raikkonen",
  "max verstappen": "max_verstappen", "michael schumacher": "michael_schumacher", "mick schumacher": "mick_schumacher",
  "ralf schumacher": "ralf_schumacher",
};
const TEAM_ALIASES: Record<string, string> = {
  "red bull": "red_bull", rbr: "red_bull", merc: "mercedes", lotus: "team_lotus", "toro rosso": "toro_rosso", "racing bulls": "rb",
  aston: "aston_martin", "alfa romeo": "alfa", sauber: "sauber", "force india": "force_india", "racing point": "racing_point",
};
// a Grand Prix named after a country uses the adjective ("British"); these need "GP" or "Grand Prix" next to them
const NATIONALITY = /^(british|italian|german|french|spanish|belgian|dutch|austrian|hungarian|japanese|brazilian|mexican|canadian|australian|chinese|portuguese|swiss|swedish|argentine|argentinian|south african|european|russian|turkish|korean|indian|malaysian|styrian|tuscan|eifel|emilia romagna|pacific|luxembourg|united states|usa|us|american)$/;
const PLACES: Record<string, string> = { // circuit or place -> Grand Prix name word(s) in the results
  silverstone: "british", monza: "italian", spa: "belgian", suzuka: "japanese", interlagos: "sao paulo", "sao paulo": "sao paulo",
  imola: "emilia romagna", "red bull ring": "austrian", hungaroring: "hungarian", zandvoort: "dutch", "cota": "united states",
  austin: "united states", jeddah: "saudi arabian", "yas marina": "abu dhabi", "marina bay": "singapore", catalunya: "spanish",
  barcelona: "spanish", "gilles villeneuve": "canadian", montreal: "canadian", "albert park": "australian", melbourne: "australian",
  shanghai: "chinese", sakhir: "bahrain", lusail: "qatar", "hermanos rodriguez": "mexico city", hockenheim: "german", nurburgring: "german",
  "paul ricard": "french", "magny cours": "french", "le castellet": "french", estoril: "portuguese", portimao: "portuguese",
};
const METRICS: [RegExp, keyof Career, string][] = [
  [/\b(titles?|championships?|world champions?)\b/, "titles", "world titles"],
  [/\b(poles?|pole positions?)\b/, "poles", "pole positions (started from grid 1)"],
  [/\bpodiums?\b/, "podiums", "podiums"],
  [/\bfastest laps?\b/, "fastestLaps", "fastest laps"],
  [/\b(starts|races entered|most races|appearances|grands? prix (started|entered))\b/, "starts", "race starts"],
  [/\bpoints\b/, "points", "points"],
  [/\b(wins|won|victories|winners?)\b/, "wins", "wins"],
];

export type Topics = {
  drivers: string[]; teams: string[]; years: number[]; gps: string[];
  record: { metric: keyof Career; label: string } | null; nationality: string | null; ages: "youngest" | "oldest" | null;
};

const word = (t: string, w: string) => new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(t);
const clean = (q: string) => fold(q).replace(/[’']s\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function topics(q: string, h: History, latest: number): Topics {
  const t = clean(q);
  const raw = ` ${q} `;
  const starts = (id: string) => h.careers[id]?.starts ?? 0;

  // drivers: full name, surname (the best-known one when several share it), a code like HAM, a nickname
  const drivers: string[] = [];
  const add = (id: string) => { if (h.careers[id] && !drivers.includes(id)) drivers.push(id); };
  const bySurname = new Map<string, HistDriver[]>();
  for (const d of h.drivers) {
    const full = clean(`${d.first} ${d.last}`), last = clean(d.last);
    if (word(t, full)) add(d.id);
    if (last.length >= 3 && !COMMON.has(last)) bySurname.set(last, [...(bySurname.get(last) ?? []), d]);
  }
  // first names and nicknames ("Lewis", "Checo") beat a little-known driver with that surname
  const used = new Set<string>();
  for (const [n, id] of Object.entries(NICKNAMES)) if (word(t, n)) { add(id); used.add(n); }
  for (const [last, ds] of bySurname) {
    if (used.has(last) || !word(t, last) || ds.some((d) => drivers.includes(d.id))) continue;
    ds.sort((a, b) => starts(b.id) - starts(a.id)).slice(0, ds.length > 1 && starts(ds[1].id) > 50 ? 2 : 1).forEach((d) => add(d.id));
  }
  for (const m of raw.matchAll(/\b([A-Z]{3})\b/g)) {
    const d = h.drivers.filter((x) => x.code === m[1]).sort((a, b) => starts(b.id) - starts(a.id))[0];
    if (d && !["GP", "F1", "DRS", "ERS", "FIA", "MGU", "DNF", "VSC", "USA"].includes(m[1])) add(d.id);
  }

  // teams
  const teams: string[] = [];
  for (const [a, id] of Object.entries(TEAM_ALIASES)) if (word(t, a) && h.summary.teams[id] && !teams.includes(id)) teams.push(id);
  for (const tm of h.teams) {
    const n = clean(tm.name).replace(/ (f1 team|racing|team)$/, "");
    if (n.length >= 3 && !COMMON.has(n) && word(t, n) && h.summary.teams[tm.id] && !teams.includes(tm.id)) teams.push(tm.id);
  }

  // years, and "this season" / "last season"
  const years = [...new Set([...t.matchAll(/\b(19[5-9]\d|20\d\d)\b/g)].map((m) => Number(m[1])).filter((y) => y >= 1950 && y <= latest))];
  if (!years.length && /\b(this (season|year)|current (season|standings|championship)|so far|standings|championship (lead|fight|battle)|leads? the championship|leading the championship)\b/.test(t)) years.push(latest);
  if (!years.length && /\blast (season|year)\b/.test(t)) years.push(latest - 1);

  // Grands Prix, by name ("Monaco", "British GP") or circuit ("Silverstone")
  const names = [...new Set(h.summary.races.map((r) => r.name))];
  const gps: string[] = [];
  for (const name of names) {
    const key = clean(name.replace(/ Grand Prix$/, ""));
    const needsGp = NATIONALITY.test(key);
    if (needsGp ? new RegExp(`(^| )${key} (gp|grand prix)( |$)`).test(t) : word(t, key)) gps.push(name);
  }
  for (const [place, key] of Object.entries(PLACES)) {
    if (!word(t, place)) continue;
    const name = names.find((n) => clean(n.replace(/ Grand Prix$/, "")) === key);
    if (name && !gps.includes(name)) gps.push(name);
  }

  // records: "most wins", "all-time", "record for poles"
  let record: Topics["record"] = null;
  if (/\b(most|record|all time|ever|greatest|of all time|top \d+|leaders?|ranking|best)\b/.test(t)) {
    const m = METRICS.find(([re]) => re.test(t));
    if (m) record = { metric: m[1], label: m[2] };
  }
  const nat = t.match(/\b(british|english|italian|german|french|spanish|belgian|dutch|austrian|finnish|brazilian|mexican|canadian|australian|american|argentine|argentinian|swiss|swedish|japanese|new zealander|monegasque|danish|thai|chinese|polish|russian)\b/);
  const nationality = nat && (record || /\b(drivers?|champions?)\b/.test(t)) ? nat[1] : null;
  const ages = /\byoungest\b/.test(t) ? "youngest" : /\boldest\b/.test(t) ? "oldest" : null;
  return { drivers: drivers.slice(0, 4), teams: teams.slice(0, 3), years: years.slice(0, 3), gps: gps.slice(0, 2), record, nationality, ages };
}

export const hasTopics = (x: Topics) => !!(x.drivers.length || x.teams.length || x.years.length || x.gps.length || x.record || x.ages);

// ---- the facts ------------------------------------------------------------------------

const NAT_FORMS: Record<string, string> = { english: "British", argentinian: "Argentine", "new zealander": "New Zealander" };

export function generalFacts(q: string, h: History, prevQ?: string): { facts: string[]; topics: Topics } {
  const latestRace = h.summary.races[h.summary.races.length - 1];
  const latest = latestRace?.y ?? new Date().getFullYear();
  let tp = topics(q, h, latest);
  // a follow-up ("how many titles has he got?") is about whatever the last question was about
  if (prevQ && !tp.drivers.length && !tp.teams.length && !tp.gps.length) {
    const before = topics(prevQ, h, latest);
    tp = { ...tp, drivers: before.drivers, teams: before.teams, gps: before.gps, years: tp.years.length ? tp.years : before.years };
  }

  const dr = new Map(h.drivers.map((d) => [d.id, d]));
  const tm = new Map(h.teams.map((t) => [t.id, t.name]));
  const name = (id: string) => { const d = dr.get(id); return d ? `${d.first} ${d.last}` : id; };
  const team = (id: string) => tm.get(id) ?? id;
  const champ = new Map(h.summary.champions.map((c) => [c.year, c]));
  const facts: string[] = [];
  if (latestRace) facts.push(`PitBox has every championship race from 1950 up to the ${latestRace.y} ${latestRace.name} (${latestRace.date}).`);

  const titleYears = (id: string) => h.summary.champions.filter((c) => c.final && c.drivers[0]?.driver === id).map((c) => c.year);
  const teamTitleYears = (id: string) => h.summary.champions.filter((c) => c.final && c.constructors[0]?.team === id).map((c) => c.year);
  const range = (ys: number[]) => (ys.length ? (ys[0] === ys[ys.length - 1] ? `${ys[0]}` : `${ys[0]} to ${ys[ys.length - 1]}`) : "");

  for (const id of tp.drivers) {
    const c = h.careers[id], d = dr.get(id);
    if (!c || !d) continue;
    const ty = titleYears(id);
    facts.push(`${name(id)}${d.nationality ? ` (${d.nationality}` : ""}${d.dob ? `, born ${d.dob}` : ""}${d.nationality ? ")" : ""}: ` +
      `${c.starts} race starts, ${c.wins} wins, ${c.podiums} podiums, ${c.poles} pole positions (started from grid 1), ${c.fastestLaps} fastest laps, ${c.points} points, ` +
      `${c.titles} world title${c.titles === 1 ? "" : "s"}${ty.length ? ` (${ty.join(", ")})` : ""}; raced ${range(c.seasons)} for ${c.teams.map(team).join(", ")}.`);
    for (const y of tp.years) {
      const s = h.seasons.get(y);
      const row = s?.driverStandings.find((x) => x.driver === id);
      if (row) facts.push(`${name(id)} in ${y}: ${row.pos}${ord(row.pos)} in the championship with ${row.points} points and ${row.wins} wins, for ${row.teams.map(team).join(" and ")}.`);
      else if (s) facts.push(`${name(id)} didn't score in the ${y} championship (or didn't race that year).`);
    }
  }

  for (const id of tp.teams) {
    const t = h.summary.teams[id];
    if (!t) continue;
    const ty = teamTitleYears(id);
    facts.push(`${team(id)}: ${t.titles} constructors' title${t.titles === 1 ? "" : "s"}${ty.length ? ` (${ty.join(", ")})` : ""} (the constructors' championship started in 1958), ` +
      `${t.driverTitles} drivers' titles won in its cars, ${t.wins} wins, ${t.poles} pole positions, ${t.podiums} podiums; raced ${t.first} to ${t.last} (${t.seasons} seasons).`);
  }

  for (const y of tp.years) {
    const c = champ.get(y), s = h.seasons.get(y);
    if (!c) continue;
    const top = (s?.driverStandings ?? c.drivers.map((x, i) => ({ ...x, pos: i + 1 }))).slice(0, c.final ? 3 : 6);
    const lineD = top.map((x) => `${x.pos}. ${name(x.driver)} (${x.teams.map(team).join("/")}) ${x.points} pts, ${x.wins} wins`).join("; ");
    const topC = (s?.constructorStandings ?? c.constructors.map((x, i) => ({ ...x, pos: i + 1 }))).slice(0, 3);
    const lineC = topC.map((x) => `${x.pos}. ${team(x.team)} ${x.points} pts`).join("; ");
    if (c.final) {
      facts.push(`${y} drivers' champion: ${name(c.drivers[0].driver)}. Final standings: ${lineD}. ${c.races} races.`);
      if (topC.length) facts.push(`${y} constructors' champion: ${team(topC[0].team)}. ${lineC}.`);
    } else {
      facts.push(`${y} season still going: ${c.races} of ${c.scheduled} races done. Drivers' standings: ${lineD}.`);
      if (topC.length) facts.push(`${y} constructors' standings: ${lineC}.`);
    }
    const winners = h.summary.races.filter((r) => r.y === y && r.podium.length);
    if (winners.length && !tp.gps.length) facts.push(`${y} race winners: ${winners.map((r) => `${r.name.replace(/ Grand Prix$/, "")} ${name(r.podium[0][0])}`).join(", ")}.`);
  }

  for (const gp of tp.gps) {
    const held = h.summary.races.filter((r) => r.name === gp && r.podium.length);
    if (!held.length) continue;
    const inYears = tp.years.length ? held.filter((r) => tp.years.includes(r.y)) : [];
    for (const r of inYears) {
      facts.push(`${r.y} ${gp} (round ${r.r}, ${r.date}): won by ${name(r.podium[0][0])} (${team(r.podium[0][1])}), ` +
        `then ${r.podium.slice(1).map(([d, t]) => `${name(d)} (${team(t)})`).join(" and ")}; pole ${r.pole ? name(r.pole) : "not recorded"}.`);
    }
    if (tp.years.length && !inYears.length) facts.push(`There was no ${gp} in ${tp.years.join(" or ")}.`);
    if (!inYears.length) {
      const wins = new Map<string, number>();
      for (const r of held) wins.set(r.podium[0][0], (wins.get(r.podium[0][0]) ?? 0) + 1);
      const most = [...wins].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, n]) => `${name(d)} ${n}`).join(", ");
      facts.push(`${gp}: held ${held.length} times (${held[0].y} to ${held[held.length - 1].y}). Most wins: ${most}.`);
      facts.push(`Last ${Math.min(5, held.length)} ${gp} winners: ${held.slice(-5).reverse().map((r) => `${r.y} ${name(r.podium[0][0])}`).join(", ")}.`);
    }
  }

  if (tp.record) {
    const { metric, label } = tp.record;
    const natName = tp.nationality ? NAT_FORMS[tp.nationality] ?? tp.nationality[0].toUpperCase() + tp.nationality.slice(1) : null;
    if (tp.teams.length === 0 && /\b(teams?|constructors?|manufacturers?)\b/.test(clean(q))) {
      const tKey = metric === "titles" ? "titles" : metric === "poles" ? "poles" : metric === "podiums" ? "podiums" : "wins";
      const rows = Object.entries(h.summary.teams).sort((a, b) => b[1][tKey] - a[1][tKey]).slice(0, 8);
      facts.push(`Teams with the most ${tKey === "titles" ? "constructors' titles" : tKey}: ${rows.map(([id, t], i) => `${i + 1}. ${team(id)} ${t[tKey]}`).join("; ")}.`);
    } else {
      const pool = Object.entries(h.careers).filter(([id]) => !natName || dr.get(id)?.nationality === natName);
      const rows = pool.sort((a, b) => (b[1][metric] as number) - (a[1][metric] as number)).slice(0, 8);
      facts.push(`${natName ? `${natName} drivers` : "Drivers"} with the most ${label}: ${rows.map(([id, c], i) => `${i + 1}. ${name(id)} ${c[metric]}`).join("; ")}.`);
    }
  }

  if (tp.ages) {
    const champs = /\bchampions?\b/.test(clean(q));
    const list: { id: string; age: number; when: string }[] = [];
    const ageAt = (id: string, date: string) => { const b = dr.get(id)?.dob; return b ? (Date.parse(date) - Date.parse(b)) / (365.2425 * 864e5) : null; };
    if (champs) {
      for (const c of h.summary.champions.filter((x) => x.final)) {
        const last = h.summary.races.filter((r) => r.y === c.year).pop();
        const a = last ? ageAt(c.drivers[0].driver, last.date) : null;
        if (a != null) list.push({ id: c.drivers[0].driver, age: a, when: `${c.year} title` });
      }
    } else {
      const first = new Map<string, { a: number; when: string }>();
      for (const r of h.summary.races) {
        const id = r.podium[0]?.[0]; if (!id) continue;
        const a = ageAt(id, r.date); if (a == null) continue;
        const cur = first.get(id);
        if (!cur || (tp.ages === "youngest" ? a < cur.a : a > cur.a)) first.set(id, { a, when: `${r.y} ${r.name}` });
      }
      for (const [id, v] of first) list.push({ id, age: v.a, when: v.when });
    }
    list.sort((a, b) => (tp.ages === "youngest" ? a.age - b.age : b.age - a.age));
    const yrs = (a: number) => { const y = Math.floor(a); return `${y} years ${Math.floor((a - y) * 365.2425)} days`; };
    facts.push(`${tp.ages === "youngest" ? "Youngest" : "Oldest"} ${champs ? "world champions" : "race winners"}: ${list.slice(0, 5).map((x, i) => `${i + 1}. ${name(x.id)}, ${yrs(x.age)} (${x.when})`).join("; ")}.`);
  }

  return { facts: facts.slice(0, 30), topics: tp };
}

const ord = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
