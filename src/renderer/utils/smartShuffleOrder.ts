/**
 * Smart Shuffle's ordering: a shuffle that leans toward tracks sounding like
 * the ones the listener stayed on and away from the ones they skipped, and
 * leans harder the longer they keep skipping. Pure, so
 * smartShuffleOrder.check.ts runs it under Node.
 *
 * A track is its MusiCNN embedding (moodFeatures.ts) with the library's mean
 * taken off. On one listener's labels, the five nearest tracks by that measure
 * shared the listener's mood quadrant 46% of the time, against 26% by chance.
 *
 * The numbers below were picked on simulated sessions over those labels
 * (November 2026): a listener who holds one mood skipped 18.4 of 30 tracks on a
 * plain shuffle and about 15.3 with these. A perfect similarity measure would
 * reach 12.5, so the measure, not this file, is what holds it back.
 */

export interface Signal {
  vec: Float32Array;
  /** Above zero for a stay, below for a skip; the size is how sure the signal is. */
  weight: number;
}

/** Signals older than this are forgotten: a mood is a recent thing. */
export const MAX_SIGNALS = 12;
/** Each older stay counts this much less than the one after it. */
const LIKE_DECAY = 0.85;
/**
 * Skips fade faster than stays: a run of skips should push away from those
 * tracks without wiping out the last thing the listener did enjoy.
 */
const SKIP_DECAY = 0.6;
/**
 * How many upcoming tracks are put in taste order when the listener is settled.
 * The queue is already shuffled, so these are a random sample of it and the
 * best of them is a lean, not the library's extreme.
 */
const WINDOW = 60;
/**
 * Every skip in a row doubles the reach, up to this many times: someone
 * skipping again and again is being lost, and finding a track they stay on
 * matters more than variety. Sorting the whole queue was tried and buried
 * everything like the skipped tracks at the very end, hence the cap.
 */
const MAX_DOUBLINGS = 3;

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/** Above zero: closer to what was stayed on than to what was skipped. `signals` runs oldest to newest. */
export function tasteScore(vec: Float32Array, signals: Signal[]): number {
  let like = 0;
  let likeWeights = 0;
  let skip = 0;
  let skipWeights = 0;
  signals.forEach((s, i) => {
    const age = signals.length - 1 - i;
    const similarity = cosine(vec, s.vec);
    if (s.weight > 0) {
      const w = LIKE_DECAY ** age * s.weight;
      like += w * similarity;
      likeWeights += w;
    } else {
      const w = SKIP_DECAY ** age * -s.weight;
      skip += w * similarity;
      skipWeights += w;
    }
  });
  return (likeWeights ? like / likeWeights : 0) - (skipWeights ? skip / skipWeights : 0);
}

export function skipStreak(signals: Signal[]): number {
  let streak = 0;
  for (let i = signals.length - 1; i >= 0 && signals[i].weight < 0; i--) streak++;
  return streak;
}

export interface TrackHistory {
  stays: number;
  skips: number;
}

// ponytail: how much a track's own record counts beside how it sounds, where
// taste runs about -1..1. A guess: no listening history existed to fit it on.
// Spotify's skip-prediction challenge found past skips the strongest predictor,
// so raise it once there is data to check against.
const HISTORY_WEIGHT = 0.3;
/** Reactions it takes for a track's record to count at half strength, so one skip isn't a verdict. */
const HISTORY_HALF = 2;

/** -1 for a track always skipped, 1 for one always stayed on, near 0 with little history. */
export function historyScore(history: TrackHistory | null | undefined): number {
  if (!history) return 0;
  return (history.stays - history.skips) / (history.stays + history.skips + HISTORY_HALF);
}

/**
 * `items` in shuffled order, with the next ones reordered best first: WINDOW of
 * them, doubled for each skip in a row. A track without a vector or a record is
 * neutral. Everything past that keeps its place.
 */
export function rerank<T>(
  items: T[],
  vecOf: (_item: T) => Float32Array | null | undefined,
  signals: Signal[],
  historyOf: (_item: T) => TrackHistory | null | undefined = () => null
): T[] {
  const reach = WINDOW * 2 ** Math.min(skipStreak(signals), MAX_DOUBLINGS);
  const scored = items.slice(0, reach).map(item => {
    const vec = vecOf(item);
    const taste = vec ? tasteScore(vec, signals) : 0;
    return { item, score: taste + HISTORY_WEIGHT * historyScore(historyOf(item)) };
  });
  // Array.prototype.sort is stable, so equal scores keep their shuffled order.
  scored.sort((x, y) => y.score - x.score);
  return [...scored.map(e => e.item), ...items.slice(reach)];
}

/**
 * What leaving a track says, as a signal weight. Staying past half is a full
 * stay, whether or not it played out. Leaving in the first 30% by pressing next
 * is a skip, stronger the sooner it came: a track dropped in three seconds was
 * rejected, one dropped at 25% was given a chance. Anything else says nothing.
 */
export function signalOf(position: number, duration: number, wentToNext: boolean): number | null {
  if (!(duration > 0)) return null;
  const heard = position / duration;
  if (heard >= 0.5) return 1;
  if (heard < 0.3 && wentToNext) return -(1 - heard / 0.6);
  return null;
}
