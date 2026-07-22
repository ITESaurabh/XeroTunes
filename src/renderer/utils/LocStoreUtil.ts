import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  QueueState,
  ThemeMode,
  ThemeSettings,
  PlaybackSettings,
  PlaybackRepeatMode,
  LibrarySettings,
  ViewSettings,
  FolderViewSettings,
  TitleBarStyle,
  clampWindowScale,
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

export function getOnboardingComplete(): boolean {
  try {
    return ipcRenderer.sendSync('get-onboarding-status') === true;
  } catch {
    // On error, skip onboarding rather than trapping the user in it.
    return true;
  }
}

export function completeOnboarding(meta?: { skipped?: boolean }): void {
  try {
    ipcRenderer.sendSync('complete-onboarding', meta ?? {});
  } catch {
    /* ignore */
  }
}

export function resetOnboarding(): void {
  try {
    ipcRenderer.sendSync('reset-onboarding');
  } catch {
    /* ignore */
  }
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
    views: {
      folders: {
        ...DEFAULT_APP_SETTINGS.views.folders,
        ...(parsed.views?.folders ?? {}),
      },
      folderHierarchy: {
        ...DEFAULT_APP_SETTINGS.views.folderHierarchy,
        ...(parsed.views?.folderHierarchy ?? {}),
      },
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
    views: {
      folders: {
        ...current.views.folders,
        ...(update.views?.folders ?? {}),
      },
      folderHierarchy: {
        ...current.views.folderHierarchy,
        ...(update.views?.folderHierarchy ?? {}),
      },
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

export function getPauseOnAudioOutputChange(): boolean {
  return getPlaybackSettings().pauseOnAudioOutputChange;
}

export function setPauseOnAudioOutputChange(enabled: boolean): void {
  updateSettings({ playback: { ...getPlaybackSettings(), pauseOnAudioOutputChange: enabled } });
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

export function setQueueState(
  queue: unknown[],
  queueIndex: number,
  track: unknown,
  queueSource?: string | null
): void {
  writeQueueState({ queue, queueIndex, track, queueSource: queueSource ?? null });
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

export function getWindowScale(): number {
  return clampWindowScale(getSettings().windowScale);
}

export function setWindowScale(scale: number): number {
  const safe = clampWindowScale(scale);
  updateSettings({ windowScale: safe });
  ipcRenderer
    .invoke('set-window-scale', { scale: safe })
    .catch((err: unknown) => console.warn('Failed to apply window scale:', err));
  return safe;
}

export function getTitleBarStyle(): TitleBarStyle {
  return getSettings().theme.titleBarStyle;
}

export function setTitleBarStyle(style: TitleBarStyle): TitleBarStyle {
  const next = setThemeSettings({ titleBarStyle: style });
  const showNative = style === 'mac' || style === 'default';
  ipcRenderer
    .invoke('set-traffic-light-visibility', { visible: showNative })
    .catch((err: unknown) => console.warn('Failed to set traffic light visibility:', err));
  return next.titleBarStyle;
}

export function getViewSettings(): ViewSettings {
  return getSettings().views;
}

export function getFolderViewSettings(key: keyof ViewSettings): FolderViewSettings {
  return getViewSettings()[key];
}

export function setFolderViewSettings(
  key: keyof ViewSettings,
  update: Partial<FolderViewSettings>
): FolderViewSettings {
  const current = getViewSettings();
  const next: FolderViewSettings = { ...current[key], ...update };
  updateSettings({ views: { ...current, [key]: next } });
  return next;
}
