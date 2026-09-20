/**
 * One AudioContext per output device (Chromium binds a context to a single
 * sink), each with its own delay so devices with different latencies can be
 * lined up. Music comes in through audio.captureStream(); the element itself
 * stays muted and only keeps the transport. See docs/surround-plan.md.
 */
import type { SurroundDevice, SurroundSettings } from '../../config/app_settings';
import { SURROUND_PRESETS, SurroundPreset } from '../../config/surroundPresets';

interface Chain {
  ctx: AudioContext;
  delay: DelayNode;
  gain: GainNode;
  level: number;
}

// Steering: every STEER_MS the L/R correlation is read off analysers and the
// front or rear ducked towards a floor when the mix is clearly one or the
// other. A passive matrix alone separates ~5 dB; a preset's `steer` scales
// how deep the ducking goes.
const STEER_MS = 25;
const STEER_ATTACK_S = 0.02;
const STEER_RELEASE_S = 0.15;
const FRONT_FLOOR = 0.15;
const REAR_FLOOR = 0.3;
// ponytail: fixed comb offset for mono rears; an allpass diffuser if the hollowness shows.
const MONO_DECORRELATE_MS = 12;

// captureStream() only hands over the stereo downmix, so multichannel files
// are decoded whole and their channels played from a buffer.
// ponytail: whole-file decode, ~1.2 MB/s of 5.1 float; WebCodecs streaming if long 5.1 albums matter.
const MAX_DISCRETE_S = 360;

const chains = new Map<string, Chain>();

interface Discrete {
  front: AudioBuffer;
  rear: AudioBuffer;
  sources: AudioBufferSourceNode[];
  onPlaying: () => void;
  onPause: () => void;
}

let attached: {
  audio: HTMLAudioElement;
  settings: SurroundSettings;
  stream: MediaStream | null;
  inputs: AudioNode[];
  poll: number | null;
  steer: number | null;
  discrete: Discrete | null;
  /** Bumped on every release so a decode that lands late is thrown away. */
  generation: number;
  arm: () => void;
  release: () => void;
  onVolume: () => void;
} | null = null;

if (process.env.NODE_ENV === 'development') {
  Object.assign(window, { surroundChains: chains, surroundState: () => attached });
}

export function open(deviceId: string): Chain {
  let chain = chains.get(deviceId);
  if (chain) return chain;
  // '' is Chromium's spelling of the system default sink. The lib.dom types
  // predate the sinkId option.
  const ctx = new AudioContext({
    sinkId: deviceId === 'default' ? '' : deviceId,
  } as AudioContextOptions);
  const delay = ctx.createDelay(1);
  const gain = ctx.createGain();
  delay.connect(gain).connect(ctx.destination);
  chain = { ctx, delay, gain, level: 1 };
  // When a sink dies (Bluetooth drop) Chromium quietly renders to the system
  // default instead; better silence on that chain than music on a random device.
  ctx.addEventListener('error', () => {
    gain.gain.value = 0;
  });
  chains.set(deviceId, chain);
  return chain;
}

export function setDelay(deviceId: string, ms: number): void {
  open(deviceId).delay.delayTime.value = Math.max(0, ms) / 1000;
}

export function setLevel(device: SurroundDevice): void {
  const chain = open(device.deviceId);
  chain.level = device.muted ? 0 : device.volume / 100;
  chain.gain.gain.value = chain.level;
}

/** The player volume drives the front alone; the rear keeps its mixer level. */
export function setVolume(v: number): void {
  const front = attached && chains.get(attached.settings.front.deviceId);
  if (front) front.gain.gain.value = v;
}

/**
 * 10 ms 1 kHz blip through each device's delay, all fired together, scaled
 * against the chain gain so they land at the same level whatever the mixer says.
 */
export function click(deviceIds: string[]): void {
  for (const id of deviceIds) {
    const { ctx, delay, gain } = open(id);
    const level = gain.gain.value;
    if (level < 0.01) continue;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    env.gain.value = 0.5 / level;
    osc.frequency.value = 1000;
    osc.connect(env).connect(delay);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  }
}

export const isAttached = (): boolean => attached !== null;
export const isPlaying = (): boolean => attached !== null && !attached.audio.paused;
export const isDiscrete = (): boolean => attached !== null && attached.discrete !== null;

/**
 * Fold a decoded multichannel buffer into what the two outputs need. Channel
 * order is the FLAC/WAV mask order Chromium decodes to: FL FR FC LFE, then
 * BL BR (5.1), BC SL SR (6.1) or BL BR SL SR (7.1).
 */
function foldChannels(buf: AudioBuffer): { front: AudioBuffer; rear: AudioBuffer } | null {
  const n = buf.numberOfChannels;
  if (n < 4) return null;
  const ch = (i: number): Float32Array => buf.getChannelData(i);
  const mix = (parts: Array<[Float32Array, number]>): Float32Array => {
    const out = new Float32Array(buf.length);
    for (const [src, g] of parts) for (let i = 0; i < out.length; i++) out[i] += src[i] * g;
    return out;
  };
  // LFE is dropped, as the standard stereo downmix does: small speakers turn it into rattle.
  const centre: Array<[Float32Array, number]> = n >= 5 ? [[ch(2), 0.707]] : [];
  const frontL = mix([[ch(0), 1], ...centre]);
  const frontR = mix([[ch(1), 1], ...centre]);
  let rear: [Float32Array, Float32Array];
  if (n === 4) rear = [ch(2), ch(3)];
  else if (n === 5) rear = [ch(3), ch(4)];
  else if (n === 6) rear = [ch(4), ch(5)];
  else if (n === 7) rear = [mix([[ch(5), 1], [ch(4), 0.707]]), mix([[ch(6), 1], [ch(4), 0.707]])];
  else rear = [mix([[ch(4), 0.707], [ch(6), 0.707]]), mix([[ch(5), 0.707], [ch(7), 0.707]])];
  const pack = (l: Float32Array, r: Float32Array): AudioBuffer => {
    const out = new AudioBuffer({ numberOfChannels: 2, length: buf.length, sampleRate: buf.sampleRate });
    // lib.dom wants Float32Array<ArrayBuffer>; getChannelData hands back ArrayBufferLike.
    out.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    out.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    return out;
  };
  return { front: pack(frontL, frontR), rear: pack(rear[0], rear[1]) };
}

async function readLocalFile(src: string): Promise<ArrayBuffer | null> {
  if (!src.startsWith('file:')) return null;
  const fs = window.require('fs') as typeof import('fs');
  const path = decodeURIComponent(new URL(src).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const buf = await fs.promises.readFile(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Apply delays and levels without touching the capture. */
export function configure({ front, rear, offsetMs }: SurroundSettings): void {
  setDelay(front.deviceId, offsetMs);
  if (rear) {
    setLevel(rear);
    setDelay(rear.deviceId, -offsetMs);
  }
}

const preset = (key: string): SurroundPreset => SURROUND_PRESETS[key] ?? SURROUND_PRESETS.natural;

/** Exponentially decaying stereo noise: a room without measuring one. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  }
  return buf;
}

/** Whether these settings need the audio graph rebuilt rather than re-levelled. */
const graphKey = (s: SurroundSettings): string =>
  [s.front.deviceId, s.rear?.deviceId, s.rear?.kind, s.preset].join('|');

/** Route the element's audio to front (as is) and rear (the preset's ambience feed). */
export function attach(audio: HTMLAudioElement, settings: SurroundSettings): void {
  const rearId = settings.rear?.deviceId ?? '';
  const sameDevices =
    attached?.audio === audio &&
    attached.settings.front.deviceId === settings.front.deviceId &&
    attached.settings.rear?.deviceId === rearId;
  if (!sameDevices) detach();
  configure(settings);
  if (attached) {
    const rebuild = graphKey(attached.settings) !== graphKey(settings);
    attached.settings = settings;
    if (rebuild) attached.arm();
    return;
  }
  if (!rearId) return;

  // Chromium feeds only the newest captureStream() of an element, and a
  // source node whose track merely stopped delivering keeps replaying its
  // last buffer. So the old track is stopped for good as soon as the element
  // empties, and nothing else in the app may capture this element.
  const release = (): void => {
    if (!attached) return;
    attached.generation++;
    if (attached.poll) window.clearInterval(attached.poll);
    if (attached.steer) window.clearInterval(attached.steer);
    attached.poll = attached.steer = null;
    for (const n of attached.inputs) n.disconnect();
    attached.inputs = [];
    attached.stream?.getTracks().forEach(t => t.stop());
    attached.stream = null;
    const d = attached.discrete;
    if (d) {
      d.onPause();
      audio.removeEventListener('playing', d.onPlaying);
      audio.removeEventListener('seeked', d.onPlaying);
      audio.removeEventListener('pause', d.onPause);
      attached.discrete = null;
    }
  };

  // A file with surround channels replaces the matrix path; the muted element stays the clock.
  const loadDiscrete = async (): Promise<void> => {
    if (!attached || !attached.settings.rear || audio.duration > MAX_DISCRETE_S) return;
    const generation = attached.generation;
    const frontId = attached.settings.front.deviceId;
    const rearId = attached.settings.rear.deviceId;
    let folded: ReturnType<typeof foldChannels> = null;
    try {
      const bytes = await readLocalFile(audio.src);
      if (!bytes) return;
      folded = foldChannels(await open(frontId).ctx.decodeAudioData(bytes));
    } catch {
      return;
    }
    if (!folded || !attached || attached.generation !== generation) return;
    // Real channels replace the matrix feed and its steering; delay and levels stay.
    if (attached.steer) window.clearInterval(attached.steer);
    attached.steer = null;
    for (const n of attached.inputs) n.disconnect();
    attached.inputs = [];
    attached.stream?.getTracks().forEach(t => t.stop());
    attached.stream = null;

    const d: Discrete = {
      ...folded,
      sources: [],
      onPause: () => {
        for (const s of d.sources) s.stop();
        d.sources = [];
      },
      onPlaying: () => {
        d.onPause();
        const at = audio.currentTime;
        const feeds: Array<[string, AudioBuffer]> = [
          [frontId, d.front],
          [rearId, d.rear],
        ];
        for (const [id, buffer] of feeds) {
          const { ctx, delay } = open(id);
          const s = ctx.createBufferSource();
          s.buffer = buffer;
          s.connect(delay);
          s.start(0, at);
          d.sources.push(s);
        }
      },
    };
    attached.discrete = d;
    audio.addEventListener('playing', d.onPlaying);
    audio.addEventListener('seeked', d.onPlaying);
    audio.addEventListener('pause', d.onPause);
    if (!audio.paused) d.onPlaying();
  };

  const capture = (): void => {
    if (!attached) return;
    release();
    const { front: frontDev, rear } = attached.settings;
    if (!rear) return;
    const p = preset(attached.settings.preset);
    const stream = (
      audio as HTMLAudioElement & { captureStream: () => MediaStream }
    ).captureStream();
    if (stream.getAudioTracks().length === 0) return;
    attached.stream = stream;

    const front = open(frontDev.deviceId);
    const frontSrc = front.ctx.createMediaStreamSource(stream);
    const frontSteer = front.ctx.createGain();
    frontSrc.connect(frontSteer).connect(front.delay);
    attached.inputs.push(frontSrc);

    const { ctx, delay } = open(rear.deviceId);
    const rearSrc = ctx.createMediaStreamSource(stream);
    attached.inputs.push(rearSrc);
    if (p.bypass) {
      rearSrc.connect(delay);
      void loadDiscrete();
      return;
    }
    const split = ctx.createChannelSplitter(2);
    rearSrc.connect(split);

    const sum = (weights: [number, number], scale: number): GainNode => {
      const out = ctx.createGain();
      out.gain.value = scale;
      weights.forEach((w, channel) => {
        const g = ctx.createGain();
        g.gain.value = w;
        split.connect(g, channel);
        g.connect(out);
      });
      return out;
    };
    const mid = sum([0.5, 0.5], p.mid);
    const side = sum([0.5, -0.5], p.side);
    // Stereo rear: L = mid + side, R = mid − side. A mono box sums its two
    // channels, so it gets mid + side on both instead of a pair that cancels;
    // side is pushed back a few ms first so a right-panned source (negative
    // side) adds to mid in energy rather than cancelling it.
    const merge = ctx.createChannelMerger(2);
    const mono = rear.kind === 'mono';
    const sideRight = ctx.createGain();
    sideRight.gain.value = mono ? 1 : -1;
    let sideOut: AudioNode = side;
    if (mono) {
      const decorrelate = ctx.createDelay(0.05);
      decorrelate.delayTime.value = MONO_DECORRELATE_MS / 1000;
      sideOut = side.connect(decorrelate);
    }
    mid.connect(merge, 0, 0);
    mid.connect(merge, 0, 1);
    sideOut.connect(merge, 0, 0);
    sideOut.connect(sideRight).connect(merge, 0, 1);

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = p.highpassHz;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = p.lowpassHz;
    const haas = ctx.createDelay(0.1);
    haas.delayTime.value = p.delayMs / 1000;
    const trim = ctx.createGain();
    trim.gain.value = 10 ** (p.trimDb / 20);
    const rearSteer = ctx.createGain();
    merge.connect(highpass).connect(lowpass).connect(haas);
    haas.connect(trim);
    if (p.reverbS > 0) {
      const reverb = ctx.createConvolver();
      reverb.buffer = impulse(ctx, p.reverbS);
      const wet = ctx.createGain();
      wet.gain.value = p.reverbMix;
      haas.connect(reverb).connect(wet).connect(trim);
    }
    trim.connect(rearSteer).connect(delay);
    void loadDiscrete();

    if (p.steer <= 0) return;
    const frontFloor = 1 - p.steer * (1 - FRONT_FLOOR);
    const rearFloor = 1 - p.steer * (1 - REAR_FLOOR);
    // Energy taps: L, R, L+R and L-R. In-phase content dominates the sum,
    // anti-phase (matrix-encoded rear) dominates the difference.
    const tap = (...inputs: Array<[number, number]>): (() => number) => {
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      for (const [channel, sign] of inputs) {
        const g = ctx.createGain();
        g.gain.value = sign;
        split.connect(g, channel);
        g.connect(an);
      }
      const buf = new Float32Array(an.fftSize);
      return () => {
        an.getFloatTimeDomainData(buf);
        let e = 0;
        for (const v of buf) e += v * v;
        return e;
      };
    };
    const eL = tap([0, 1]);
    const eR = tap([1, 1]);
    const eSum = tap([0, 1], [1, 1]);
    const eDiff = tap([0, 1], [1, -1]);
    attached.steer = window.setInterval(() => {
      const s = eSum();
      const d = eDiff();
      const l = eL();
      const r = eR();
      if (s + d < 1e-6) return;
      // +1 all in-phase (front/centre), -1 all anti-phase (back), 0 uncorrelated.
      const phase = (s - d) / (s + d);
      // 1 when everything sits hard on one side; matrix decoders send that to the front.
      const sideness = Math.abs(l - r) / (l + r + 1e-9);
      const frontTarget = phase < 0 ? 1 + phase * (1 - frontFloor) : 1;
      const rearTarget = Math.min(
        phase > 0 ? 1 - phase * (1 - rearFloor) : 1,
        1 - sideness * (1 - rearFloor)
      );
      const tc = (node: GainNode, target: number): AudioParam =>
        node.gain.setTargetAtTime(
          target,
          node.context.currentTime,
          target < node.gain.value ? STEER_ATTACK_S : STEER_RELEASE_S
        );
      tc(frontSteer, frontTarget);
      tc(rearSteer, rearTarget);
    }, STEER_MS);
  };
  // A capture taken while the new pipeline is still spinning up (even at
  // `playing`) never gets audio; one taken once the clock has moved does.
  const arm = (): void => {
    if (!attached) return;
    release();
    if (audio.currentTime > 0) return capture();
    attached.poll = window.setInterval(() => {
      if (audio.currentTime > 0) capture();
    }, 20);
  };
  const onVolume = (): void => setVolume(audio.volume);

  attached = {
    audio,
    settings,
    stream: null,
    inputs: [],
    poll: null,
    steer: null,
    discrete: null,
    generation: 0,
    arm,
    release,
    onVolume,
  };
  audio.addEventListener('loadedmetadata', arm);
  audio.addEventListener('emptied', release);
  audio.addEventListener('volumechange', onVolume);
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) arm();
  onVolume();
}

export function detach(): void {
  if (attached) {
    attached.release();
    attached.audio.removeEventListener('loadedmetadata', attached.arm);
    attached.audio.removeEventListener('emptied', attached.release);
    attached.audio.removeEventListener('volumechange', attached.onVolume);
    attached = null;
  }
  close();
}

export function close(): void {
  for (const { ctx } of chains.values()) void ctx.close();
  chains.clear();
}
