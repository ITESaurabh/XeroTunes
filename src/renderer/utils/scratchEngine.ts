/**
 * Plays the groove under a hand or a dragged needle. HTML audio can't run
 * backwards, so the track is decoded once into a forward and a reversed buffer
 * (mono, 22 kHz; it only has to sound like a record being scratched), and a
 * buffer source runs whichever way the hand goes at the hand's speed.
 */
import { toMediaSrc } from './misc';

const RATE = 22050;
const MAX_RATE = 4;

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let loadedFor: string | null = null;
let fwd: AudioBuffer | null = null;
let rev: AudioBuffer | null = null;

let node: AudioBufferSourceNode | null = null;
let dir = 0; // 1 forward, -1 backward, 0 stopped
let pos = 0; // seconds into the track, our own accounting
let lastScrub = 0;

function context(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    gain = ctx.createGain();
    gain.connect(ctx.destination);
  }
  return ctx;
}

async function readBytes(uriOrPath: string): Promise<ArrayBuffer> {
  const src = toMediaSrc(uriOrPath);
  if (src.startsWith('file:///')) {
    const fs = window.require('fs') as typeof import('fs');
    const buf = await fs.promises.readFile(uriOrPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`scratch: ${res.status} for ${src}`);
  return res.arrayBuffer();
}

/** Decode the track in the background; a first scratch is silent until this lands. */
export function prime(uriOrPath: string | null): void {
  if (!uriOrPath || uriOrPath === loadedFor) return;
  loadedFor = uriOrPath;
  fwd = rev = null;
  void (async () => {
    const bytes = await readBytes(uriOrPath);
    const decoded = await context().decodeAudioData(bytes);
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
    const s = off.createBufferSource();
    s.buffer = decoded;
    s.connect(off.destination);
    s.start();
    const mono = await off.startRendering();
    const back = context().createBuffer(1, mono.length, RATE);
    back.copyToChannel(mono.getChannelData(0).slice().reverse(), 0);
    if (loadedFor !== uriOrPath) return;
    fwd = mono;
    rev = back;
  })().catch(err => {
    console.warn('scratch: could not decode', uriOrPath, err);
    if (loadedFor === uriOrPath) loadedFor = null;
  });
}

function stopNode(): void {
  if (node) {
    try {
      node.stop();
    } catch {
      /* already stopped */
    }
    node.disconnect();
    node = null;
  }
  dir = 0;
}

function startNode(direction: 1 | -1, rate: number): void {
  const buffer = direction > 0 ? fwd : rev;
  if (!buffer || !gain) return;
  stopNode();
  const c = context();
  node = c.createBufferSource();
  node.buffer = buffer;
  node.playbackRate.value = rate;
  node.connect(gain);
  const offset = direction > 0 ? pos : buffer.duration - pos;
  node.start(0, Math.max(0, Math.min(buffer.duration, offset)));
  dir = direction;
}

/** A hand lands: remember where the groove is and how loud the deck is. */
export function hold(seconds: number, volume: number): void {
  const c = context();
  if (c.state === 'suspended') void c.resume();
  if (gain) gain.gain.value = volume;
  pos = seconds;
  stopNode();
}

/** The hand moved `seconds` of groove at `rate` × normal speed (negative = back). */
export function move(seconds: number, rate: number, duration: number): number {
  pos = Math.max(0, Math.min(duration, pos + seconds));
  const want = rate > 0.05 ? 1 : rate < -0.05 ? -1 : 0;
  if (want === 0) {
    if (node) node.playbackRate.value = 0;
    return pos;
  }
  const speed = Math.min(MAX_RATE, Math.abs(rate));
  if (want !== dir || !node) startNode(want, speed);
  else node.playbackRate.value = speed;
  return pos;
}

/**
 * A needle dragged across a spinning record: the groove under it plays, and
 * skips as it moves. Restarts are throttled so the skip sounds like a skip.
 */
export function scrub(seconds: number): void {
  pos = seconds;
  const now = performance.now();
  if (node && dir === 1 && now - lastScrub < 90) return;
  lastScrub = now;
  startNode(1, 1);
}

/** The needle set down on a groove of a record that isn't turning: no sound. */
export function place(seconds: number): void {
  pos = seconds;
  stopNode();
}

/** Lets go; returns where the groove ended up. */
export function release(): number {
  stopNode();
  return pos;
}
