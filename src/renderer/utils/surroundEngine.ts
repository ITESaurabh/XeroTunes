/**
 * One AudioContext does the processing, sunk to the front device; the rear
 * plays from a second context on its own device, fed through an AudioWorklet
 * ring. Both outputs read one capture on purpose: a fresh capture's FIFO
 * settles at a random fill, and with a capture per device every track change
 * re-rolled the front/rear offset. The ring replaced an <audio> element on a
 * MediaStreamAudioDestinationNode, whose stream renderer kept re-timing the
 * rear against Bluetooth's jittery clock reports and wandered over ~25 ms.
 * The music element stays muted and only keeps the transport. See
 * docs/surround-plan.md.
 */
import type { SurroundDevice, SurroundSettings } from '../../config/surround';
import { SURROUND_PRESETS, SurroundPreset } from '../../config/surroundPresets';
import { FRONT_HZ, REAR_HZ, gapMs } from './micSync';

type Role = 'front' | 'rear';

interface Chain {
  ctx: AudioContext;
  delay: DelayNode;
  gain: GainNode;
  deviceId: string;
  /** Rear only: fills the ring from `gain`. */
  writer: Promise<AudioWorkletNode> | null;
  /** Rear only: the context on the rear device that plays the ring. */
  out: AudioContext | null;
  /** Rear only: the ring has been re-centred since it last (re)started. */
  settled: boolean;
  /** Rear only: the device left the device list and `out` is waiting to be rebuilt. */
  lost: boolean;
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

// A capture that binds before the pipeline delivers stays silent for good;
// recapture once the clock has moved this long with nothing reaching the graph.
const WATCH_MS = 250;
const SILENT_MS = 1000;

// captureStream() only hands over the stereo downmix, so multichannel files
// are decoded whole and their channels played from a buffer.
// ponytail: whole-file decode, ~1.2 MB/s of 5.1 float; WebCodecs streaming if long 5.1 albums matter.
const MAX_DISCRETE_S = 360;

let ctx: AudioContext | null = null;
const chains = new Map<Role, Chain>();

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
  watch: number | null;
  discrete: Discrete | null;
  /** Src already found to have no surround channels; not decoded again. */
  stereoSrc: string | null;
  arm: () => void;
  release: () => void;
  onVolume: () => void;
} | null = null;

if (process.env.NODE_ENV === 'development') {
  Object.assign(window, { surroundChains: chains, surroundState: () => attached });
}

// '' is Chromium's spelling of the system default sink; lib.dom predates the method.
const sinkContext = (c: AudioContext, deviceId: string): void => {
  const sinkable = c as AudioContext & { setSinkId: (_id: string) => Promise<void> };
  void sinkable.setSinkId(deviceId === 'default' ? '' : deviceId).catch(() => undefined);
};

// The ring carries frames, so the rear context runs at the main one's rate.
// The writer posts 256-frame blocks from the processing context; the reader
// plays them on the rear device and holds the ring's fill at TARGET (32 ms at
// 48 kHz). Bluetooth pulls in bursts: the fill swings ~25 ms within a second
// and wanders ±7 ms over a few more, while the speaker's own buffer keeps
// playback steady. Chasing that jitter is what made the <audio> rear wander,
// so only 10 s means are acted on: one jump 5 s after (re)priming, then single
// samples skipped or repeated against clock drift. A starved or overrun ring
// re-primes rather than keeping the error as delay. `mic-tap` feeds micSync.
const WORKLETS = `
const RING = 1 << 15;
const TARGET = 1536;
registerProcessor('ring-writer', class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.n = 0;
    this.l = new Float32Array(256);
    this.r = new Float32Array(256);
    this.port.onmessage = e => { this.out = e.data; };
  }
  process([input]) {
    if (!this.out) return true;
    if (input[0]) {
      this.l.set(input[0], this.n);
      this.r.set(input[1] || input[0], this.n);
    }
    this.n += 128;
    if (this.n === 256) {
      this.out.postMessage([this.l, this.r], [this.l.buffer, this.r.buffer]);
      this.l = new Float32Array(256);
      this.r = new Float32Array(256);
      this.n = 0;
    }
    return true;
  }
});
registerProcessor('ring-reader', class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.l = new Float32Array(RING);
    this.r = new Float32Array(RING);
    this.w = 0;
    this.rd = 0;
    this.run = false;
    this.port.onmessage = e => {
      e.data.onmessage = ({ data: [l, r] }) => {
        for (let i = 0; i < l.length; i++) {
          const k = (this.w + i) & (RING - 1);
          this.l[k] = l[i];
          this.r[k] = r[i];
        }
        this.w += l.length;
      };
    };
  }
  process(_, [[L, R]]) {
    const fill = this.w - this.rd;
    if (!this.run || fill < L.length || fill > RING) {
      if (this.run) this.port.postMessage(false);
      this.run = false;
      if (fill < TARGET) return true;
      this.rd = this.w - TARGET;
      this.run = true;
      this.centred = false;
      this.block = 1875;
      this.sum = this.count = this.pending = 0;
      this.spacing = 1;
      return true;
    }
    this.sum += fill;
    this.count++;
    for (let i = 0; i < L.length; i++) {
      const k = this.rd++ & (RING - 1);
      L[i] = this.l[k];
      R[i] = this.r[k];
    }
    if (this.pending && this.count % this.spacing === 0) {
      const s = Math.sign(this.pending);
      this.rd += s;
      this.pending -= s;
    }
    if (this.count === this.block) {
      const err = this.sum / this.count - TARGET;
      if (!this.centred || Math.abs(err) > 960) {
        this.rd += Math.round(err);
        this.pending = 0;
        if (!this.centred) this.port.postMessage(true);
        this.centred = true;
      } else if (Math.abs(err) > 24) {
        this.pending = Math.round(err * 0.8);
        this.spacing = Math.max(1, Math.floor(3750 / Math.abs(this.pending)));
      }
      this.block = 3750;
      this.sum = this.count = 0;
    }
    return true;
  }
});
registerProcessor('mic-tap', class extends AudioWorkletProcessor {
  process([input]) {
    this.port.postMessage(input[0] ? input[0].slice() : new Float32Array(128));
    return true;
  }
});
`;

let workletUrl: string | null = null;
const worklets = new WeakMap<BaseAudioContext, Promise<void>>();
const loadWorklets = (c: BaseAudioContext): Promise<void> => {
  workletUrl ??= URL.createObjectURL(new Blob([WORKLETS], { type: 'text/javascript' }));
  let loaded = worklets.get(c);
  if (!loaded) {
    loaded = c.audioWorklet.addModule(workletUrl);
    worklets.set(c, loaded);
  }
  return loaded;
};

// An analyser with nothing downstream is an automatic pull node, and a context
// that has one is never moved to Chromium's fake sink after 30 s of silence.
// Coming back from it drains a few stored buffers first, which adds a random
// delay to that output until it is reopened.
const keepAwake = (node: AudioNode): void => {
  node.connect(node.context.createAnalyser());
};

/** A context on the rear device playing the ring that `chain.writer` fills. */
function rearOutput(chain: Chain): AudioContext {
  const out = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: chain.ctx.sampleRate,
    sinkId: chain.deviceId === 'default' ? '' : chain.deviceId,
  } as AudioContextOptions);
  chain.settled = false;
  // Chromium renders a context whose sink died to the system default instead;
  // better silence than music on a random device. The next devicechange that
  // lists the rear again rebuilds it.
  out.addEventListener('error', () => {
    chain.lost = true;
    void out.close();
  });
  void Promise.all([chain.writer, loadWorklets(out)])
    .then(([writer]) => {
      if (chain.out !== out || !writer) return;
      const reader = new AudioWorkletNode(out, 'ring-reader', {
        numberOfInputs: 0,
        outputChannelCount: [2],
      });
      reader.port.onmessage = e => {
        if (chain.out === out) chain.settled = e.data;
      };
      const { port1, port2 } = new MessageChannel();
      writer.port.postMessage(port1, [port1]);
      reader.port.postMessage(port2, [port2]);
      reader.connect(out.destination);
      keepAwake(reader);
    })
    .catch(() => undefined);
  return out;
}

const reopenRear = (chain: Chain): void => {
  // Already closed if its sink died.
  chain.out?.close().catch(() => undefined);
  chain.lost = false;
  chain.out = rearOutput(chain);
};

// A Bluetooth rear keeps its id across a drop, and setSinkId to the current id
// is a no-op, so the context that lost the device never reopens it. It gets a
// fresh one when the device is listed again. Not muted meanwhile: a Bluetooth
// headset went missing from one enumeration with no devicechange after it came
// back, and the mute stuck.
let deviceScan = 0;
const onDeviceChange = async (): Promise<void> => {
  const scan = ++deviceScan;
  const list = await navigator.mediaDevices.enumerateDevices().catch(() => null);
  const rear = chains.get('rear');
  if (scan !== deviceScan || !list || !rear?.out) return;
  if (!list.some(d => d.kind === 'audiooutput' && d.deviceId === rear.deviceId)) rear.lost = true;
  else if (rear.lost) reopenRear(rear);
};

export function open(role: Role, deviceId: string): Chain {
  let chain = chains.get(role);
  if (chain) {
    if (chain.deviceId !== deviceId) {
      chain.deviceId = deviceId;
      if (chain.out) reopenRear(chain);
      else sinkContext(chain.ctx, deviceId);
    }
    return chain;
  }
  if (!ctx) {
    ctx = new AudioContext();
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
  }
  const c = ctx;
  const delay = c.createDelay(1);
  const gain = c.createGain();
  delay.connect(gain);
  keepAwake(gain);
  let writer: Promise<AudioWorkletNode> | null = null;
  if (role === 'front') {
    gain.connect(c.destination);
    sinkContext(c, deviceId);
    // When a sink dies (Bluetooth drop) Chromium quietly renders to the system
    // default instead; better silence on that chain than music on a random device.
    c.addEventListener('error', () => {
      gain.gain.value = 0;
    });
  } else {
    writer = loadWorklets(c).then(() => {
      const node = new AudioWorkletNode(c, 'ring-writer', {
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      gain.connect(node);
      // Its output is silent; the connection only gets the node rendered.
      node.connect(c.destination);
      return node;
    });
  }
  chain = { ctx: c, delay, gain, deviceId, writer, out: null, settled: false, lost: false };
  if (writer) chain.out = rearOutput(chain);
  chains.set(role, chain);
  return chain;
}

/** Offset > 0 delays the front (rear is slow), < 0 delays the rear. */
export function setOffset(frontId: string, rearId: string | undefined, ms: number): void {
  open('front', frontId).delay.delayTime.value = Math.max(0, ms) / 1000;
  if (rearId) open('rear', rearId).delay.delayTime.value = Math.max(0, -ms) / 1000;
}

export function setLevel(device: SurroundDevice): void {
  open('rear', device.deviceId).gain.gain.value = device.muted ? 0 : device.volume / 100;
}

/** The player volume drives the front alone; the rear keeps its mixer level. */
export function setVolume(v: number): void {
  const front = attached && chains.get('front');
  if (front) front.gain.gain.value = v;
}

// -6 dBFS. A page can't read a device's hardware ceiling, so this is the
// loudest fixed level that stays clear of the full-scale click that made a
// Bluetooth rear crackle and drop off the link.
const CLICK_PEAK = 0.5;

/**
 * A tone burst into the chain's delay, scaled against its gain so it lands at
 * CLICK_PEAK. The 2 ms fades keep a hard edge from splattering into the other
 * output's pitch, which micSync would read as that output's burst.
 */
const tone = ({ ctx: c, delay, gain }: Chain, hz: number, at: number, seconds: number): void => {
  const level = gain.gain.value;
  if (level < 0.01) return;
  const osc = c.createOscillator();
  const env = c.createGain();
  const peak = CLICK_PEAK / level;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(peak, at + 0.002);
  env.gain.setValueAtTime(peak, at + seconds - 0.002);
  env.gain.linearRampToValueAtTime(0, at + seconds);
  osc.frequency.value = hz;
  osc.connect(env).connect(delay);
  osc.start(at);
  osc.stop(at + seconds);
};

/** 10 ms 1 kHz blip through each output's delay, both fired together. */
export function click(frontId: string, rearId: string): void {
  const front = open('front', frontId);
  tone(front, 1000, front.ctx.currentTime, 0.01);
  tone(open('rear', rearId), 1000, front.ctx.currentTime, 0.01);
}

const PROBE_PAIRS = 8;
const PROBE_EVERY_S = 1.2;

const sleep = (ms: number): Promise<void> => new Promise(r => window.setTimeout(r, ms));

/**
 * The offset that lines the outputs up, measured through the microphone:
 * tone pairs at FRONT_HZ / REAR_HZ with both delays zeroed, so the recording
 * holds the raw gap. Null when the mic did not hear both clearly; rejects when
 * mic access is refused. Expects testBed() to be running.
 */
export async function micSync(frontId: string, rearId: string): Promise<number | null> {
  const front = open('front', frontId);
  const rear = open('rear', rearId);
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const rec = new AudioContext({ sampleRate: front.ctx.sampleRate });
  const saved = [front.delay.delayTime.value, rear.delay.delayTime.value];
  try {
    // A ring that re-centres mid-measurement moves the rear by up to ~10 ms.
    for (const end = performance.now() + 8000; !rear.settled && performance.now() < end; ) {
      await sleep(100);
    }
    await loadWorklets(rec);
    const chunks: Float32Array[] = [];
    const tap = new AudioWorkletNode(rec, 'mic-tap');
    tap.port.onmessage = e => chunks.push(e.data);
    rec.createMediaStreamSource(mic).connect(tap).connect(rec.destination);
    front.delay.delayTime.value = rear.delay.delayTime.value = 0;
    await sleep(300);
    const t0 = front.ctx.currentTime + 0.1;
    for (let i = 0; i < PROBE_PAIRS; i++) {
      tone(front, FRONT_HZ, t0 + i * PROBE_EVERY_S, 0.02);
      tone(rear, REAR_HZ, t0 + i * PROBE_EVERY_S, 0.02);
    }
    // The last rear burst can land up to a second after its front one.
    await sleep((0.1 + PROBE_PAIRS * PROBE_EVERY_S + 1.2) * 1000);
    const x = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      x.set(c, at);
      at += c.length;
    }
    const gap = gapMs(x, rec.sampleRate, PROBE_PAIRS, PROBE_EVERY_S * 1000);
    return gap === null ? null : Math.round(gap);
  } finally {
    [front.delay.delayTime.value, rear.delay.delayTime.value] = saved;
    mic.getTracks().forEach(t => t.stop());
    void rec.close();
  }
}

// A Bluetooth amp that has been silent takes a moment to wake and would clip
// the clicks, so the sync test lays a -80 dBFS bed on both chains and leaves
// the outputs in their playing state throughout.
const BED_LEVEL = 1e-4;
let bed: AudioBufferSourceNode[] = [];

/** Called with no ids to stop. */
export function testBed(frontId?: string, rearId?: string): void {
  for (const src of bed) src.stop();
  bed = [];
  if (!frontId || !rearId) return;
  for (const { ctx: c, delay } of [open('front', frontId), open('rear', rearId)]) {
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * BED_LEVEL;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(delay);
    src.start();
    bed.push(src);
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

/** Apply devices, delays and levels without touching the capture. */
export function configure({ front, rear, offsetMs }: SurroundSettings): void {
  setOffset(front.deviceId, rear?.deviceId, offsetMs);
  if (rear) setLevel(rear);
}

const preset = (key: string): SurroundPreset => SURROUND_PRESETS[key] ?? SURROUND_PRESETS.natural;

/** Exponentially decaying stereo noise: a room without measuring one. */
function impulse(c: AudioContext, seconds: number): AudioBuffer {
  const n = Math.ceil(c.sampleRate * seconds);
  const buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  }
  return buf;
}

/** Whether these settings need the audio graph rebuilt rather than re-levelled. Devices re-sink in place. */
const graphKey = (s: SurroundSettings): string => [s.rear?.kind, s.preset].join('|');

/** Route the element's audio to front (as is) and rear (the preset's ambience feed). */
export function attach(audio: HTMLAudioElement, settings: SurroundSettings): void {
  if (attached && attached.audio !== audio) detach();
  configure(settings);
  if (attached) {
    const rebuild = graphKey(attached.settings) !== graphKey(settings);
    attached.settings = settings;
    if (rebuild) attached.arm();
    return;
  }
  if (!settings.rear) return;

  // Chromium feeds only the newest captureStream() of an element, and a
  // source node whose track merely stopped delivering keeps replaying its
  // last buffer. So the old track is stopped for good as soon as the element
  // empties, and nothing else in the app may capture this element.
  const release = (): void => {
    if (!attached) return;
    for (const id of [attached.poll, attached.steer, attached.watch]) if (id) window.clearInterval(id);
    attached.poll = attached.steer = attached.watch = null;
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
    const src = audio.src;
    if (src === attached.stereoSrc) return;
    const decoder = open('front', attached.settings.front.deviceId).ctx;
    let folded: ReturnType<typeof foldChannels> = null;
    try {
      const bytes = await readLocalFile(src);
      if (!bytes) return;
      folded = foldChannels(await decoder.decodeAudioData(bytes));
    } catch {
      // Undecodable (AC-3, DTS) is treated like stereo: the matrix path stays.
    }
    // A recapture meanwhile is fine; a new file or an earlier decode that landed is not.
    if (!attached || audio.src !== src) return;
    if (!folded) {
      attached.stereoSrc = src;
      return;
    }
    if (attached.discrete) return;
    // Real channels replace the matrix feed, its steering and the silence watch; delay and levels stay.
    for (const id of [attached.steer, attached.watch]) if (id) window.clearInterval(id);
    attached.steer = attached.watch = null;
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
        const s = attached?.settings;
        if (!s?.rear) return;
        const at = audio.currentTime;
        const feeds: Array<[Chain, AudioBuffer]> = [
          [open('front', s.front.deviceId), d.front],
          [open('rear', s.rear.deviceId), d.rear],
        ];
        for (const [{ ctx: c, delay }, buffer] of feeds) {
          const source = c.createBufferSource();
          source.buffer = buffer;
          source.connect(delay);
          source.start(0, at);
          d.sources.push(source);
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

    const front = open('front', frontDev.deviceId);
    const { ctx: c, delay } = open('rear', rear.deviceId);
    const src = c.createMediaStreamSource(stream);
    attached.inputs.push(src);
    const frontSteer = c.createGain();
    src.connect(frontSteer).connect(front.delay);

    const meter = c.createAnalyser();
    meter.fftSize = 2048;
    src.connect(meter);
    const samples = new Float32Array(meter.fftSize);
    let heard = performance.now();
    let lastTime = audio.currentTime;
    attached.watch = window.setInterval(() => {
      meter.getFloatTimeDomainData(samples);
      const now = performance.now();
      if (samples.some(v => Math.abs(v) > 1e-4)) heard = now;
      const moved = audio.currentTime !== lastTime;
      lastTime = audio.currentTime;
      if (moved && now - heard > SILENT_MS) capture();
    }, WATCH_MS);
    void loadDiscrete();

    if (p.bypass) {
      src.connect(delay);
      return;
    }
    const split = c.createChannelSplitter(2);
    src.connect(split);

    const sum = (weights: [number, number], scale: number): GainNode => {
      const out = c.createGain();
      out.gain.value = scale;
      weights.forEach((w, channel) => {
        const g = c.createGain();
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
    // the two are pulled a few ms apart so a right-panned source (negative
    // side) adds to mid in energy rather than cancelling it. Mid is the one
    // held back: side is at least as loud in every preset, and the sync clicks
    // can only line up the part that isn't delayed.
    const merge = c.createChannelMerger(2);
    const mono = rear.kind === 'mono';
    const sideRight = c.createGain();
    sideRight.gain.value = mono ? 1 : -1;
    let midOut: AudioNode = mid;
    if (mono) {
      const decorrelate = c.createDelay(0.05);
      decorrelate.delayTime.value = MONO_DECORRELATE_MS / 1000;
      midOut = mid.connect(decorrelate);
    }
    midOut.connect(merge, 0, 0);
    midOut.connect(merge, 0, 1);
    side.connect(merge, 0, 0);
    side.connect(sideRight).connect(merge, 0, 1);

    const highpass = c.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = p.highpassHz;
    const lowpass = c.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = p.lowpassHz;
    const trim = c.createGain();
    trim.gain.value = 10 ** (p.trimDb / 20);
    const rearSteer = c.createGain();
    // No Haas delay on the rear feed: the sync clicks enter at the chain's
    // delay line and cannot carry one, so anything this path adds is time the
    // user cannot tune out. Alignment beats the extra depth it bought.
    merge.connect(highpass).connect(lowpass).connect(trim);
    if (p.reverbS > 0) {
      const reverb = c.createConvolver();
      reverb.buffer = impulse(c, p.reverbS);
      const wet = c.createGain();
      wet.gain.value = p.reverbMix;
      lowpass.connect(reverb).connect(wet).connect(trim);
    }
    trim.connect(rearSteer).connect(delay);

    if (p.steer <= 0) return;
    const frontFloor = 1 - p.steer * (1 - FRONT_FLOOR);
    const rearFloor = 1 - p.steer * (1 - REAR_FLOOR);
    // Energy taps: L, R, L+R and L-R. In-phase content dominates the sum,
    // anti-phase (matrix-encoded rear) dominates the difference.
    const tap = (...inputs: Array<[number, number]>): (() => number) => {
      const an = c.createAnalyser();
      an.fftSize = 1024;
      for (const [channel, sign] of inputs) {
        const g = c.createGain();
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
    watch: null,
    discrete: null,
    stereoSrc: null,
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
  navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
  bed = [];
  for (const { out } of chains.values()) out?.close().catch(() => undefined);
  chains.clear();
  void ctx?.close();
  ctx = null;
}
