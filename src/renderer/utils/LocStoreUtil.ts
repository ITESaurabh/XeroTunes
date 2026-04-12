import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  QueueState,
  ThemeMode,
  ThemeSettings,
  PlaybackSettings,
  PlaybackRepeatMode,
  LibrarySettings,
} from '../../config/app_settings';

const QUEUE_STATE_KEY = 'queueState';
const { ipcRenderer } = window.require('electron');

function readQueueState(): QueueState | null {
  try {
    const raw = localStorage.getItem(QUEUE_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as QueueState;
  } catch {
    return null;
  }
}

function writeQueueState(state: QueueState | null): void {
  if (state === null) {
    localStorage.removeItem(QUEUE_STATE_KEY);
  } else {
    localStorage.setItem(QUEUE_STATE_KEY, JSON.stringify(state));
  }
}

export function resetApp(): void {
  ipcRenderer.sendSync('write-app-settings-sync', DEFAULT_APP_SETTINGS);
  writeQueueState(null);
}

function parseSettingsObject(raw: unknown): AppSettings {
  if (!raw) return DEFAULT_APP_SETTINGS;

  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return DEFAULT_APP_SETTINGS;
    }
  }

  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_APP_SETTINGS;
  }

  const parsed = raw as Partial<AppSettings>;
  return {
    ...DEFAULT_APP_SETTINGS,
    ...parsed,
    theme: {
      ...DEFAULT_APP_SETTINGS.theme,
      ...(parsed.theme ?? {}),
    },
    playback: {
      ...DEFAULT_APP_SETTINGS.playback,
      ...(parsed.playback ?? {}),
    },
    library: {
      ...DEFAULT_APP_SETTINGS.library,
      ...(parsed.library ?? {}),
    },
  };
}

export function getSettings(): AppSettings {
  const settings = ipcRenderer.sendSync('read-app-settings-sync');
  return parseSettingsObject(settings);
}

export function setSettings(settings: AppSettings): void {
  ipcRenderer.sendSync('write-app-settings-sync', settings);
}

export function updateSettings(update: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const nextSettings: AppSettings = {
    ...current,
    ...update,
    theme: {
      ...current.theme,
      ...(update.theme ?? {}),
    },
    playback: {
      ...current.playback,
      ...(update.playback ?? {}),
    },
    library: {
      ...current.library,
      ...(update.library ?? {}),
    },
  };
  setSettings(nextSettings);
  return nextSettings;
}

export function setThemeMode(themeMode: ThemeMode): void {
  updateSettings({ theme: { ...getSettings().theme, mode: themeMode } });
}

export function setThemeSettings(update: Partial<ThemeSettings>): ThemeSettings {
  const currentTheme = getSettings().theme;
  const nextTheme = { ...currentTheme, ...update };
  updateSettings({ theme: nextTheme });
  return nextTheme;
}

export function setTheme(themeMode: ThemeMode): void {
  setThemeMode(themeMode);
}

export function getThemeMode(): ThemeMode {
  return getSettings().theme.mode;
}

export function getThemeSettings(): ThemeSettings {
  return getSettings().theme;
}

export function getPlaybackSettings(): PlaybackSettings {
  return getSettings().playback;
}

export function getVolumeLevel(): number {
  return getPlaybackSettings().volumeLevel;
}

export function setVolumeLevel(val: number): void {
  updateSettings({ playback: { ...getPlaybackSettings(), volumeLevel: val } });
}

export function getPlaybackShuffle(): boolean {
  return getPlaybackSettings().shuffle;
}

export function setPlaybackShuffle(shuffle: boolean): void {
  updateSettings({ playback: { ...getPlaybackSettings(), shuffle } });
}

export function getPlaybackRepeatMode(): PlaybackRepeatMode {
  return getPlaybackSettings().repeatMode;
}

export function setPlaybackRepeatMode(repeatMode: PlaybackRepeatMode): void {
  updateSettings({ playback: { ...getPlaybackSettings(), repeatMode } });
}

export function getLibrarySettings(): LibrarySettings {
  return getSettings().library;
}

export function setLibrarySettings(update: Partial<LibrarySettings>): LibrarySettings {
  const current = getLibrarySettings();
  const next = { ...current, ...update };
  updateSettings({ library: next });
  return next;
}

export function getMultiArtistSeparators(): string[] {
  return getLibrarySettings().multiArtistSeparators;
}

export function setMultiArtistSeparators(separators: string[]): void {
  setLibrarySettings({ multiArtistSeparators: separators });
}

export function getMultiArtistExceptions(): string[] {
  return getLibrarySettings().multiArtistExceptions;
}

export function setMultiArtistExceptions(exceptions: string[]): void {
  setLibrarySettings({ multiArtistExceptions: exceptions });
}

export function setQueueState(queue: unknown[], queueIndex: number, track: unknown): void {
  writeQueueState({ queue, queueIndex, track });
}

export function getQueueState(): QueueState | null {
  return readQueueState();
}

export function getOverlayEnabled(): boolean {
  return getSettings().overlayEnabled;
}

export function setOverlayEnabled(enabled: boolean): void {
  updateSettings({ overlayEnabled: enabled });
}

export function getDiscordEnabled(): boolean {
  return getSettings().discordPresenceEnabled;
}

export function setDiscordEnabled(enabled: boolean): void {
  updateSettings({ discordPresenceEnabled: enabled });
}

export function getArtistImageFetchingEnabled(): boolean {
  return getSettings().artistImageFetchingEnabled;
}

export function setArtistImageFetchingEnabled(enabled: boolean): void {
  updateSettings({ artistImageFetchingEnabled: enabled });
}
