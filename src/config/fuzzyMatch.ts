const NO_TYPOS_RANK = 3;

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// \p{M} keeps Devanagari vowel signs inside their word.
const wordsOf = (s: string): string[] => s.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/**
 * Shorter words have too many neighbours ("cat": car, bat, cut).
 * Digits never flex: "Track 1" is not "Track 2".
 */
const allowedTypos = (word: string): number => {
  if (/\p{N}/u.test(word) || word.length < 4) return 0;
  return word.length < 8 ? 1 : 2;
};

/** Optimal string alignment, so a swapped pair counts as one typo. Infinity once over `max`. */
function typoCount(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (max === 0 || Math.abs(a.length - b.length) > max) return Infinity;
  let beforePrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], beforePrev[j - 2] + 1);
      }
    }
    beforePrev = prev;
    prev = row;
  }
  return prev[b.length] <= max ? prev[b.length] : Infinity;
}

/** Lower is better, null is no match: literal hits 0-2, all words found 3, plus 1 per typo. */
export function fuzzyRank(text: string, query: string): number | null {
  const t = normalize(text);
  const q = normalize(query).trim();
  if (!q) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;

  const qWords = wordsOf(q);
  if (qWords.length === 0) return null;
  const tWords = wordsOf(t);

  // "acdc" finds "AC/DC". Anchored to a word start, or "nt" would match "in the" via "inthe".
  const qJoined = qWords.join('');
  const tJoined = tWords.join('');
  let offset = 0;
  const joinedHit = tWords.some(w => {
    const hit = tJoined.startsWith(qJoined, offset);
    offset += w.length;
    return hit;
  });
  const joinedTypos = joinedHit ? 0 : typoCount(qJoined, tJoined, allowedTypos(qJoined));

  let wordTypos = 0;
  for (const qWord of qWords) {
    if (tWords.some(w => w.startsWith(qWord))) continue;
    const max = allowedTypos(qWord);
    let best = Infinity;
    for (const w of tWords) best = Math.min(best, typoCount(qWord, w, max));
    wordTypos += best;
    if (wordTypos === Infinity) break;
  }

  const typos = Math.min(joinedTypos, wordTypos);
  return typos === Infinity ? null : NO_TYPOS_RANK + typos;
}

/**
 * For lists with their own sort order, where typo matches can't sink to the bottom. They
 * appear only when nothing matches as typed, or "love" would interleave "live" and "move".
 */
export function fuzzyFilter<T>(rows: T[], query: string, textOf: (_row: T) => string): T[] {
  if (!query.trim()) return rows;
  const asTyped: T[] = [];
  const withTypos: T[] = [];
  for (const row of rows) {
    const rank = fuzzyRank(textOf(row), query);
    if (rank === null) continue;
    (rank <= NO_TYPOS_RANK ? asTyped : withTypos).push(row);
  }
  return asTyped.length > 0 ? asTyped : withTypos;
}
