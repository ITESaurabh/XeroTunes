/**
 * Timing for the surround mic sync: the front and the rear play tone bursts
 * at their own pitch, and one recording of both gives the gap between them.
 */
export const FRONT_HZ = 1000;
export const REAR_HZ = 2500;

// How early a rear burst may land and still belong to the front burst before it.
const EARLIEST_MS = 200;

/**
 * Energy at `hz` in 5 ms windows, one per millisecond (Goertzel). Hann
 * weighted: unweighted, a loud rear burst leaks into the front's band and
 * reads as a front burst.
 */
function envelope(x: Float32Array, sampleRate: number, hz: number): Float32Array {
  const hop = Math.round(sampleRate / 1000);
  const win = hop * 5;
  const hann = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1)));
  const k = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  const out = new Float32Array(Math.max(0, Math.floor((x.length - win) / hop)));
  for (let h = 0; h < out.length; h++) {
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < win; i++) {
      const s0 = x[h * hop + i] * hann[i] + k * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    out[h] = s1 * s1 + s2 * s2 - k * s1 * s2;
  }
  return out;
}

/** Start of each burst at `hz`, in ms. Bursts of one pitch are `apartMs` apart. */
export function onsets(x: Float32Array, sampleRate: number, hz: number, apartMs: number): number[] {
  const e = envelope(x, sampleRate, hz);
  if (!e.length) return [];
  const floor = Array.from(e).sort((a, b) => a - b)[e.length >> 1];
  const loudest = e.reduce((a, b) => Math.max(a, b), 0);
  // ~15 dB over the room, and above the echo of the loudest burst.
  const threshold = Math.max(floor * 30, loudest * 0.02);
  const found: number[] = [];
  for (let i = 0; i < e.length; i++) {
    if (e[i] <= threshold) continue;
    let peak = 0;
    for (let j = i; j < Math.min(e.length, i + 60); j++) peak = Math.max(peak, e[j]);
    // Half of this burst's own peak, so a quiet speaker and a loud one read alike.
    let k = Math.max(0, i - 10);
    while (e[k] < peak / 2) k++;
    found.push(k);
    i += Math.floor(apartMs / 2);
  }
  return found;
}

/**
 * Median rear-minus-front gap in ms for `pairs` bursts fired every `everyMs`,
 * or null when fewer than half the pairs were heard or they disagree. Gaps
 * from -EARLIEST_MS to everyMs - EARLIEST_MS are told apart.
 */
export function gapMs(x: Float32Array, sampleRate: number, pairs: number, everyMs: number): number | null {
  const rear = onsets(x, sampleRate, REAR_HZ, everyMs);
  const gaps: number[] = [];
  for (const f of onsets(x, sampleRate, FRONT_HZ, everyMs)) {
    const r = rear.find(t => t >= f - EARLIEST_MS && t < f + everyMs - EARLIEST_MS);
    if (r !== undefined) gaps.push(r - f);
  }
  if (gaps.length < pairs / 2) return null;
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  // A Bluetooth rear lands single clicks up to ~26 ms either side of its mean.
  const agree = gaps.filter(g => Math.abs(g - median) <= 30).length;
  return agree >= pairs / 2 ? median : null;
}
