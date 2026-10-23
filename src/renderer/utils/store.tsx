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
  getAlwaysShowScrollbar,
  setAlwaysShowScrollbar,
  getActiveTheme,
  setActiveTheme,
} from './LocStoreUtil';
import { AMETHYST, AppTheme } from '../../config/theme';
import { ThemeMode, TitleBarStyle } from '../../config/app_settings';
import { ScanMode } from '../../config/constants';
import {
  insertUnique,
  markPlaying,
  queuedAround,
  removeQueueEntry,
  unshuffle,
} from './queueOps';

export type RepeatMode = 'off' | 'all' | 'one';

export interface Track {
  Id?: string | number;
  [key: string]: unknown;
}

/**
 * Slim playback record stored in the queue / current-track state.
 * Only fields actually consumed by PlayBar / OS metadata / navigation
 * are kept; full Track records (which include genre, year, track number,
 * extension, etc.) stay in their respective React Query lists and are
 * not duplicated into the global store.
 *
 * A type alias on purpose: an interface isn't assignable to Track's index signature.
 */
export type QueueTrack = {
  Id: string | number;
  Title?: string;
  Uri?: string;
  AlbumArt?: string;
  AlbumId?: string | number;
  AlbumTitle?: string;
  ArtistName?: string;
  /** Added with "Play next" / "Add to queue" and not played yet. */
  Queued?: boolean;
};

const PLAYBACK_FIELDS: readonly (keyof QueueTrack)[] = [
  'Id',
  'Title',
  'Uri',
  'AlbumArt',
  'AlbumId',
  'AlbumTitle',
  'ArtistName',
  'Queued',
];

export function pickQueueTrack(track: Track | QueueTrack | null | undefined): QueueTrack | null {
  if (!track || track.Id == null) return null;
  const slim: QueueTrack = { Id: track.Id };
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
  /**
   * Which server the counts belong to, when a sync is walking several. Without
   * it the bar restarting at every source looks like the first one was lost.
   */
  source?: {
    index: number;
    count: number;
    name: string | null;
    type: string;
    accent: string | null;
  };
}

export interface LibraryStats {
  songs: number;
  favourites: number;
  playlists: number;
  streams: number;
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
  isFullScreen: boolean;
  isWindowFocused: boolean;
  isMenuExpanded: boolean;
  path: string | null;
  track: QueueTrack | null;
  isPlaying: boolean;
  position: number;
  searchEnabled: boolean;
  queue: QueueTrack[];
  queueIndex: number;
  originalOrder: (string | number)[];
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isPlayerBarVisible: boolean;
  /** How far the shown player bar's top edge sits above the page bottom. */
  playBarInset: number;
  isLyricsExpanded: boolean;
  isScanningLibrary: boolean;
  /** A remote sync specifically, which unlike a local scan runs on the main process. */
  isSyncing: boolean;
  scanMode: ScanMode | null;
  scanProgress: ScanProgress | null;
  libraryStats: LibraryStats | null;
  queueSource: string | null;
  titleBarStyle: TitleBarStyle;
  alwaysShowScrollbar: boolean;
  appTheme: AppTheme;
  isCasting: boolean;
  castDeviceName: string | null;
}

export type AppAction =
  | { type: 'SET_THEME_MODE'; payload: ThemeMode }
  | { type: 'SET_TITLEBAR_STYLE'; payload: TitleBarStyle }
  | { type: 'SET_ALWAYS_SHOW_SCROLLBAR'; payload: boolean }
  | { type: 'SET_APP_THEME'; payload: AppTheme }
  | { type: 'SET_IS_MAXIMIZED'; payload: boolean }
  | { type: 'SET_IS_FULLSCREEN'; payload: boolean }
  | { type: 'SET_WINDOW_FOCUSED'; payload: boolean }
  | { type: 'SET_SEARCH_ENABLED'; payload: boolean }
  | { type: 'SET_MENU_EXPANDED'; payload: boolean }
  | { type: 'SET_QUEUE'; payload: { queue: Track[]; index?: number; source?: string | null } }
  | { type: 'SET_PATH'; payload: string | null }
  | { type: 'SET_CURR_TRACK'; payload: Track }
  | { type: 'REFRESH_QUEUE_TRACKS'; payload: Track[] }
  | { type: 'ENQUEUE'; payload: { tracks: Track[]; next?: boolean } }
  | { type: 'PLAY_QUEUE_INDEX'; payload: number }
  | { type: 'REORDER_QUEUE'; payload: QueueTrack[] }
  | { type: 'REMOVE_FROM_QUEUE'; payload: number }
  | { type: 'CLEAR_UP_NEXT' }
  | { type: 'SET_IS_PLAYING'; payload: boolean }
  | { type: 'SET_PROGRESS'; payload: number }
  | { type: 'CHANGE_TRACK' }
  | { type: 'NEXT_TRACK' }
  | { type: 'PREV_TRACK' }
  | { type: 'SET_REPEAT_MODE'; payload: RepeatMode }
  | { type: 'SET_PLAYER_BAR_VISIBLE'; payload: boolean }
  | { type: 'SET_PLAYBAR_INSET'; payload: number }
  | { type: 'SET_LYRICS_EXPANDED'; payload: boolean }
  | { type: 'SET_SHUFFLE'; payload: boolean }
  | { type: 'SET_SCANNING'; payload: { isScanning: boolean; scanMode?: ScanMode | null } }
  | { type: 'SET_SYNCING'; payload: boolean }
  | { type: 'SET_SCAN_PROGRESS'; payload: ScanProgress }
  | { type: 'SET_LIBRARY_STATS'; payload: LibraryStats }
  | { type: 'SET_CASTING'; payload: { isCasting: boolean; deviceName: string | null } }
  | { type: 'RESET_PLAYBACK' };

export interface StoreContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  /** @deprecated use `state`; kept for backward compat */
  _state?: AppState;
}

const initialState: AppState = (() => {
  const saved = getQueueState();
  let savedShuffle = false;
  let savedRepeat: RepeatMode = 'off';
  let savedTitleBarStyle: TitleBarStyle = 'default';
  let savedAlwaysShowScrollbar = false;
  let savedAppTheme: AppTheme = AMETHYST;
  try {
    savedShuffle = getPlaybackShuffle();
    savedRepeat = getPlaybackRepeatMode();
    savedTitleBarStyle = getTitleBarStyle();
    savedAlwaysShowScrollbar = getAlwaysShowScrollbar();
    savedAppTheme = getActiveTheme();
  } catch {
    /* settings unavailable: fall back to defaults */
  }
  const restoredQueue = toQueueTracks((saved?.queue as Track[]) ?? []);
  const restoredTrack = pickQueueTrack((saved?.track as Track) ?? null);
  return {
    isLightTheme: true,
    isMaximized: false,
    isFullScreen: false,
    isWindowFocused: typeof document !== 'undefined' ? document.hasFocus() : true,
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
    playBarInset: 0,
    isLyricsExpanded: false,
    isScanningLibrary: false,
    isSyncing: false,
    scanMode: null,
    scanProgress: null,
    libraryStats: null,
    queueSource: saved?.queueSource ?? null,
    titleBarStyle: savedTitleBarStyle,
    alwaysShowScrollbar: savedAlwaysShowScrollbar,
    appTheme: savedAppTheme,
    isCasting: false,
    castDeviceName: null,
  };
})();

export const store = createContext<StoreContextValue>({
  state: initialState,
  dispatch: () => undefined,
});
const { Provider } = store;

// Unshuffled, the queue as edited is the order to return to; shuffled, the
// pre-shuffle order still is.
const orderAfterEdit = (state: AppState, queue: QueueTrack[]) =>
  state.isShuffle ? state.originalOrder : queue.map(t => t.Id);

function playAt(state: AppState, index: number): AppState {
  const queue = markPlaying(state.queue, index);
  const track = queue[index];
  setQueueState(queue, index, track, state.queueSource);
  return { ...state, queue, queueIndex: index, track, isPlaying: true };
}

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
    case 'SET_ALWAYS_SHOW_SCROLLBAR': {
      setAlwaysShowScrollbar(action.payload);
      return { ...state, alwaysShowScrollbar: action.payload };
    }
    case 'SET_APP_THEME': {
      setActiveTheme(action.payload.name);
      return { ...state, appTheme: action.payload };
    }
    case 'SET_IS_MAXIMIZED': {
      return { ...state, isMaximized: action.payload };
    }
    case 'SET_IS_FULLSCREEN': {
      if (state.isFullScreen === action.payload) return state;
      return { ...state, isFullScreen: action.payload };
    }
    case 'SET_WINDOW_FOCUSED': {
      if (state.isWindowFocused === action.payload) return state;
      return { ...state, isWindowFocused: action.payload };
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
    // The queue holds a snapshot taken when playback started, so anything that
    // rewrites a track in the library (tag edits, a rescan) leaves it stale.
    case 'REFRESH_QUEUE_TRACKS': {
      const fresh = new Map<string | number, QueueTrack>();
      for (const t of toQueueTracks(action.payload)) fresh.set(t.Id, t);
      if (!fresh.size) return state;
      // Copied per entry: the queue finds entries by identity, so a song queued twice must
      // not become one shared object. The DB row has no Queued.
      const queue = state.queue.map(t => {
        const f = fresh.get(t.Id);
        return f ? { ...f, Queued: t.Queued } : t;
      });
      const track = state.track ? (fresh.get(state.track.Id) ?? state.track) : state.track;
      if (track === state.track && queue.every((t, i) => t === state.queue[i])) return state;
      setQueueState(queue, state.queueIndex, track, state.queueSource);
      return { ...state, queue, track };
    }
    case 'ENQUEUE': {
      const items = toQueueTracks(action.payload.tracks);
      if (!items.length) return state;
      // Nothing playing, so there is no queue to slot into; the songs become it.
      if (!state.track) {
        return playAt(
          reducer(state, { type: 'SET_QUEUE', payload: { queue: items, index: 0, source: null } }),
          0
        );
      }
      for (const t of items) t.Queued = true;
      const at = action.payload.next ? state.queueIndex + 1 : state.queue.length;
      const { queue, index } = insertUnique(state.queue, state.queueIndex, at, items);
      setQueueState(queue, index, state.track, state.queueSource);
      return {
        ...state,
        queue,
        queueIndex: index,
        originalOrder: state.isShuffle
          ? [...state.originalOrder, ...items.map(t => t.Id)]
          : queue.map(t => t.Id),
      };
    }
    case 'PLAY_QUEUE_INDEX': {
      if (!state.queue[action.payload]) return state;
      return playAt(state, action.payload);
    }
    // The payload is a permutation of the current entries, so the playing one is
    // found again by identity.
    case 'REORDER_QUEUE': {
      const queue = action.payload;
      const queueIndex = Math.max(0, queue.indexOf(state.queue[state.queueIndex]));
      setQueueState(queue, queueIndex, state.track, state.queueSource);
      return { ...state, queue, queueIndex, originalOrder: orderAfterEdit(state, queue) };
    }
    case 'REMOVE_FROM_QUEUE': {
      const res = removeQueueEntry(state.queue, state.queueIndex, action.payload);
      if (!res) return state;
      setQueueState(res.queue, res.index, state.track, state.queueSource);
      return {
        ...state,
        queue: res.queue,
        queueIndex: res.index,
        originalOrder: orderAfterEdit(state, res.queue),
      };
    }
    case 'CLEAR_UP_NEXT': {
      const queue = state.queue.slice(0, state.queueIndex + 1);
      if (queue.length === state.queue.length) return state;
      setQueueState(queue, state.queueIndex, state.track, state.queueSource);
      return { ...state, queue, originalOrder: orderAfterEdit(state, queue) };
    }
    case 'SET_IS_PLAYING': {
      if (state.isPlaying === action.payload) return state;
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
      return nextIndex < state.queue.length ? playAt(state, nextIndex) : state;
    }
    case 'PREV_TRACK': {
      let prevIndex = state.queueIndex - 1;
      if (state.repeatMode === 'all' && prevIndex < 0) prevIndex = state.queue.length - 1;
      return prevIndex >= 0 ? playAt(state, prevIndex) : state;
    }
    case 'SET_REPEAT_MODE': {
      setPlaybackRepeatMode(action.payload);
      return { ...state, repeatMode: action.payload };
    }
    case 'SET_PLAYER_BAR_VISIBLE': {
      // useScrollHidePlayerBar fires this on every scroll tick, usually with the
      // value already set; without this guard each tick re-renders every consumer.
      if (state.isPlayerBarVisible === action.payload) return state;
      return {
        ...state,
        isPlayerBarVisible: action.payload,
        isLyricsExpanded: action.payload && state.isLyricsExpanded,
      };
    }
    case 'SET_PLAYBAR_INSET': {
      if (state.playBarInset === action.payload) return state;
      return { ...state, playBarInset: action.payload };
    }
    case 'SET_LYRICS_EXPANDED': {
      return { ...state, isLyricsExpanded: action.payload };
    }
    case 'SET_SCANNING': {
      const { isScanning, scanMode } = action.payload;
      return {
        ...state,
        isScanningLibrary: isScanning,
        scanMode: isScanning ? (scanMode ?? state.scanMode) : null,
        scanProgress: isScanning ? state.scanProgress : null,
      };
    }
    case 'SET_SCAN_PROGRESS': {
      return { ...state, scanProgress: action.payload };
    }
    case 'SET_SYNCING': {
      return { ...state, isSyncing: action.payload };
    }
    case 'SET_LIBRARY_STATS': {
      return { ...state, libraryStats: action.payload };
    }
    case 'SET_CASTING': {
      return {
        ...state,
        isCasting: action.payload.isCasting,
        castDeviceName: action.payload.deviceName,
      };
    }
    case 'RESET_PLAYBACK': {
      // Clear the persisted queue too, so no track lingers across reloads.
      setQueueState([], 0, null, null);
      return {
        ...state,
        queue: [],
        queueIndex: 0,
        originalOrder: [],
        track: null,
        isPlaying: false,
        position: 0,
        queueSource: null,
      };
    }
    case 'SET_SHUFFLE': {
      setPlaybackShuffle(!!action.payload);
      if (action.payload) {
        // By position, not Id: an Id filter also drops other copies of the playing song.
        // The user's songs keep their place, next or at the end; only the list is shuffled.
        const at = state.queueIndex;
        const currentTrack = state.queue[at] ?? state.track;
        const { next, later } = queuedAround(state.queue, at);
        const otherTracks = state.queue.filter((t, i) => i < at || (i > at && !t.Queued));
        for (let i = otherTracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
        }
        const rest = [...next, ...otherTracks, ...later];
        const shuffledQueue = currentTrack ? [currentTrack, ...rest] : rest;
        return { ...state, isShuffle: true, queue: shuffledQueue, queueIndex: 0 };
      } else {
        const restored = unshuffle(state.queue, state.originalOrder, state.queueIndex);
        return { ...state, isShuffle: false, queue: restored.queue, queueIndex: restored.index };
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
