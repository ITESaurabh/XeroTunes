/** Self-check: run with `node src/config/theme.check.ts`. */
import assert from 'node:assert';
import {
  AMETHYST,
  THEME_FIELDS,
  getBaseTheme,
  parseTheme,
  surfacesFor,
  themeFromSeed,
} from './theme.ts';

/** The palette the app shipped before themes were editable, copied from git history. */
const ORIGINAL = {
  light: { primary: '#9b2e99', bg: '#f4f1f9', paper: '#f9f8fc', text: '#000000' },
  dark: { primary: '#ffaaf4', bg: '#201e23', paper: '#27262a', text: '#ffffff' },
} as const;

for (const mode of ['light', 'dark'] as const) {
  const p = getBaseTheme(mode, AMETHYST).palette;
  assert.equal(p.mode, mode);
  assert.equal(p.primary.main, ORIGINAL[mode].primary, `${mode} primary`);
  assert.equal(p.secondary.main, '#B76C6C', `${mode} secondary`);
  assert.equal(p.error.main, '#c42b1c', `${mode} error`);
  assert.equal(p.background.default, ORIGINAL[mode].bg, `${mode} background`);
  assert.equal(p.background.paper, ORIGINAL[mode].paper, `${mode} paper`);
  assert.equal(p.text.primary, ORIGINAL[mode].text, `${mode} text`);
  // MUI derives these; setting them would change the app's look.
  assert.equal('divider' in p, false, `${mode} must not set divider`);
  assert.equal('contrastText' in p.primary, false, `${mode} must not set contrastText`);
}

// A missing theme falls back to the built-in rather than throwing.
assert.equal(getBaseTheme('dark').palette.primary.main, ORIGINAL.dark.primary);

/**
 * The surfaces used to be hardcoded in the components. Amethyst must still resolve to
 * those exact values, or the stock dark look drifts, which is the whole point of
 * deriving them instead of replacing them with generic MUI tokens.
 */
const darkSurfaces = surfacesFor(AMETHYST.dark, 'dark');
for (const [key, want] of Object.entries({
  elevated: 'rgb(50, 49, 53)', // was #323135 on the toolbars and settings cards
  listHeader: 'rgb(34, 33, 36)', // was #222 on the list header strip
  trackOff: 'rgb(56, 55, 59)', // was #39393D on the switch track
  control: 'rgb(1, 1, 2)', // was black behind the transport buttons
  well: 'rgb(1, 1, 2)', // was #000000 on the slider rails
  glass: 'rgba(1, 1, 2, 0.6)', // was rgba(0,0,0,0.6) on the play bar
  glassBorder: 'rgba(1, 1, 2, 0.25)', // was rgba(0,0,0,0.25)
  scrim: 'rgba(1, 1, 2, 0.5)', // was rgba(0,0,0,0.5) behind modals
  positive: '#2ECA45', // the iOS-style switch green
  artFrom: '#1e1e3f',
  artTo: '#2d2d5a',
  folder: '#facc6b',
  year: '#7cc4ff',
  genre: '#c084fc',
})) {
  assert.equal(darkSurfaces[key as keyof typeof darkSurfaces], want, `dark ${key}`);
}

// The light counterparts have to actually differ, or light mode is still dark-only.
const lightSurfaces = surfacesFor(AMETHYST.light, 'light');
for (const key of ['control', 'well', 'glass', 'scrim', 'trackOff', 'listHeader'] as const) {
  assert.notEqual(lightSurfaces[key], darkSurfaces[key], `${key} must differ per mode`);
}
// Light chrome must be light, not a dark value reused, and each layer a step darker
// than the one it sits on: Figma's #F3F3F3 card / #D9D9D9 disc / #C1C1C1 rail, tinted.
assert.equal(lightSurfaces.glass, 'rgba(231, 228, 236, 0.72)', 'light glass');
assert.equal(lightSurfaces.control, 'rgb(207, 204, 211)', 'light control');
assert.equal(lightSurfaces.well, 'rgb(195, 192, 199)', 'light well'); // was #c1c1c1

// Surfaces follow a custom palette rather than staying Amethyst purple.
const seeded = surfacesFor(themeFromSeed('Seeded', '#2E7D32').dark, 'dark');
assert.notEqual(seeded.accent, darkSurfaces.accent, 'accent must follow the theme');
assert.notEqual(seeded.elevated, darkSurfaces.elevated, 'elevated must follow the theme');
assert.equal(seeded.folder, '#facc6b', 'category accents stay fixed');

// Every surface is a usable CSS colour for every theme, including imported ones.
for (const mode of ['light', 'dark'] as const) {
  for (const [key, value] of Object.entries(surfacesFor(AMETHYST[mode], mode))) {
    assert.match(value, /^(#[0-9a-fA-F]{6}|rgb\(|rgba\()/, `${mode}.${key} is not a colour`);
  }
}

// The palette actually carries them through createTheme's shape.
assert.deepEqual(getBaseTheme('dark').palette.surfaces, darkSurfaces);

// Autofill produces a complete, valid theme for every field.
const generated = themeFromSeed('Generated', '#9B2E99');
assert.equal(generated.name, 'Generated');
assert.equal('theme' in parseTheme(generated), true, 'autofill must produce a valid theme');
assert.equal(generated.light.primary, '#7f4d7a');
assert.equal(generated.dark.primary, '#f1b3e7');
assert.notEqual(generated.light.primary, generated.dark.primary);

// Imported files are untrusted: every malformed shape must be rejected, not thrown on.
const good = JSON.parse(JSON.stringify(AMETHYST));
assert.equal('theme' in parseTheme(good), true, 'a round-tripped theme must import');
for (const bad of [
  null,
  'nope',
  42,
  {},
  { name: 'x' },
  { name: '', light: AMETHYST.light, dark: AMETHYST.dark },
  { name: 'x', light: AMETHYST.light },
  { name: 'x', light: { ...AMETHYST.light, primary: 'red' }, dark: AMETHYST.dark },
  { name: 'x', light: { ...AMETHYST.light, primary: '#fff' }, dark: AMETHYST.dark },
  { name: 'x', light: { ...AMETHYST.light, primary: undefined }, dark: AMETHYST.dark },
]) {
  const result = parseTheme(bad);
  assert.equal('error' in result, true, `should reject: ${JSON.stringify(bad)}`);
}

// Extra keys are dropped rather than carried into the palette.
const extra = parseTheme({ ...good, evil: 'x', light: { ...good.light, evil: 'x' } });
assert.equal('theme' in extra, true);
if ('theme' in extra) {
  assert.deepEqual(Object.keys(extra.theme).sort(), ['dark', 'light', 'name']);
  assert.deepEqual(
    Object.keys(extra.theme.light).sort(),
    THEME_FIELDS.map(f => f.key).sort()
  );
}

console.log('theme.check.ts: ok');
