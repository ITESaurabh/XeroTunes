import React, { useContext, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { StateProvider, store } from './utils/store';
import { getThemeSettings } from './utils/LocStoreUtil';
import { createTheme, CssBaseline, responsiveFontSizes, ThemeProvider } from '@mui/material';
// import '@fontsource/open-sans/300.css';
// import '@fontsource/open-sans/400.css';
// import '@fontsource/open-sans/500.css';
// import '@fontsource/open-sans/600.css';
import MiniPlayerView from './views/MiniPlayer/MiniPlayerView';
import { getBaseTheme } from '../config/theme';
import { IpcProvider } from './state/ipc';
import './styles/mini_player.scss';

const root = createRoot(document.getElementById('app')!);

const App = () => {
  const isDarkThemePreferred = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const { dispatch } = useContext(store);
  const themeSettings = getThemeSettings();
  const themePref: 'light' | 'dark' =
    themeSettings.mode === 1
      ? 'light'
      : themeSettings.mode === 2
        ? 'dark'
        : isDarkThemePreferred
          ? 'dark'
          : 'light';
  const darkModeTheme = createTheme(getBaseTheme(themePref));
  const theme = responsiveFontSizes(darkModeTheme);

  useEffect(() => {
    dispatch({ type: 'SET_THEME_MODE', payload: themeSettings.mode });
  }, [themeSettings.mode, dispatch]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <MiniPlayerView />
    </ThemeProvider>
  );
};

root.render(
  <React.StrictMode>
    <StateProvider>
      <IpcProvider mini>
        <App />
      </IpcProvider>
    </StateProvider>
  </React.StrictMode>
);
