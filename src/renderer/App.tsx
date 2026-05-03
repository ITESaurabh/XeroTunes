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
import { useKeyboardShortcuts, SHORTCUTS } from './utils/useKeyboardShortcuts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 5 minutes → no refetch on re-mount
      staleTime: 5 * 60 * 1000,
      // Unused query cache is released after 2 minutes
      gcTime: 2 * 60 * 1000,
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

  // Refresh all queries when the main process reports new/updated library files
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries();
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
