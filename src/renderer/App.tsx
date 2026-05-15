import React, { useContext, useEffect, useMemo, useState } from 'react';
import { store } from './utils/store';
import { getThemeSettings } from './utils/LocStoreUtil';
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
  }, []);

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
        <Titlebar />
        {element}
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
