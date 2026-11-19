/**
 * Turns the mood models' outputs (moodFeatures.ts) and a track's lyrics into
 * one point on the arousal (calm..energetic) x valence (dark..bright) map.
 * Pure, so moodScore.check.ts and misc/lab/mood-poc.mjs run it under Node.
 */

// ponytail: a hand list of English words; swap for a text-embedding model if
// lyrics need to carry more, or to cover other languages.
const words = (s: string) => new Set(s.split(' '));
const POS = words(
  'love happy joy smile shine light bright dance party fun free alive sun summer sweet beautiful heaven celebrate good great best wonderful laugh dream dreams hope glory gold high fly forever together kiss baby darling honey paradise sunshine yeah woo'
);
const NEG = words(
  'sad cry cried tears lonely alone pain hurt broken break dark death die died dead lost lose losing sorry goodbye hate hell fear afraid scared cold empty nothing never grave blood bleed scream kill killed fight war fall falling fell regret miss missing gone end ghost demons nightmare drown shadow numb sick wrong fail failed hollow fucked'
);
const ANGRY = words(
  'hate kill fight war blood scream rage fuck fucking bitch shit die bullet gun enemy destroy burn punch smash violence revenge'
);
const SAD = words(
  'sad cry cried tears lonely alone pain hurt broken goodbye miss missing gone empty regret sorry lost cold numb hollow'
);

export interface LyricFeatures {
  /** Positive minus negative words, per 100 words. */
  lyrPos: number;
  /** Angry and sad words per 100 words. */
  lyrAngry: number;
  lyrSad: number;
}

/** Zeros without lyrics. LRC timestamps and tags don't match a word, so synced lyrics need no cleaning. */
export function lyricFeatures(text: string | null | undefined): LyricFeatures {
  if (!text) return { lyrPos: 0, lyrAngry: 0, lyrSad: 0 };
  const w = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const per100 = (set: Set<string>) =>
    (100 * w.filter(x => set.has(x)).length) / Math.max(w.length, 1);
  return { lyrPos: per100(POS) - per100(NEG), lyrAngry: per100(ANGRY), lyrSad: per100(SAD) };
}

// ponytail: fitted by ridge regression to one listener's 202 labels
// (misc/lab/mood-poc.mjs, November 2026). Refit on more listeners, or per user
// from their skips, before reading much into a single track's placement.
const AROUSAL: Record<string, number> = {
  happy: -0.304,
  sad: -0.529,
  aggressive: 0.149,
  relaxed: 0.296,
  party: 0.735,
  deamV: 0.284,
  deamA: -0.622,
  emoA: 0.545,
  bias: -1.943,
};
const VALENCE: Record<string, number> = {
  happy: -0.331,
  sad: 0.274,
  aggressive: -0.118,
  relaxed: 0.382,
  deamV: -0.186,
  deamA: 0.08,
  emoV: 0.678,
  emoA: 0.071,
  bias: -3.395,
};
/** Added to valence when the track has lyrics. They told nothing about arousal. */
const VALENCE_LYRICS: Record<string, number> = { lyrPos: 0.038, lyrAngry: -0.072 };

export type Mood = 'party' | 'intense' | 'chill' | 'moody';
export const MOOD_LABEL: Record<Mood, string> = {
  party: 'Happy, energetic',
  intense: 'Angry, intense',
  chill: 'Happy, calm',
  moody: 'Sad, moody',
};

const weighted = (values: Record<string, number | undefined>, weights: Record<string, number>) =>
  Object.entries(weights).reduce(
    (sum, [k, w]) => sum + w * (k === 'bias' ? 1 : (values[k] ?? 0)),
    0
  );

/** `lyrics` is left out when the track has none or the user turned lyrics off. */
export function moodOf(
  features: Record<string, number | undefined>,
  lyrics?: LyricFeatures | null
): { arousal: number; valence: number; mood: Mood } {
  const arousal = weighted(features, AROUSAL);
  const valence =
    weighted(features, VALENCE) + (lyrics ? weighted({ ...lyrics }, VALENCE_LYRICS) : 0);
  const mood =
    arousal >= 0 ? (valence >= 0 ? 'party' : 'intense') : valence >= 0 ? 'chill' : 'moody';
  return { arousal, valence, mood };
}
