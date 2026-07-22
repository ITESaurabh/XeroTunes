import React, { useContext, useEffect, useMemo, useState } from 'react';
import { store } from './utils/store';
import { getThemeSettings, getOnboardingComplete } from './utils/LocStoreUtil';
import Onboarding from './views/Onboarding';
import { useRoutes } from 'react-router';
import { createTheme, CssBaseline, responsiveFontSizes, ThemeProvider } from '@mui/material';
import routes from './utils/routes';
// import '@fontsource/open-sans/300.css';
// import '@fontsource/open-sans/400.css';
// import '@fontsource/open-sans/500.css';
// import '@fontsource/open-sans/600.css';
import { getBaseTheme } from '../config/theme';
import { ipcRenderer } from 'electron';
import Titlebar from './components/Titlebar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QUERY_KEYS } from './constants/queryKeys';
import { useKeyboardShortcuts, SHORTCUTS } from './utils/useKeyboardShortcuts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays fresh for 1 min → no refetch on quick re-mount
      staleTime: 60 * 1000,
      // Unused query cache is released after 30 s — keeps RAM tight while
      // still feeling instant for fast back-and-forth navigation.
      gcTime: 30 * 1000,
    },
  },
});

const App = () => {
  const { state, dispatch } = useContext(store);
  const [systemIsDark, setSystemIsDark] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(() => getOnboardingComplete());
  const themeSettings = getThemeSettings();

  // console.log('Re Render Core');
  const themePref = useMemo(() => {
    if (themeSettings.mode === 1) return 'light';
    if (themeSettings.mode === 2) return 'dark';
    return systemIsDark ? 'dark' : 'light';
  }, [themeSettings.mode, systemIsDark]);
  const finalRoutes = useMemo(() => routes, []);

  const element = useRoutes(finalRoutes);

  const theme = useMemo(() => {
    const darkModeTheme = createTheme(getBaseTheme(themePref));
    return responsiveFontSizes(darkModeTheme);
  }, [themePref]);

  useEffect(() => {
    ipcRenderer.invoke('get-dark-mode').then(darkMode => {
      setSystemIsDark(darkMode);
    });
    // Follow OS light/dark changes at runtime for the Auto theme.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const setFocused = (focused: boolean) =>
      dispatch({ type: 'SET_WINDOW_FOCUSED', payload: focused });
    const handleFocus = () => setFocused(true);
    const handleBlur = () => setFocused(false);
    // Sync in case focus changed before this effect ran.
    setFocused(document.hasFocus());
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [dispatch]);

  // Refresh library list queries when the main process reports new/updated files.
  // Only invalidate the specific list keys — never nuke the whole cache, which
  // would force every active view to refetch in parallel and flash empty states.
  useEffect(() => {
    const handler = () => {
      const listKeys = [
        QUERY_KEYS.ALL_SONGS,
        QUERY_KEYS.ALL_ALBUMS,
        QUERY_KEYS.ALL_ARTISTS,
        QUERY_KEYS.RECENTLY_ADDED,
        QUERY_KEYS.FOLDERS_WITH_SONGS,
        QUERY_KEYS.FOLDER_CHILDREN,
        QUERY_KEYS.FOLDER_SONGS,
        QUERY_KEYS.ALL_GENRES,
        QUERY_KEYS.ALL_YEARS,
      ];
      listKeys.forEach(key => {
        queryClient.invalidateQueries({ queryKey: [key], refetchType: 'active' });
      });
    };
    ipcRenderer.on('library-updated', handler);
    return () => {
      ipcRenderer.removeListener('library-updated', handler);
    };
  }, []);

  useEffect(() => {
    dispatch({ type: 'SET_THEME_MODE', payload: themeSettings.mode });
  }, [themeSettings.mode, dispatch]);

  // Register keyboard shortcuts
  useKeyboardShortcuts(
    [
      {
        ...SHORTCUTS.SEARCH,
        action: () => dispatch({ type: 'SET_SEARCH_ENABLED', payload: !state.searchEnabled }),
      },
    ],
    { dispatch }
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Titlebar minimal={!onboardingComplete} />
        {onboardingComplete ? (
          element
        ) : (
          <Onboarding onFinish={() => setOnboardingComplete(true)} />
        )}
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
