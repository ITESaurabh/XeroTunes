import type { PaletteMode } from '@mui/material';
import { alpha, darken, lighten } from '@mui/material/styles';
import {
  Hct,
  MaterialDynamicColors,
  SchemeTonalSpot,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';

/** The colours a theme defines. Everything else (hover, disabled, contrast text) MUI derives. */
export interface ThemeColors {
  primary: string;
  secondary: string;
  error: string;
  backgroundDefault: string;
  backgroundPaper: string;
  textPrimary: string;
}

export interface AppTheme {
  name: string;
  light: ThemeColors;
  dark: ThemeColors;
  /** Corner roundness in px (MUI's shape.borderRadius). Unset means DEFAULT_RADIUS. */
  radius?: number;
}

export const DEFAULT_RADIUS = 18;
export const MIN_RADIUS = 0;
export const MAX_RADIUS = 28;

export const clampRadius = (value: number): number =>
  Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, value));

/**
 * Surfaces the UI needs that MUI's palette has no name for. These used to be hardcoded
 * literals scattered through the components, which is why light mode and custom themes
 * came out wrong. They are derived from the six colours above rather than stored, so
 * every theme gets a full set and the editor keeps its six fields.
 *
 * The derivations are calibrated so Amethyst reproduces the original hardcoded values.
 * theme.check.ts pins that, so a change here that shifts the stock look fails the check.
 */
export interface ThemeSurfaces {
  /** Raised chrome: page toolbars, settings cards. */
  elevated: string;
  /** Header strip above the virtualised lists. */
  listHeader: string;
  /** Off state of a switch track. */
  trackOff: string;
  /** Round transport buttons in the play bar and mini player. */
  control: string;
  /** Recessed wells: slider rails. */
  well: string;
  /** Translucent floating chrome: the play bar card. */
  glass: string;
  glassBorder: string;
  /** Modal backdrop. */
  scrim: string;
  /** Brand accent for chrome that sits behind content: scrollbar thumb, overlay badge. */
  accent: string;
  /** Selected-row tint. */
  selection: string;
  /** Switch "on": semantic, not palette-driven. */
  positive: string;
  /** Placeholder album art, shown behind or instead of a cover. */
  artFrom: string;
  artTo: string;
  /** Category accents. Fixed by convention: a folder is amber, a year is blue. */
  folder: string;
  year: string;
  genre: string;
  /** A remote library's root, so it reads as somewhere else at a glance. */
  server: string;
}

/** Fixed across modes and themes: these identify a thing, they don't decorate it. */
const CATEGORY = {
  folder: '#facc6b',
  year: '#7cc4ff',
  genre: '#c084fc',
  server: '#5eead4',
} as const;

export const surfacesFor = (c: ThemeColors, mode: PaletteMode): ThemeSurfaces => {
  const isDark = mode === 'dark';
  // Near-black and near-white struck from the theme's own surface, so translucent
  // chrome keeps the theme's hue instead of pulling in a neutral grey.
  const deep = darken(c.backgroundPaper, 0.95);
  const pale = lighten(c.backgroundPaper, 0.95);
  return {
    // Raised above the surface in both directions. A light theme's paper is already
    // close to its background, so "raised" there means going the rest of the way to
    // white; otherwise toolbars and the search pill vanish into the page.
    elevated: isDark ? lighten(c.backgroundPaper, 0.052) : pale,
    listHeader: darken(c.backgroundPaper, isDark ? 0.12 : 0.06),
    trackOff: isDark ? lighten(c.backgroundPaper, 0.08) : darken(c.backgroundDefault, 0.045),
    control: isDark ? deep : pale,
    // Rails still step *down* from the page, or they collapse into it.
    well: isDark ? deep : darken(c.backgroundDefault, 0.2),
    glass: alpha(isDark ? deep : darken(c.backgroundDefault, 0.05), isDark ? 0.6 : 0.72),
    glassBorder: alpha(deep, isDark ? 0.25 : 0.15),
    scrim: alpha(isDark ? deep : pale, 0.5),
    accent: isDark ? darken(c.primary, 0.32) : c.primary,
    selection: alpha(c.primary, isDark ? 0.18 : 0.16),
    positive: isDark ? '#2ECA45' : '#65C466',
    artFrom: isDark ? darken(c.primary, 0.78) : lighten(c.primary, 0.84),
    artTo: isDark ? darken(c.primary, 0.62) : lighten(c.primary, 0.72),
    ...CATEGORY,
  };
};

declare module '@mui/material/styles' {
  // eslint-disable-next-line no-unused-vars
  interface Palette {
    surfaces: ThemeSurfaces;
  }
  // eslint-disable-next-line no-unused-vars
  interface PaletteOptions {
    surfaces?: ThemeSurfaces;
  }
}

export const THEME_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'error', label: 'Error' },
  { key: 'backgroundDefault', label: 'Background' },
  { key: 'backgroundPaper', label: 'Surface' },
  { key: 'textPrimary', label: 'Text' },
];

/** The palette the app has always shipped. Default theme, and the base for duplicates. */
export const AMETHYST: AppTheme = {
  name: 'Amethyst',
  light: {
    primary: '#9b2e99',
    secondary: '#B76C6C',
    error: '#c42b1c',
    backgroundDefault: '#f4f1f9',
    backgroundPaper: '#f9f8fc',
    textPrimary: '#000000',
  },
  dark: {
    primary: '#ffaaf4',
    secondary: '#B76C6C',
    error: '#c42b1c',
    backgroundDefault: '#201e23',
    backgroundPaper: '#27262a',
    textPrimary: '#ffffff',
  },
};

export const DEFAULT_SEED = '#9B2E99';

const ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'surface',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'onSurface',
  'onSurfaceVariant',
  'outline',
  'outlineVariant',
  'inverseSurface',
  'inverseOnSurface',
  'inversePrimary',
] as const;

export type M3Role = (typeof ROLES)[number];
export type M3Scheme = Record<M3Role, string>;

const HEX = /^#[0-9a-fA-F]{6}$/;

export const isHexColor = (value: string): boolean => HEX.test(value);

/** Seeds arrive from the settings file and, later, from album-art extraction; neither is trusted. */
export const normalizeSeed = (seed: string | undefined | null): string =>
  seed && HEX.test(seed) ? seed : DEFAULT_SEED;

/**
 * TonalSpot at contrast 0 reproduces the Material Theme Builder's default export
 * for a given seed exactly.
 */
export const schemeFromSeed = (seed: string, mode: PaletteMode): M3Scheme => {
  const scheme = new SchemeTonalSpot(
    Hct.fromInt(argbFromHex(normalizeSeed(seed))),
    mode === 'dark',
    0
  );
  const out = {} as M3Scheme;
  for (const role of ROLES) {
    out[role] = hexFromArgb(MaterialDynamicColors[role].getArgb(scheme));
  }
  return out;
};

/**
 * Autofill for the editor: a plausible starting point from one colour, meant to be
 * hand-tuned afterwards. M3 tints surfaces with the seed hue, which is why these
 * backgrounds aren't neutral greys.
 */
export const themeFromSeed = (name: string, seed: string): AppTheme => {
  const colors = (mode: PaletteMode): ThemeColors => {
    const c = schemeFromSeed(seed, mode);
    return {
      primary: c.primary,
      secondary: c.secondary,
      error: c.error,
      backgroundDefault: c.surface,
      backgroundPaper: c.surfaceContainerLow,
      textPrimary: c.onSurface,
    };
  };
  return { name, light: colors('light'), dark: colors('dark') };
};

const parseColors = (raw: unknown, mode: string): ThemeColors | string => {
  if (!raw || typeof raw !== 'object') return `"${mode}" is missing`;
  const out = {} as ThemeColors;
  for (const { key } of THEME_FIELDS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !HEX.test(value)) {
      return `${mode}.${key} must be a "#rrggbb" colour`;
    }
    out[key] = value;
  }
  return out;
};

/** Imported files are untrusted input: accept only a complete, well-formed theme. */
export const parseTheme = (raw: unknown): { theme: AppTheme } | { error: string } => {
  if (!raw || typeof raw !== 'object') return { error: 'Not a theme file' };
  const { name, light, dark, radius } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim()) return { error: 'Theme is missing a name' };
  const parsedLight = parseColors(light, 'light');
  if (typeof parsedLight === 'string') return { error: parsedLight };
  const parsedDark = parseColors(dark, 'dark');
  if (typeof parsedDark === 'string') return { error: parsedDark };
  return {
    theme: {
      name: name.trim().slice(0, 60),
      light: parsedLight,
      dark: parsedDark,
      ...(typeof radius === 'number' ? { radius: clampRadius(radius) } : {}),
    },
  };
};

export const getBaseTheme = (mode: PaletteMode, theme: AppTheme = AMETHYST) => {
  const c = theme[mode] ?? AMETHYST[mode];
  const radius = theme.radius ?? DEFAULT_RADIUS;
  const surfaces = surfacesFor(c, mode);
  return {
    palette: {
      mode,
      surfaces,
      primary: {
        main: c.primary,
      },
      secondary: {
        main: c.secondary,
      },
      error: {
        main: c.error,
      },
      background: {
        default: c.backgroundDefault,
        paper: c.backgroundPaper,
      },
      text: {
        primary: c.textPrimary,
      },
    },
    typography: {
      h1: {
        fontSize: '3.052rem',
        fontWeight: 500,
      },
      h2: {
        fontSize: '2.441rem',
        fontWeight: 500,
      },
      h3: {
        fontSize: '1.953rem',
        fontWeight: 500,
      },
      h4: {
        fontSize: '1.563rem',
        fontWeight: 500,
      },
      h5: {
        fontSize: '1.25rem',
        fontWeight: 500,
        letterSpacing: '0.025rem',
      },
      h6: {
        fontSize: '1rem',
        fontWeight: 500,
      },
    },
    props: {
      MuiAppBar: {
        color: 'default',
      },
    },
    shape: {
      borderRadius: radius,
    },
    components: {
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
      },
      // The group draws its own shadow; MuiButton's disableElevation doesn't reach it.
      MuiButtonGroup: {
        defaultProps: {
          disableElevation: true,
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            height: '100%',
          },
          body: {
            height: '100%',
          },
          '#app': {
            height: '100%',
          },
          '::-webkit-scrollbar': {
            width: 14,
            height: 18,
          },
          // The transparent border plus padding-box clip is what insets the thumb.
          '::-webkit-scrollbar-thumb': {
            height: 6,
            border: '3.5px solid transparent',
            backgroundClip: 'padding-box',
            backgroundColor: surfaces.accent,
            borderRadius: 7,
            minHeight: '2rem',
          },
          '::-webkit-scrollbar-button': {
            display: 'none',
            width: 0,
            height: 0,
          },
          '::-webkit-scrollbar-corner': {
            backgroundColor: 'transparent',
          },
        },
      },
    },
  };
};
