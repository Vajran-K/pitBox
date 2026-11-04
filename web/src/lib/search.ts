/** Lowercase, strip accents ("Räikkönen" -> "raikkonen") so typing plain letters still matches. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Score how well `query` matches `text` (higher is better, 0 = no match).
 * Every word typed must be the start of some word in the text, so "max ver"
 * finds "Max Verstappen" and "mon 24" finds "Monaco Grand Prix 2024".
 */
export function score(query: string, text: string): number {
  const q = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!q.length) return 0;
  const t = fold(text);
  const words = t.split(/[\s\-–,.()]+/).filter(Boolean);
  let s = 0;
  for (const part of q) {
    const i = words.findIndex((w) => w.startsWith(part));
    if (i < 0) {
      if (part.length >= 3 && t.includes(part)) { s += 1; continue; }
      return 0;
    }
    s += words[i] === part ? 4 : 3;
    if (i === 0) s += 1;
  }
  return s;
}

export function rank<T>(items: T[], query: string, text: (t: T) => string, tieBreak?: (a: T, b: T) => number, limit = 8): T[] {
  return items
    .map((item) => ({ item, s: score(query, text(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (tieBreak ? tieBreak(a.item, b.item) : 0))
    .slice(0, limit)
    .map((x) => x.item);
}
