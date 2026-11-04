export function lapTime(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "–";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

export function raceTime(sec: number | null | undefined): string {
  if (sec == null) return "–";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Calendar date at the circuit (OpenF1 gives a UTC start plus the local offset, e.g. "-05:00:00"). */
export function localDate(startIso: string, gmtOffset?: string | null): string {
  const m = /^(-)?(\d+):(\d+)/.exec(gmtOffset ?? "");
  const offsetMin = m ? (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const d = new Date(new Date(startIso).getTime() + offsetMin * 60_000);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** OpenF1 writes surnames in capitals ("Kimi ANTONELLI"); show them normally. */
export function properName(name: string | null | undefined): string {
  return (name ?? "").split(" ").map((w) => (w.length > 1 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");
}

/**
 * "Miami Grand Prix", "Miami Sprint", "Miami Qualifying". Uses the official meeting
 * name when the pipeline has it, because the country alone is ambiguous
 * (Miami, Austin and Las Vegas are all "United States").
 */
export function eventName(country: string, type: string, name: string, meetingName?: string | null): string {
  if (meetingName) {
    if (type === "Race" && name === "Race") return meetingName;
    return `${meetingName.replace(/ Grand Prix$/, "")} ${name}`;
  }
  return type === "Race" && name === "Race" ? `${country} Grand Prix` : `${country} ${name}`;
}

/** Short label for lists: "Miami", "Miami Sprint". */
export function shortEventName(country: string, type: string, name: string, meetingName?: string | null): string {
  return eventName(country, type, name, meetingName).replace(/ Grand Prix$/, "");
}
