/** Self-check: run with `node src/renderer/utils/moodScore.check.ts`. */
import assert from 'node:assert';
import { test } from 'node:test';
import { lyricFeatures, moodOf } from './moodScore.ts';

test('lyric word lists count per 100 words', () => {
  // Ten words: two positive (love, happy), one negative that is also angry (hate).
  const f = lyricFeatures('[00:12.30] I love the happy days but I hate the rain');
  assert.equal(f.lyrPos, 10);
  assert.equal(f.lyrAngry, 10);
  assert.equal(f.lyrSad, 0);
  assert.deepEqual(lyricFeatures(null), { lyrPos: 0, lyrAngry: 0, lyrSad: 0 });
});

// Model outputs shaped like a loud party track and a quiet sad ballad.
const partyTrack = {
  happy: 0.97,
  sad: 0.02,
  aggressive: 0.34,
  relaxed: 0.1,
  party: 0.94,
  deamV: 5.88,
  deamA: 5.9,
  emoV: 5.9,
  emoA: 6.42,
};
const sadTrack = {
  happy: 0.33,
  sad: 0.63,
  aggressive: 0.17,
  relaxed: 0.8,
  party: 0.06,
  deamV: 4.21,
  deamA: 4.3,
  emoV: 4.4,
  emoA: 4.48,
};

test('places an energetic bright track and a quiet dark one', () => {
  assert.equal(moodOf(partyTrack).mood, 'party');
  assert.equal(moodOf(sadTrack).mood, 'moody');
});

test('lyrics move valence only', () => {
  const angry = lyricFeatures('hate kill fight war blood');
  const plain = moodOf(partyTrack);
  const withLyrics = moodOf(partyTrack, angry);
  assert.equal(withLyrics.arousal, plain.arousal);
  assert.ok(withLyrics.valence < plain.valence);
});
