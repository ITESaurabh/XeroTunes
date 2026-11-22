/**
 * Self-check: run with `node src/renderer/utils/changelog.check.ts` from the repo root.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { latestReleases, parseChangelog, parseInline } from './changelog.ts';

const md = `# Changelog

Intro for people reading the file.

## [Unreleased]

### Added

- Added one thing that wraps
  onto a second line.
- Added \`code\` here.

### Fixed

- Fixed a bug.

A closing note.

## [0.1.0] - 2026-01-02

- Only item.
`;

assert.deepStrictEqual(parseChangelog(md), [
  { kind: 'version', text: 'Unreleased' },
  { kind: 'section', text: 'Added' },
  { kind: 'list', items: ['Added one thing that wraps onto a second line.', 'Added `code` here.'] },
  { kind: 'section', text: 'Fixed' },
  { kind: 'list', items: ['Fixed a bug.'] },
  { kind: 'text', text: 'A closing note.' },
  { kind: 'version', text: '0.1.0 - 2026-01-02' },
  { kind: 'list', items: ['Only item.'] },
]);
assert.deepStrictEqual(parseChangelog('No versions yet.\n'), []);

assert.deepStrictEqual(
  parseInline('In `Settings` see **this** and [the docs](https://example.com/a).'),
  [
    { kind: 'text', text: 'In ' },
    { kind: 'code', text: 'Settings' },
    { kind: 'text', text: ' see ' },
    { kind: 'bold', text: 'this' },
    { kind: 'text', text: ' and ' },
    { kind: 'link', text: 'the docs', href: 'https://example.com/a' },
    { kind: 'text', text: '.' },
  ]
);
// Only https links open; anything else stays text.
assert.deepStrictEqual(parseInline('[x](file:///etc/passwd)'), [
  { kind: 'text', text: '[x](file:///etc/passwd)' },
]);

const versions = (blocks: ReturnType<typeof parseChangelog>) =>
  blocks.flatMap(b => (b.kind === 'version' ? [b.text] : []));
const timeline = parseChangelog(
  [
    '0.62.0-beta.1 - 2026-03-01',
    '0.61.0 - 2026-02-01',
    '0.61.0-beta.2 - 2026-01-20',
    '0.61.0-beta.1 - 2026-01-10',
    '0.60.10-beta.1 - 2026-01-01',
  ]
    .map(v => `## [${v}]\n\n- Something.\n`)
    .join('\n')
);
// Beta builds: every release, up to the limit.
assert.deepStrictEqual(versions(latestReleases(timeline, 3, false)), [
  '0.62.0-beta.1 - 2026-03-01',
  '0.61.0 - 2026-02-01',
  '0.61.0-beta.2 - 2026-01-20',
]);
// Stable builds: betas dropped once a stable exists, entries kept with their release.
assert.deepStrictEqual(latestReleases(timeline, 5, true), [
  { kind: 'version', text: '0.61.0 - 2026-02-01' },
  { kind: 'list', items: ['Something.'] },
]);
// Stable builds before any stable release: betas shown.
const betasOnly = timeline.filter((_, i) => i > 3);
assert.deepStrictEqual(versions(latestReleases(betasOnly, 5, true)), [
  '0.61.0-beta.2 - 2026-01-20',
  '0.61.0-beta.1 - 2026-01-10',
  '0.60.10-beta.1 - 2026-01-01',
]);

// The shipped file starts with a release the dialog can show.
const real = parseChangelog(fs.readFileSync('CHANGELOG.md', 'utf8'));
assert.strictEqual(real[0]?.kind, 'version');

console.log('changelog: ok');
