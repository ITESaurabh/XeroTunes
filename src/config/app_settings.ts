import { AMETHYST, AppTheme } from './theme';

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
  queueSource?: string | null;
}

export interface ThemeSettings {
  mode: ThemeMode;
  titleBarStyle: TitleBarStyle;
  paletteVariant: ThemePaletteVariant;
  activeTheme: string;
  customThemes: AppTheme[];
}

export interface PlaybackSettings {
  volumeLevel: number;
  shuffle: boolean;
  repeatMode: PlaybackRepeatMode;
  pauseOnAudioOutputChange: boolean;
  /** MediaDevices deviceId for the output sink; 'default' follows the system default. */
  audioOutputDeviceId: string;
  perDeviceVolume: boolean;
  deviceVolumeLevels: Record<string, number>;
  /** Per-cast-device volume (0-100), kept separate from local output volumes. */
  castVolumeLevels: Record<string, number>;
}

/** Cast receivers run loud, so a device seen for the first time starts low. */
export const DEFAULT_CAST_VOLUME = 10;

export interface LibrarySettings {
  multiArtistSeparators: string[];
  multiArtistExceptions: string[];
  downloadFolder: string;
}

export interface FolderViewSettings {
  viewMode: ViewMode;
  gridSize: GridSize;
}

export interface ViewSettings {
  folders: FolderViewSettings;
  folderHierarchy: FolderViewSettings;
}

export type FolderViewKey = 'folders' | 'folderHierarchy';

export interface AppSettings {
  theme: ThemeSettings;
  playback: PlaybackSettings;
  library: LibrarySettings;
  views: ViewSettings;
  overlayEnabled: boolean;
  discordPresenceEnabled: boolean;
  artistImageFetchingEnabled: boolean;
  /** Days a station's recently-played entry survives unless it is bookmarked. */
  streamHistoryDays: number;
  windowScale: number;
}

export const STREAM_HISTORY_DAY_OPTIONS: number[] = [1, 3, 7, 15, 30];

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

/** Individually resettable pieces of app state. 'localState' is cleared renderer-side. */
export type ResetTarget =
  | 'localState'
  | 'settings'
  | 'themes'
  | 'database'
  | 'favourites'
  | 'firstrun'
  | 'albumArts'
  | 'artistArts';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: {
    mode: 0,
    titleBarStyle: 'default',
    paletteVariant: 'default',
    activeTheme: AMETHYST.name,
    customThemes: [],
  },
  playback: {
    volumeLevel: 30,
    shuffle: false,
    repeatMode: 'off',
    pauseOnAudioOutputChange: true,
    audioOutputDeviceId: 'default',
    perDeviceVolume: true,
    deviceVolumeLevels: {},
    castVolumeLevels: {},
  },
  library: {
    multiArtistSeparators: [',', '&'],
    multiArtistExceptions: ['AC/DC', '+/-'],
    downloadFolder: '',
  },
  views: {
    folders: { viewMode: 'list', gridSize: 'medium' },
    folderHierarchy: { viewMode: 'list', gridSize: 'medium' },
  },
  overlayEnabled: true,
  discordPresenceEnabled: false,
  artistImageFetchingEnabled: true,
  streamHistoryDays: 3,
  windowScale: 1,
};
