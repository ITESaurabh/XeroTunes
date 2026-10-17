/**
 * Runs the player element through the ten bands in eqMath. Routing an element into
 * Web Audio can't be undone, so nothing is wired until the EQ is first switched
 * on; a user who never opens it plays straight from the element as before.
 *
 * Once wired, Chromium still applies the element's volume and muted flag to the
 * source node, so fades, mute, casting and anything else that silences the
 * element keep working. The element's own setSinkId no longer reaches the
 * speakers, though; the output device is set on the context instead.
 */
import { EQ_Q, EqualizerSettings } from '../../config/equalizer';
import {
  BANDS,
  BASS_HIGHPASS,
  BASS_PEAK,
  BUTTERWORTH_Q_DB,
  CURVE_FREQS,
  responseDb,
  solveGains,
} from './eqMath';

interface Graph {
  ctx: AudioContext;
  /** Headroom gain ahead of the filters. */
  input: GainNode;
  filters: BiquadFilterNode[];
  /** Head of highpass → bass peak → limiter; the last filter feeds it while bass is up. */
  bassIn: BiquadFilterNode;
  bass: BiquadFilterNode;
}

let graph: Graph | null = null;
let sinkId = 'default';
// A source per element: creating a second one for the same element throws.
const sources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
let current: MediaElementAudioSourceNode | null = null;

// '' is Chromium's spelling of the system default sink; lib.dom predates the method.
const sink = (c: AudioContext, id: string): Promise<void> =>
  (c as AudioContext & { setSinkId: (_id: string) => Promise<void> }).setSinkId(
    id === 'default' ? '' : id
  );

// Device vanished: fall back to the system default so music keeps playing.
const sinkOrDefault = (c: AudioContext, id: string): void =>
  void sink(c, id).catch(() => sink(c, 'default').catch(() => undefined));

function build(): Graph {
  const ctx = new AudioContext({ latencyHint: 'playback' });
  const input = ctx.createGain();
  const filters = BANDS.map(band => {
    const f = ctx.createBiquadFilter();
    f.type = band.type;
    f.frequency.value = band.frequency;
    f.Q.value = EQ_Q;
    return f;
  });
  filters.reduce<AudioNode>((prev, next) => prev.connect(next), input);

  const bassIn = ctx.createBiquadFilter();
  bassIn.type = BASS_HIGHPASS.type;
  bassIn.frequency.value = BASS_HIGHPASS.frequency;
  bassIn.Q.value = BUTTERWORTH_Q_DB;
  const bass = ctx.createBiquadFilter();
  bass.type = BASS_PEAK.type;
  bass.frequency.value = BASS_PEAK.frequency;
  bass.Q.value = BASS_PEAK.q ?? EQ_Q;
  // Bass isn't counted in the headroom gain: a static cut that size would drop the
  // whole track by up to 15 dB. Like Android's bass engine, it keeps the level and
  // only pulls peaks down.
  // ponytail: a compressor at ratio 20 stands in for a limiter; its 3 ms attack lets
  // the first transient through. Swap in an AudioWorklet look-ahead limiter if that clicks.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  bassIn.connect(bass).connect(limiter).connect(ctx.destination);

  sinkOrDefault(ctx, sinkId);
  return { ctx, input, filters, bassIn, bass };
}

function sourceFor(ctx: AudioContext, audio: HTMLAudioElement): MediaElementAudioSourceNode {
  let source = sources.get(audio);
  if (!source) {
    source = ctx.createMediaElementSource(audio);
    sources.set(audio, source);
    // A context made before any user gesture can start suspended, and a
    // suspended context plays the element as silence.
    audio.addEventListener('play', () => {
      if (ctx.state === 'suspended') void ctx.resume();
    });
  }
  return source;
}

export function applyEqualizer(audio: HTMLAudioElement | null, eq: EqualizerSettings): void {
  if (!audio || (!eq.enabled && !graph)) return;
  graph ??= build();
  const { ctx, input, filters, bassIn, bass } = graph;
  const source = sourceFor(ctx, audio);
  if (current && current !== source) current.disconnect();
  current = source;
  source.disconnect();
  if (!eq.enabled) {
    // Off is a straight wire, not ten filters at 0 dB.
    source.connect(ctx.destination);
    return;
  }
  const gains = solveGains(eq.gains, ctx.sampleRate);
  gains.forEach((db, i) => {
    if (filters[i]) filters[i].gain.value = db;
  });
  // Headroom for the loudest point of the combined curve, not the tallest slider:
  // neighbouring boosts sum past any one of them. Above Nyquist there's nothing to measure.
  const audible = CURVE_FREQS.filter(f => f < ctx.sampleRate / 2);
  const peak = Math.max(0, ...responseDb(gains, audible, ctx.sampleRate));
  input.gain.value = 10 ** (-peak / 20);
  // At 0 the stage leaves the chain, so its highpass and limiter don't colour plain EQ.
  const tail = filters[filters.length - 1];
  tail.disconnect();
  if (eq.bass > 0) {
    bass.gain.value = eq.bass;
    tail.connect(bassIn);
  } else {
    tail.connect(ctx.destination);
  }
  source.connect(input);
}

export function setEqualizerSink(deviceId: string): void {
  sinkId = deviceId;
  if (graph) sinkOrDefault(graph.ctx, deviceId);
}
