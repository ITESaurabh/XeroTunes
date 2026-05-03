import React, { useContext } from 'react';
import List from '@mui/material/List';
import {
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Divider,
  useTheme,
  useMediaQuery,
  Box,
  LinearProgress,
  Typography,
  CircularProgress,
} from '@mui/material';
import SearchBar from './SearchBar';
import { Link, useMatch, useResolvedPath } from 'react-router';
import { IconifyIcon, Icon } from '@iconify/react';
import musicNoteIcon from '@iconify/icons-fluent/music-note-2-24-regular';
import musicNoteActiveIcon from '@iconify/icons-fluent/music-note-2-24-filled';
import FavIcon from '@iconify/icons-fluent/heart-24-regular';
import FavActiveIcon from '@iconify/icons-fluent/heart-24-filled';
import playlistIcon from '@iconify/icons-fluent/navigation-play-20-regular';
import playlistActiveIcon from '@iconify/icons-fluent/navigation-play-20-filled';
import albumIcon from '@iconify/icons-fluent/cd-16-regular';
import albumActiveIcon from '@iconify/icons-fluent/cd-16-filled';
import artistIcon from '@iconify/icons-fluent/mic-24-regular';
import artistActiveIcon from '@iconify/icons-fluent/mic-24-filled';
import albumArtistIcon from '@iconify/icons-fluent/book-open-microphone-24-regular';
import albumArtistActiveIcon from '@iconify/icons-fluent/book-open-microphone-24-filled';
import foldersIcon from '@iconify/icons-fluent/folder-24-regular';
import foldersActiveIcon from '@iconify/icons-fluent/folder-24-filled';
import foldersHierarchyIcon from '@iconify/icons-fluent/document-folder-24-regular';
import foldersHierarchyActiveIcon from '@iconify/icons-fluent/document-folder-24-filled';
import genresIcon from '@iconify/icons-fluent/guitar-24-regular';
import genresActiveIcon from '@iconify/icons-fluent/guitar-24-filled';
import yearsIcon from '@iconify/icons-fluent/timer-24-regular';
import yearsActiveIcon from '@iconify/icons-fluent/timer-24-filled';
import recentIcon from '@iconify/icons-fluent/add-circle-24-regular';
import recentActiveIcon from '@iconify/icons-fluent/add-circle-24-filled';
import settingsIcon from '@iconify/icons-fluent/settings-24-regular';
import settingsActiveIcon from '@iconify/icons-fluent/settings-24-filled';
import { store, LibraryStats } from '../utils/store';
import { Theme } from '@mui/material/styles';
import { AnimatePresence, motion } from 'motion/react';

interface MenuItem {
  title: string;
  href: string;
  icon: IconifyIcon | string;
  iconActive: IconifyIcon | string;
  divider?: boolean;
  statKey?: keyof LibraryStats;
}

interface MainDrawerProps {
  tempDrawer?: boolean;
}

interface CustomLinkProps {
  item: MenuItem;
  stat?: number;
  showStat?: boolean;
  [key: string]: unknown;
}

const menuItems: MenuItem[] = [
  {
    title: 'All Songs',
    href: '/main_window',
    icon: musicNoteIcon,
    iconActive: musicNoteActiveIcon,
    statKey: 'songs',
  },
  {
    title: 'Favourites',
    href: '/main_window/favourites',
    icon: FavIcon,
    iconActive: FavActiveIcon,
    statKey: 'favourites',
  },
  {
    title: 'Playlists',
    href: '/main_window/playlists',
    icon: playlistIcon,
    iconActive: playlistActiveIcon,
    statKey: 'playlists',
  },
  {
    title: 'Recently Added',
    href: '/main_window/recently-added',
    icon: recentIcon,
    iconActive: recentActiveIcon,
    divider: true,
    statKey: 'recentlyAdded',
  },
  {
    title: 'Albums',
    href: '/main_window/albums',
    icon: albumIcon,
    iconActive: albumActiveIcon,
    statKey: 'albums',
  },
  {
    title: 'Artists',
    href: '/main_window/artists',
    icon: artistIcon,
    iconActive: artistActiveIcon,
    statKey: 'artists',
  },
  {
    title: 'Album Artists',
    href: '/main_window/album-artists',
    icon: albumArtistIcon,
    iconActive: albumArtistActiveIcon,
    divider: true,
    statKey: 'albumArtists',
  },
  {
    title: 'Folders',
    href: '/main_window/folders',
    icon: foldersIcon,
    iconActive: foldersActiveIcon,
    statKey: 'folders',
  },
  {
    title: 'Folder Hierarchy',
    href: '/main_window/folder-hierarchy',
    icon: foldersHierarchyIcon,
    iconActive: foldersHierarchyActiveIcon,
    statKey: 'folders',
  },
  {
    title: 'Genres',
    href: '/main_window/genres',
    icon: genresIcon,
    iconActive: genresActiveIcon,
    statKey: 'genres',
  },
  {
    title: 'Years',
    href: '/main_window/years',
    icon: yearsIcon,
    iconActive: yearsActiveIcon,
    statKey: 'years',
  },
];

function MainDrawer({ tempDrawer }: MainDrawerProps) {
  const { state, dispatch } = useContext(store);
  const { isScanningLibrary, scanProgress, libraryStats, isMenuExpanded } = state;
  const theme = useTheme();

  const toggleDrawer = () => {
    dispatch({ type: 'SET_MENU_EXPANDED', payload: !state.isMenuExpanded });
  };

  return (
    <>
      <List
        sx={{
          width: '100%',
          position: 'relative',
          overflow: 'auto',
          p: 1,
          '& ul': { padding: 0 },
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none',
        }}
        subheader={<li />}
      >
        <ListSubheader
          disableGutters
          sx={{
            borderRadius: 100,
            backgroundColor:
              theme.palette.mode === 'dark' ? '#201e23' : theme.palette.background.paper,
          }}
        >
          <SearchBar
            open={state.isMenuExpanded}
            tempDrawer={tempDrawer}
            toggleDrawer={toggleDrawer}
          />
        </ListSubheader>
        {menuItems.map((item, index) => (
          <CustomLink
            key={index}
            item={item}
            stat={item.statKey && libraryStats ? libraryStats[item.statKey] : undefined}
            showStat={isMenuExpanded}
          />
        ))}
      </List>
      <List sx={{ mt: 'auto', p: 1 }}>
        {/* Scan progress banner */}
        <AnimatePresence>
          {isScanningLibrary && (
            <motion.div
              key="scan-banner"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Box
                sx={{
                  px: 2,
                  py: 0.5,
                  mb: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  alignContent: 'center',
                  gap: 1.5,
                  borderRadius: 2,
                  bgcolor: 'action.hover',
                  borderColor: 'divider',
                  ...(!state.isMenuExpanded && {
                    px: 0,
                    py: 0,
                    height: 40,
                  }),
                }}
              >
                {state.isMenuExpanded ? (
                  <Box sx={{ flex: 1 }}>
                    <LinearProgress
                      variant={
                        scanProgress && scanProgress.total > 0 ? 'determinate' : 'indeterminate'
                      }
                      value={
                        scanProgress && scanProgress.total > 0
                          ? Math.round((scanProgress.processed / scanProgress.total) * 100)
                          : undefined
                      }
                      sx={{ borderRadius: 2, height: 4 }}
                    />
                  </Box>
                ) : (
                  <Box
                    sx={{
                      flex: 1,
                      alignItems: 'center',
                      display: 'flex',
                      justifyContent: 'center',
                    }}
                  >
                    <CircularProgress
                      variant={
                        scanProgress && scanProgress.total > 0 ? 'determinate' : 'indeterminate'
                      }
                      value={
                        scanProgress && scanProgress.total > 0
                          ? Math.round((scanProgress.processed / scanProgress.total) * 100)
                          : undefined
                      }
                      size={20}
                      // sx={{ borderRadius: 2, height: 4 }}
                    />
                  </Box>
                )}
                <Typography
                  variant="caption"
                  sx={{
                    whiteSpace: 'nowrap',
                    opacity: 0.7,
                    display: state.isMenuExpanded ? 'block' : 'none',
                  }}
                >
                  {scanProgress && scanProgress.total > 0
                    ? `Scanning library… ${scanProgress.processed} / ${scanProgress.total}`
                    : 'Scanning library…'}
                </Typography>
              </Box>
            </motion.div>
          )}
        </AnimatePresence>
        <CustomLink
          item={{
            title: 'Settings',
            href: '/main_window/settings',
            icon: settingsIcon,
            iconActive: settingsActiveIcon,
          }}
        />
      </List>
    </>
  );
}

function CustomLink({ item, stat, showStat, ...props }: CustomLinkProps) {
  const resolved = useResolvedPath(item.href);
  const isPhone = useMediaQuery(({ breakpoints }: Theme) => breakpoints.down('md'));
  const { dispatch } = useContext(store);
  const match = useMatch({ path: resolved.pathname, end: true });

  return (
    <>
      <ListItemButton
        component={Link}
        sx={{ borderRadius: 15, mb: 1 }}
        selected={!!match}
        onClick={
          isPhone ? () => dispatch({ type: 'SET_MENU_EXPANDED', payload: false }) : undefined
        }
        to={item.href}
        {...(props as object)}
      >
        <ListItemIcon sx={{ mr: -1 }}>
          <Icon icon={match ? item.iconActive : item.icon} height={'1.5rem'} />
        </ListItemIcon>
        <ListItemText primary={item.title} />
        {showStat && stat !== undefined && stat > 0 && (
          <Typography
            variant="caption"
            sx={{
              ml: 1,
              px: 1,
              py: 0.25,
              borderRadius: 10,
              bgcolor: match ? 'action.selected' : 'action.hover',
              color: 'text.secondary',
              fontWeight: 600,
              minWidth: 24,
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            {stat}
          </Typography>
        )}
      </ListItemButton>
      {item.divider && <Divider sx={{ mb: 1 }} />}
    </>
  );
}

export default MainDrawer;
