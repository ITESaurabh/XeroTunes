export type ThemeMode = 0 | 1 | 2;
export type TitleBarStyle =
  | 'default'
  | 'native'
  | 'hidden'
  | 'mac'
  | 'mac-fake'
  | 'linux-gnome'
  | 'linux-kde'
  | 'windows';
export type ThemePaletteVariant = 'default' | 'soft' | 'highContrast';
export type PlaybackRepeatMode = 'off' | 'all' | 'one';
export type ViewMode = 'list' | 'grid';
export type GridSize = 'small' | 'medium' | 'large';

export interface QueueState {
  queue: unknown[];
  queueIndex: number;
  track: unknown;
}

export interface ThemeSettings {
  mode: ThemeMode;
  titleBarStyle: TitleBarStyle;
  paletteVariant: ThemePaletteVariant;
}

export interface PlaybackSettings {
  volumeLevel: number;
  shuffle: boolean;
  repeatMode: PlaybackRepeatMode;
}

export interface LibrarySettings {
  multiArtistSeparators: string[];
  multiArtistExceptions: string[];
}

export interface FolderViewSettings {
  viewMode: ViewMode;
  gridSize: GridSize;
}

export interface ViewSettings {
  folders: FolderViewSettings;
  folderHierarchy: FolderViewSettings;
}

export interface AppSettings {
  theme: ThemeSettings;
  playback: PlaybackSettings;
  library: LibrarySettings;
  views: ViewSettings;
  overlayEnabled: boolean;
  discordPresenceEnabled: boolean;
  artistImageFetchingEnabled: boolean;
  windowScale: number;
}

export const WINDOW_SCALE_OPTIONS: number[] = [0.75, 0.85, 1, 1.15, 1.25, 1.5, 1.75, 2];
export const MIN_WINDOW_SCALE = 0.5;
export const MAX_WINDOW_SCALE = 3;

export function clampWindowScale(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n < MIN_WINDOW_SCALE) return MIN_WINDOW_SCALE;
  if (n > MAX_WINDOW_SCALE) return MAX_WINDOW_SCALE;
  return n;
}

export type SettingsKey = keyof AppSettings;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: {
    mode: 0,
    titleBarStyle: 'default',
    paletteVariant: 'default',
  },
  playback: {
    volumeLevel: 30,
    shuffle: false,
    repeatMode: 'off',
  },
  library: {
    multiArtistSeparators: [',', '&'],
    multiArtistExceptions: ['AC/DC', '+/-'],
  },
  views: {
    folders: { viewMode: 'list', gridSize: 'medium' },
    folderHierarchy: { viewMode: 'list', gridSize: 'medium' },
  },
  overlayEnabled: true,
  discordPresenceEnabled: false,
  artistImageFetchingEnabled: true,
  windowScale: 1,
};
