import { createContext, useReducer, ReactNode, Dispatch } from 'react';
import {
  setTheme,
  setQueueState,
  getQueueState,
  getPlaybackShuffle,
  getPlaybackRepeatMode,
  setPlaybackShuffle,
  setPlaybackRepeatMode,
  getTitleBarStyle,
  setTitleBarStyle,
} from './LocStoreUtil';
import { ThemeMode, TitleBarStyle } from 'src/config/app_settings';

export type RepeatMode = 'off' | 'all' | 'one';

export interface Track {
  Id?: string | number;
  [key: string]: unknown;
}

/**
 * Slim playback record stored in the queue / current-track state.
 * Only fields actually consumed by PlayBar / OS metadata / navigation
 * are kept — full Track records (which include genre, year, track number,
 * extension, etc.) stay in their respective React Query lists and are
 * not duplicated into the global store.
 */
export interface QueueTrack {
  Id: string | number;
  Title?: string;
  Uri?: string;
  AlbumArt?: string;
  AlbumId?: string | number;
  AlbumTitle?: string;
  ArtistName?: string;
}

const PLAYBACK_FIELDS: readonly (keyof QueueTrack)[] = [
  'Id',
  'Title',
  'Uri',
  'AlbumArt',
  'AlbumId',
  'AlbumTitle',
  'ArtistName',
];

export function pickQueueTrack(track: Track | QueueTrack | null | undefined): QueueTrack | null {
  if (!track || track.Id == null) return null;
  const slim: QueueTrack = { Id: track.Id as string | number };
  for (const k of PLAYBACK_FIELDS) {
    if (k === 'Id') continue;
    const v = (track as Record<string, unknown>)[k];
    if (v != null) (slim as Record<string, unknown>)[k] = v;
  }
  return slim;
}

function toQueueTracks(list: Track[] | QueueTrack[]): QueueTrack[] {
  const out: QueueTrack[] = [];
  for (const t of list) {
    const slim = pickQueueTrack(t);
    if (slim) out.push(slim);
  }
  return out;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  processed: number;
}

export interface LibraryStats {
  songs: number;
  favourites: number;
  playlists: number;
  albums: number;
  artists: number;
  albumArtists: number;
  folders: number;
  genres: number;
  years: number;
  recentlyAdded: number;
}

export interface AppState {
  isLightTheme: boolean;
  isMaximized: boolean;
  isMenuExpanded: boolean;
  path: string | null;
  track: QueueTrack | null;
  isPlaying: boolean;
  position: number;
  searchEnabled: boolean;
  queue: QueueTrack[];
  queueIndex: number;
  /** Original (un-shuffled) order of the queue, stored as IDs only to avoid a full Track[] duplicate. */
  originalOrder: (string | number)[];
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isPlayerBarVisible: boolean;
  isLyricsExpanded: boolean;
  isScanningLibrary: boolean;
  isFullScan: boolean;
  scanProgress: ScanProgress | null;
  libraryStats: LibraryStats | null;
  queueSource: string | null;
  titleBarStyle: TitleBarStyle;
}

export type AppAction =
  | { type: 'SET_THEME_MODE'; payload: ThemeMode }
  | { type: 'SET_TITLEBAR_STYLE'; payload: TitleBarStyle }
  | { type: 'SET_IS_MAXIMIZED'; payload: boolean }
  | { type: 'SET_SEARCH_ENABLED'; payload: boolean }
  | { type: 'SET_MENU_EXPANDED'; payload: boolean }
  | { type: 'SET_QUEUE'; payload: { queue: Track[]; index?: number; source?: string | null } }
  | { type: 'SET_PATH'; payload: string | null }
  | { type: 'SET_CURR_TRACK'; payload: Track }
  | { type: 'SET_IS_PLAYING'; payload: boolean }
  | { type: 'SET_PROGRESS'; payload: number }
  | { type: 'CHANGE_TRACK' }
  | { type: 'NEXT_TRACK' }
  | { type: 'PREV_TRACK' }
  | { type: 'SET_REPEAT_MODE'; payload: RepeatMode }
  | { type: 'SET_PLAYER_BAR_VISIBLE'; payload: boolean }
  | { type: 'SET_LYRICS_EXPANDED'; payload: boolean }
  | { type: 'SET_SHUFFLE'; payload: boolean }
  | { type: 'SET_SCANNING'; payload: { isScanning: boolean; isFullScan?: boolean } }
  | { type: 'SET_SCAN_PROGRESS'; payload: ScanProgress }
  | { type: 'SET_LIBRARY_STATS'; payload: LibraryStats };

export interface StoreContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  /** @deprecated use `state` - kept for backward compat */
  _state?: AppState;
}

const initialState: AppState = (() => {
  const saved = getQueueState();
  let savedShuffle = false;
  let savedRepeat: RepeatMode = 'off';
  let savedTitleBarStyle: TitleBarStyle = 'default';
  try {
    savedShuffle = getPlaybackShuffle();
    savedRepeat = getPlaybackRepeatMode();
    savedTitleBarStyle = getTitleBarStyle();
  } catch {
    /* settings unavailable — fall back to defaults */
  }
  const restoredQueue = toQueueTracks((saved?.queue as Track[]) ?? []);
  const restoredTrack = pickQueueTrack((saved?.track as Track) ?? null);
  return {
    isLightTheme: true,
    isMaximized: false,
    isMenuExpanded: typeof window !== 'undefined' ? window.innerWidth >= 960 : true,
    path: null,
    track: restoredTrack,
    isPlaying: false,
    position: 0,
    searchEnabled: false,
    queue: restoredQueue,
    queueIndex: saved?.queueIndex || 0,
    originalOrder: restoredQueue.map(t => t.Id),
    repeatMode: savedRepeat,
    isShuffle: savedShuffle,
    isPlayerBarVisible: true,
    isLyricsExpanded: false,
    isScanningLibrary: false,
    isFullScan: false,
    scanProgress: null,
    libraryStats: null,
    queueSource: saved?.queueSource ?? null,
    titleBarStyle: savedTitleBarStyle,
  };
})();

export const store = createContext<StoreContextValue>({
  state: initialState,
  dispatch: () => undefined,
});
const { Provider } = store;

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_THEME_MODE': {
      setTheme(action.payload);
      const isLightTheme =
        action.payload === 1
          ? true
          : action.payload === 2
            ? false
            : !window.matchMedia('(prefers-color-scheme: dark)').matches;
      return { ...state, isLightTheme };
    }
    case 'SET_TITLEBAR_STYLE': {
      setTitleBarStyle(action.payload);
      return { ...state, titleBarStyle: action.payload };
    }
    case 'SET_IS_MAXIMIZED': {
      return { ...state, isMaximized: action.payload };
    }
    case 'SET_SEARCH_ENABLED': {
      return { ...state, searchEnabled: action.payload };
    }
    case 'SET_MENU_EXPANDED': {
      return { ...state, isMenuExpanded: action.payload };
    }
    case 'SET_QUEUE': {
      const nextSource =
        action.payload.source !== undefined ? action.payload.source : state.queueSource;
      const slimQueue = toQueueTracks(action.payload.queue);
      const requestedIndex = action.payload.index || 0;
      const originalOrder = slimQueue.map(t => t.Id);

      let finalQueue = slimQueue;
      let finalIndex = requestedIndex;
      if (state.isShuffle && slimQueue.length > 1) {
        const startTrack = slimQueue[requestedIndex];
        const others = slimQueue.filter((_, i) => i !== requestedIndex);
        for (let i = others.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [others[i], others[j]] = [others[j], others[i]];
        }
        finalQueue = startTrack ? [startTrack, ...others] : others;
        finalIndex = 0;
      }

      setQueueState(finalQueue, finalIndex, state.track, nextSource);
      return {
        ...state,
        queue: finalQueue,
        queueIndex: finalIndex,
        originalOrder,
        queueSource: nextSource,
      };
    }
    case 'SET_PATH': {
      return { ...state, path: action.payload };
    }
    case 'SET_CURR_TRACK': {
      const slim = pickQueueTrack(action.payload);
      setQueueState(state.queue, state.queueIndex, slim, state.queueSource);
      return { ...state, track: slim };
    }
    case 'SET_IS_PLAYING': {
      return { ...state, isPlaying: action.payload };
    }
    case 'SET_PROGRESS': {
      return { ...state, position: action.payload };
    }
    case 'CHANGE_TRACK': {
      return { ...initialState };
    }
    case 'NEXT_TRACK': {
      let nextIndex = state.queueIndex + 1;
      if (state.repeatMode === 'all' && nextIndex >= state.queue.length) nextIndex = 0;
      if (nextIndex < state.queue.length) {
        setQueueState(state.queue, nextIndex, state.queue[nextIndex], state.queueSource);
        return {
          ...state,
          queueIndex: nextIndex,
          track: state.queue[nextIndex],
          isPlaying: true,
        };
      }
      return state;
    }
    case 'PREV_TRACK': {
      let prevIndex = state.queueIndex - 1;
      if (state.repeatMode === 'all' && prevIndex < 0) prevIndex = state.queue.length - 1;
      if (prevIndex >= 0) {
        setQueueState(state.queue, prevIndex, state.queue[prevIndex], state.queueSource);
        return {
          ...state,
          queueIndex: prevIndex,
          track: state.queue[prevIndex],
          isPlaying: true,
        };
      }
      return state;
    }
    case 'SET_REPEAT_MODE': {
      setPlaybackRepeatMode(action.payload);
      return { ...state, repeatMode: action.payload };
    }
    case 'SET_PLAYER_BAR_VISIBLE': {
      return { ...state, isPlayerBarVisible: action.payload };
    }
    case 'SET_LYRICS_EXPANDED': {
      return { ...state, isLyricsExpanded: action.payload };
    }
    case 'SET_SCANNING': {
      const { isScanning, isFullScan } = action.payload;
      return {
        ...state,
        isScanningLibrary: isScanning,
        isFullScan: isScanning ? (isFullScan ?? state.isFullScan) : false,
        scanProgress: isScanning ? state.scanProgress : null,
      };
    }
    case 'SET_SCAN_PROGRESS': {
      return { ...state, scanProgress: action.payload };
    }
    case 'SET_LIBRARY_STATS': {
      return { ...state, libraryStats: action.payload };
    }
    case 'SET_SHUFFLE': {
      setPlaybackShuffle(!!action.payload);
      if (action.payload) {
        const currentTrack = state.track;
        const currentQueue = state.isShuffle ? state.queue : [...state.queue];
        const otherTracks = currentQueue.filter(track => track.Id !== currentTrack?.Id);
        for (let i = otherTracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
        }
        const shuffledQueue = currentTrack ? [currentTrack, ...otherTracks] : otherTracks;
        return { ...state, isShuffle: true, queue: shuffledQueue, queueIndex: 0 };
      } else {
        // Restore original order by mapping recorded IDs back to QueueTracks held
        // in the current (shuffled) queue — no full Track[] duplicate kept.
        const byId = new Map<string | number, QueueTrack>();
        for (const t of state.queue) byId.set(t.Id, t);
        const restored: QueueTrack[] = [];
        for (const id of state.originalOrder) {
          const t = byId.get(id);
          if (t) restored.push(t);
        }
        const currentTrack = state.track;
        const originalIndex = currentTrack
          ? restored.findIndex(track => track.Id === currentTrack.Id)
          : 0;
        return {
          ...state,
          isShuffle: false,
          queue: restored,
          queueIndex: originalIndex >= 0 ? originalIndex : 0,
        };
      }
    }
    default:
      return state;
  }
}

interface StateProviderProps {
  children: ReactNode;
}

export const StateProvider = ({ children }: StateProviderProps) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <Provider value={{ state, dispatch }}>{children}</Provider>;
};
