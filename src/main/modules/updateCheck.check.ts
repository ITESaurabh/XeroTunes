/** Self-check: run with `node src/main/modules/updateCheck.check.ts`. */
import assert from 'node:assert';
import { compareVersions, newestRelease, type Release } from './updateCheck.ts';

const order = (a: string, b: string) => Math.sign(compareVersions(a, b));

// Squirrel compares prerelease labels as text; this must not.
assert.equal(order('0.45.0-beta.10', '0.45.0-beta.9'), 1);
assert.equal(order('v0.46.0-beta.1', '0.45.0-beta.3'), 1);
assert.equal(order('0.45.0', '0.45.0-beta.3'), 1);
assert.equal(order('0.45.0-beta.3', '0.45.0'), -1);
assert.equal(order('v0.45.0-beta.3', '0.45.0-beta.3'), 0);
assert.equal(order('0.45.0-rc.1', '0.45.0-beta.9'), 1);
assert.equal(order('1.0.0-alpha', '1.0.0-alpha.1'), -1);
assert.equal(order('1.0.0-beta.2', '1.0.0-beta.x'), -1);

// OS versions: Windows' os.release(), process.getSystemVersion(), glibc.
assert.equal(order('10.0.22631', '10.0'), 1);
assert.equal(order('12.0', '12.0.0'), 0);
assert.equal(order('11.7.10', '12.0'), -1);
assert.equal(order('2.39', '2.28'), 1);

const rel = (tag_name: string, prerelease: boolean, draft = false): Release => ({
  tag_name,
  prerelease,
  draft,
  published_at: '2026-10-18T00:00:00Z',
  html_url: '',
  assets: [],
});
const releases = [
  rel('v0.45.0-beta.9', true),
  rel('v0.46.0', false),
  rel('v0.45.0-beta.10', true),
  rel('v0.47.0-beta.1', true, true),
  rel('v0.45.0', false),
];
assert.equal(newestRelease(releases, true)?.tag_name, 'v0.45.0-beta.10');
assert.equal(newestRelease(releases, false)?.tag_name, 'v0.46.0');
assert.equal(newestRelease([], false), null);
// Stable before its first release: GitHub has only prereleases.
assert.equal(newestRelease([rel('v0.45.0-beta.3', true)], false), null);

console.log('updateCheck: ok');
