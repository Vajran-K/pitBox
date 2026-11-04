import type { Meta, Timing } from "../data";
import { fastestLaps, neutralisedLaps } from "./race";
import type { Picks } from "./roomProtocol";

export type Outcome = { winner?: number; p2?: number; p3?: number; fastestLap?: number; safetyCar: boolean };

export function raceOutcome(meta: Meta, timing: Timing): Outcome {
  const pos = (n: number) => meta.result.find((r) => r.position === n)?.driver_number;
  const best = [...fastestLaps(timing.laps).values()].sort((a, b) => (a.dur ?? 1e9) - (b.dur ?? 1e9))[0];
  const totalLaps = Math.max(0, ...timing.laps.map((l) => l.lap));
  return {
    winner: pos(1), p2: pos(2), p3: pos(3), fastestLap: best?.d,
    safetyCar: neutralisedLaps(timing.raceControl, totalLaps).some((n) => n.kind === "SC" || n.kind === "VSC"),
  };
}

export const POINTS = { exact: { winner: 5, p2: 3, p3: 3 }, podiumWrongSpot: 1, fastestLap: 3, safetyCar: 2 };

/** Score one person's picks. Each line says what earned the points, for the results table. */
export function scorePicks(p: Picks, o: Outcome, quali = false): { total: number; lines: string[] } {
  const first = quali ? "Pole" : "Winner";
  const lines: string[] = [];
  let total = 0;
  const podium = [o.winner, o.p2, o.p3];
  for (const slot of ["winner", "p2", "p3"] as const) {
    const pick = p[slot];
    if (pick == null) continue;
    if (pick === o[slot]) { total += POINTS.exact[slot]; lines.push(`${slot === "winner" ? first : slot.toUpperCase()} exact +${POINTS.exact[slot]}`); }
    else if (podium.includes(pick)) { total += POINTS.podiumWrongSpot; lines.push(`${slot === "winner" ? first : slot.toUpperCase()} in the top three +1`); }
  }
  if (p.fastestLap != null && p.fastestLap === o.fastestLap) { total += POINTS.fastestLap; lines.push(`Fastest lap +${POINTS.fastestLap}`); }
  if (p.safetyCar != null && p.safetyCar === o.safetyCar) { total += POINTS.safetyCar; lines.push(`Safety car call +${POINTS.safetyCar}`); }
  return { total, lines };
}
