import React, { useContext, useEffect, useState } from 'react';
import Titlebar from './Titlebar';
import { alpha, Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import { Alert, IconButton, Paper, Snackbar, Stack, useMediaQuery } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2/Grid2';
import { useMatch, useOutlet } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import KeyboardArrowUpRounded from '@mui/icons-material/KeyboardArrowUpRounded';

import PlayBar from './PlayBar';
import MainDrawer from './MainDrawer';
import AppDrawer from './AppDrawer';
import { store } from '../utils/store';
import { PLAYBACK_ERROR_EVENT } from '../utils/LocStoreUtil';
import SearchDialog from './SearchDialog';

// In: the library fades under the deck. Out: it is already there beneath the
// deck lifting off, so nothing double-exposes.
const fade = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.35 },
};

function Layout() {
  const isPhone = useMediaQuery(({ breakpoints }: Theme) => breakpoints.down('md'));
  const { state, dispatch } = useContext(store);
  // PlayBar stays mounted (hidden) under the deck: it owns the audio element,
  // and remounting it would stop playback.
  const vinyl = !!useMatch('/main_window/vinyl');
  // The element rather than <Outlet/>, so a page fading out keeps showing
  // itself instead of re-rendering as the route it is leaving for.
  const outlet = useOutlet();

  // PlayBar unmounts with the track it is reporting on, so the snackbar lives here.
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => setPlaybackError((e as CustomEvent<string>).detail);
    window.addEventListener(PLAYBACK_ERROR_EVENT, handler);
    return () => window.removeEventListener(PLAYBACK_ERROR_EVENT, handler);
  }, []);

  useEffect(() => {
    if (isPhone) {
      dispatch({ type: 'SET_MENU_EXPANDED', payload: false });
    } else {
      dispatch({ type: 'SET_MENU_EXPANDED', payload: true });
    }
  }, [isPhone]);

  // Clipped so the deck's lift-off, scaled past the edges, never scrolls the window.
  return (
    <Box height={'100%'} position="relative" overflow="hidden">
      <Titlebar />
      <Box display={'flex'} height={'100%'}>
        <AnimatePresence initial={false}>
          {!vinyl && (
            <motion.div key="drawer" style={{ height: '100%', flex: 'none' }} {...fade}>
              <AppDrawer
                variant={isPhone ? 'temporary' : 'permanent'}
                sx={{
                  height: '100%',
                  '&::-webkit-scrollbar': { display: 'none' },
                  msOverflowStyle: 'none',
                }}
                PaperProps={{
                  style: {
                    paddingTop: '32px',
                    backgroundColor: 'transparent',
                    borderRight: 'none',
                  },
                }}
                ModalProps={{ keepMounted: false }}
                onClose={() => dispatch({ type: 'SET_MENU_EXPANDED', payload: false })}
                open={state.isMenuExpanded}
              >
                <MainDrawer />
              </AppDrawer>
            </motion.div>
          )}
        </AnimatePresence>
        <Stack
          sx={{
            height: '100%',
            width: '100%',
            flex: 1,
            position: 'relative',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <AnimatePresence initial={false}>
            {!vinyl && (
              <motion.div
                key="library"
                style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
                {...fade}
              >
                <Box height="32px">&nbsp;</Box>
                <Grid
                  component={Paper}
                  borderRadius={'0.5rem 0rem 0rem 0.5rem'}
                  sx={{
                    height: '100%',
                    flex: 1,
                    width: '100%',
                    maxWidth: '100%',
                    minWidth: 0,
                    p: 0,
                    m: 0,
                    borderTop: theme => `1px solid ${theme.palette.surfaces.glassBorder}`,
                    borderLeft: theme => `1px solid ${theme.palette.surfaces.glassBorder}`,
                    overflow: 'hidden',
                  }}
                  container
                >
                  <Grid
                    xs={12}
                    sx={{
                      height: '100%',
                      maxHeight: 'calc(100vh - 32px)',
                      borderTopLeftRadius: '0.5rem',
                      flex: 1,
                      width: '100%',
                      maxWidth: '100%',
                      minWidth: 0,
                      p: 0,
                      m: 0,
                    }}
                  >
                    {outlet}
                  </Grid>
                </Grid>
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div
            animate={{
              y: isPhone
                ? state.isPlayerBarVisible
                  ? -220
                  : 200
                : state.isPlayerBarVisible
                  ? -220
                  : 0,
            }}
            transition={{ type: isPhone ? 'tween' : 'spring' }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: isPhone ? -220 : -200,
              zIndex: 10,
              width: '100%',
              display: vinyl ? 'none' : 'flex',
              justifyContent: 'center',
              pointerEvents: 'auto',
            }}
          >
            <Box
              sx={{
                width: '100%',
                margin: 'auto',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <PlayBar />
            </Box>
          </motion.div>
          {/* Expand tab shown when track is loaded but playbar is hidden */}
          {state.track && !state.isPlayerBarVisible && !vinyl && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 11,
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'auto',
              }}
            >
              <IconButton
                size="small"
                onClick={() => dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true })}
                title="Show player bar"
                sx={{
                  backdropFilter: 'blur(20px)',
                  backgroundColor: theme => alpha(theme.palette.common.black, 0.25),
                  borderRadius: '8px 8px 0 0',
                  px: 4,
                  py: 0.25,
                  '&:hover': {
                    backgroundColor: theme => alpha(theme.palette.common.black, 0.45),
                  },
                }}
              >
                <KeyboardArrowUpRounded fontSize="small" />
              </IconButton>
            </Box>
          )}
        </Stack>
      </Box>
      {/* Above the drawer (1200) and under the fading title bar (1300). */}
      <AnimatePresence initial={false}>
        {vinyl && (
          <motion.div
            key="deck"
            style={{ position: 'absolute', inset: 0, zIndex: 1250 }}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { duration: 0.45, ease: [0.3, 0.7, 0.2, 1] },
            }}
            exit={{
              opacity: 0,
              scale: 1.015,
              transition: { duration: 0.4, ease: [0.4, 0, 0.6, 1] },
            }}
          >
            {outlet}
          </motion.div>
        )}
      </AnimatePresence>
      <SearchDialog />
      <Snackbar
        open={!!playbackError}
        autoHideDuration={6000}
        onClose={() => setPlaybackError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={() => setPlaybackError(null)}>
          {playbackError}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default Layout;
