import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData, type Career, type HistDriver, type Index } from "../data";
import { eventName } from "../lib/format";
import { rank } from "../lib/search";
import SearchBox, { type Option } from "./SearchBox";

type Entry = Option & { href: string; text: string; weight: number };

/** One search for the whole site: races with full data, seasons, and every driver since 1950. */
export default function GlobalSearch() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const index = useData<Index>("index.json");
  const drivers = useData<HistDriver[]>("history/drivers.json");
  const careers = useData<Record<string, Career>>("history/careers.json");

  // "/" anywhere focuses the search, like most sites with a search bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select") || e.target.isContentEditable);
      if (e.key === "/" && !typing) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const s of index.data?.sessions ?? []) {
      const name = eventName(s.country, s.type, s.name, s.meetingName);
      out.push({
        key: `race-${s.key}`, group: "Races", label: `${name} ${s.year}`, detail: s.circuit,
        href: `/race/${s.key}`, text: `${name} ${s.year} ${s.circuit} ${s.country} ${s.location ?? ""} ${s.name}`,
        weight: new Date(s.start).getTime() / 1e12,
      });
    }
    for (const y of index.data?.historySeasons ?? []) {
      out.push({ key: `season-${y}`, group: "Seasons", label: `${y} season`, detail: "Standings and title fight",
        href: `/season/${y}`, text: `${y} season championship standings`, weight: y / 1e4 });
    }
    const b = params.get("b") ?? "max_verstappen";
    for (const d of drivers.data ?? []) {
      const c = careers.data?.[d.id];
      if (!c?.starts) continue;
      const span = c.seasons[0] === c.seasons[c.seasons.length - 1] ? `${c.seasons[0]}` : `${c.seasons[0]}–${c.seasons[c.seasons.length - 1]}`;
      out.push({
        key: `driver-${d.id}`, group: "Drivers", label: `${d.first} ${d.last}`,
        detail: `${span}, ${c.wins} ${c.wins === 1 ? "win" : "wins"}`,
        href: `/drivers?a=${d.id}&b=${b === d.id ? "hamilton" : b}`,
        text: `${d.first} ${d.last} ${d.code ?? ""} ${d.nationality ?? ""}`,
        weight: c.starts / 1e3 + c.wins / 50,
      });
    }
    return out;
  }, [index.data, drivers.data, careers.data, params]);

  const order = ["Races", "Drivers", "Seasons"];
  const search = (q: string): Option[] => {
    if (!q.trim()) {
      // before typing: suggest the latest races
      return entries.filter((e) => e.group === "Races").sort((a, b) => b.weight - a.weight).slice(0, 5)
        .map((e) => ({ ...e, group: "Latest races" }));
    }
    const hits = rank(entries, q, (e) => e.text, (a, b) => b.weight - a.weight, 12);
    return hits.sort((a, b) => order.indexOf(a.group!) - order.indexOf(b.group!));
  };

  return (
    <div className="global-search">
      <SearchBox
        label="Search PitBox"
        placeholder="Search races, drivers, seasons   ( / )"
        search={search}
        inputRef={input}
        empty="Nothing matches. Try a driver's surname, a country or a year."
        onPick={(o) => nav((o as Entry).href)}
      />
    </div>
  );
}
