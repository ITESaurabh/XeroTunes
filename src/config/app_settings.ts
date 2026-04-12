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

export interface AppSettings {
  theme: ThemeSettings;
  playback: PlaybackSettings;
  library: LibrarySettings;
  overlayEnabled: boolean;
  discordPresenceEnabled: boolean;
  artistImageFetchingEnabled: boolean;
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
  overlayEnabled: true,
  discordPresenceEnabled: false,
  artistImageFetchingEnabled: true,
};
