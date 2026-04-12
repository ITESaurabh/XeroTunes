import { createContext, useReducer, ReactNode, Dispatch } from 'react';
import { setTheme, setQueueState, getQueueState } from './LocStoreUtil';
import { ThemeMode } from 'src/config/app_settings';

export type RepeatMode = 'off' | 'all' | 'one';

export interface Track {
  Id?: string | number;
  [key: string]: unknown;
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
}

export interface AppState {
  isLightTheme: boolean;
  isMaximized: boolean;
  isMenuExpanded: boolean;
  path: string | null;
  track: Track | null;
  isPlaying: boolean;
  position: number;
  searchEnabled: boolean;
  queue: Track[];
  queueIndex: number;
  originalQueue: Track[];
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isPlayerBarVisible: boolean;
  isLyricsExpanded: boolean;
  isScanningLibrary: boolean;
  scanProgress: ScanProgress | null;
  libraryStats: LibraryStats | null;
}

export type AppAction =
  | { type: 'SET_THEME_MODE'; payload: ThemeMode }
  | { type: 'SET_IS_MAXIMIZED'; payload: boolean }
  | { type: 'SET_SEARCH_ENABLED'; payload: boolean }
  | { type: 'SET_MENU_EXPANDED'; payload: boolean }
  | { type: 'SET_QUEUE'; payload: { queue: Track[]; index?: number } }
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
  | { type: 'SET_SCANNING'; payload: boolean }
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
  return {
    isLightTheme: true,
    isMaximized: false,
    isMenuExpanded: true,
    path: null,
    track: (saved?.track as Track) || null,
    isPlaying: false,
    position: 0,
    searchEnabled: false,
    queue: (saved?.queue as Track[]) || [],
    queueIndex: saved?.queueIndex || 0,
    originalQueue: (saved?.queue as Track[]) || [],
    repeatMode: 'off',
    isShuffle: false,
    isPlayerBarVisible: true,
    isLyricsExpanded: false,
    isScanningLibrary: false,
    scanProgress: null,
    libraryStats: null,
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
      setQueueState(action.payload.queue, action.payload.index || 0, state.track);
      return {
        ...state,
        queue: action.payload.queue,
        queueIndex: action.payload.index || 0,
        originalQueue: action.payload.queue,
      };
    }
    case 'SET_PATH': {
      return { ...state, path: action.payload };
    }
    case 'SET_CURR_TRACK': {
      setQueueState(state.queue, state.queueIndex, action.payload);
      return { ...state, track: action.payload };
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
        setQueueState(state.queue, nextIndex, state.queue[nextIndex]);
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
        setQueueState(state.queue, prevIndex, state.queue[prevIndex]);
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
      return { ...state, repeatMode: action.payload };
    }
    case 'SET_PLAYER_BAR_VISIBLE': {
      return { ...state, isPlayerBarVisible: action.payload };
    }
    case 'SET_LYRICS_EXPANDED': {
      return { ...state, isLyricsExpanded: action.payload };
    }
    case 'SET_SCANNING': {
      return {
        ...state,
        isScanningLibrary: action.payload,
        scanProgress: action.payload ? state.scanProgress : null,
      };
    }
    case 'SET_SCAN_PROGRESS': {
      return { ...state, scanProgress: action.payload };
    }
    case 'SET_LIBRARY_STATS': {
      return { ...state, libraryStats: action.payload };
    }
    case 'SET_SHUFFLE': {
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
        const currentTrack = state.track;
        const originalQueue = [...state.originalQueue];
        const originalIndex = currentTrack
          ? originalQueue.findIndex(track => track.Id === currentTrack.Id)
          : 0;
        return {
          ...state,
          isShuffle: false,
          queue: originalQueue,
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
