import React, { useContext } from 'react';
import {
  Container,
  Button,
  Accordion,
  Fade,
  AccordionSummary,
  CircularProgress,
  Typography,
  AccordionDetails,
  List,
  ListSubheader,
  ListItem,
  ListItemIcon,
  ListItemText,
  Box,
  Stack,
  Switch,
  Select,
  MenuItem,
  styled,
} from '@mui/material';
import { Icon } from '@iconify/react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PageToolbar from '../components/PageToolbar';
import foldersIcon from '@iconify/icons-fluent/folder-24-regular';
import windowPlayIcon from '@iconify/icons-fluent/window-play-20-regular';
import syncIcon from '@iconify/icons-fluent/arrow-sync-24-regular';
import addFolderIcon from '@iconify/icons-fluent/folder-add-24-regular';
import zoomIcon from '@iconify/icons-fluent/zoom-in-24-regular';
import { useIpc } from '../state/ipc';
import { store } from '../utils/store';
import { motion } from 'motion/react';
import {
  getOverlayEnabled,
  setOverlayEnabled,
  getArtistImageFetchingEnabled,
  setArtistImageFetchingEnabled,
  getWindowScale,
  setWindowScale,
} from '../utils/LocStoreUtil';
import { WINDOW_SCALE_OPTIONS } from '../../config/app_settings';

interface MusicFolder {
  Id: string | number;
  Uri: string;
}

const IOSSwitch = styled<any>(props => (
  <Switch focusVisibleClassName=".Mui-focusVisible" disableRipple {...props} />
))(({ theme }) => ({
  width: 50,
  height: 30,
  padding: 0,
  '& .MuiSwitch-switchBase': {
    padding: 0,
    margin: 2,
    transitionDuration: '300ms',
    '&.Mui-checked': {
      transform: 'translateX(20px)',
      color: '#fff',
      '& + .MuiSwitch-track': {
        backgroundColor: theme.palette.mode === 'dark' ? '#2ECA45' : '#65C466',
        opacity: 1,
        border: 0,
      },
      '&.Mui-disabled + .MuiSwitch-track': {
        opacity: 0.5,
      },
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': {
      color: '#33cf4d',
      border: '6px solid #fff',
    },
    '&.Mui-disabled .MuiSwitch-thumb': {
      color: theme.palette.mode === 'light' ? theme.palette.grey[100] : theme.palette.grey[600],
    },
    '&.Mui-disabled + .MuiSwitch-track': {
      opacity: theme.palette.mode === 'light' ? 0.7 : 0.3,
    },
  },
  '& .MuiSwitch-thumb': {
    boxSizing: 'border-box',
    width: 26,
    height: 26,
  },
  '& .MuiSwitch-track': {
    borderRadius: 15,
    backgroundColor: theme.palette.mode === 'light' ? '#E9E9EA' : '#39393D',
    opacity: 1,
    transition: theme.transitions.create(['background-color'], {
      duration: 500,
    }),
  },
}));

const Settings: React.FC = () => {
  const [expanded, setExpanded] = React.useState<boolean>(false);
  const [folders, setFolders] = React.useState<MusicFolder[]>([]);
  const [overlayEnabled, setOverlayEnabledState] = React.useState<boolean>(getOverlayEnabled);
  const [artistImageFetchEnabled, setArtistImageFetchEnabledState] = React.useState<boolean>(
    getArtistImageFetchingEnabled()
  );
  const [windowScale, setWindowScaleState] = React.useState<number>(getWindowScale());
  const { invokeEventToMainProcess } = useIpc();
  const { state, dispatch } = useContext(store);
  const { isScanningLibrary } = state;

  React.useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: false });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

  React.useEffect(() => {
    invokeEventToMainProcess('get-music-folders')
      .then((data: unknown) => setFolders(data as MusicFolder[]))
      .catch((err: unknown) => {
        console.error('Error fetching music folders:', err);
      });
  }, []);

  const handleExpansion = (): void => {
    setExpanded(prevExpanded => !prevExpanded);
  };

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <PageToolbar title="Settings" />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <Container maxWidth="xl">
          <List
            subheader={
              <ListSubheader
                color="inherit"
                sx={{
                  bgcolor: theme =>
                    theme.palette.mode === 'dark' ? '#323135' : theme.palette.background.paper,
                }}
              >
                Library
              </ListSubheader>
            }
          >
            <ListItem component={Stack} direction="row" spacing={2}>
              <Button
                startIcon={
                  isScanningLibrary ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Icon icon={syncIcon} height={'1.5rem'} />
                  )
                }
                variant="outlined"
                color="primary"
                fullWidth
                disabled={isScanningLibrary}
                onClick={() => {
                  invokeEventToMainProcess('scan-media', undefined)
                    .then((data: unknown) => {
                      console.log('Media scan completed:', data);
                      invokeEventToMainProcess('get-music-folders', undefined).then((d: unknown) =>
                        setFolders(d as MusicFolder[])
                      );
                    })
                    .catch((err: unknown) => {
                      console.error('Error rescanning media:', err);
                    });
                }}
              >
                {isScanningLibrary ? 'Scanning…' : 'Rescan Media'}
              </Button>
              <Button
                startIcon={
                  isScanningLibrary ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Icon icon={syncIcon} height={'1.5rem'} />
                  )
                }
                variant="outlined"
                color="warning"
                fullWidth
                disabled={isScanningLibrary}
                onClick={() => {
                  invokeEventToMainProcess('full-rescan', undefined)
                    .then((data: unknown) => {
                      console.log('Full rescan completed:', data);
                      invokeEventToMainProcess('get-music-folders', undefined).then((d: unknown) =>
                        setFolders(d as MusicFolder[])
                      );
                    })
                    .catch((err: unknown) => {
                      console.error('Error during full rescan:', err);
                    });
                }}
              >
                {isScanningLibrary ? 'Scanning…' : 'Full Rescan'}
              </Button>
            </ListItem>
            <ListItem disableGutters>
              <Accordion
                expanded={expanded}
                slots={{ transition: Fade }}
                slotProps={{ transition: { timeout: 400 } }}
                sx={{
                  '& .MuiAccordion-region': { height: expanded ? 'auto' : 0 },
                  '& .MuiAccordionDetails-root': { display: expanded ? 'block' : 'none' },
                  backgroundColor: 'background.default',
                  width: '100%',
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon onClick={handleExpansion} />}
                  aria-controls="panel1-content"
                  id="panel1-header"
                >
                  <Box
                    component={Stack}
                    onClick={handleExpansion}
                    alignItems={'center'}
                    direction={'row'}
                    width={'100%'}
                  >
                    {' '}
                    <ListItemIcon sx={{ mr: -2 }}>
                      <Icon icon={foldersIcon} height={'1.5rem'} />
                    </ListItemIcon>
                    <ListItemText primary="Music Folders" />
                  </Box>
                  <Button
                    startIcon={<Icon icon={addFolderIcon} height={'1.2rem'} />}
                    variant="contained"
                    disableElevation
                    size="small"
                    fullWidth
                    onClick={() =>
                      invokeEventToMainProcess('add-music-folder', undefined)
                        .then(() => {
                          invokeEventToMainProcess('get-music-folders', undefined).then(
                            (d: unknown) => setFolders(d as MusicFolder[])
                          );
                        })
                        .catch((err: unknown) => {
                          console.error('Error adding music folder:', err);
                        })
                    }
                    sx={{ mr: 2, maxWidth: 150 }}
                  >
                    Add Folder
                  </Button>
                </AccordionSummary>
                <AccordionDetails>
                  {folders.length === 0 ? (
                    <Typography>No items</Typography>
                  ) : (
                    <>
                      {folders.map(folder => (
                        <ListItem
                          key={folder.Id}
                          secondaryAction={
                            <Button
                              color="error"
                              variant="contained"
                              size="small"
                              disableElevation
                              onClick={() => {
                                invokeEventToMainProcess('remove-music-folder', {
                                  Id: folder.Id,
                                }).then(() =>
                                  invokeEventToMainProcess('get-music-folders', undefined).then(
                                    (d: unknown) => setFolders(d as MusicFolder[])
                                  )
                                );
                              }}
                            >
                              Remove
                            </Button>
                          }
                        >
                          <ListItemText primary={folder.Uri} />
                        </ListItem>
                      ))}
                    </>
                  )}
                </AccordionDetails>
              </Accordion>
            </ListItem>
          </List>
          <List
            subheader={
              <ListSubheader
                color="inherit"
                sx={{
                  bgcolor: theme =>
                    theme.palette.mode === 'dark' ? '#323135' : theme.palette.background.paper,
                }}
              >
                Display
              </ListSubheader>
            }
          >
            <ListItem>
              <ListItemIcon>
                <Icon icon={zoomIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                id="select-window-scale"
                primary="Window Scaling"
                secondary="Zoom factor applied to the entire app window"
              />
              <Select
                size="small"
                value={
                  WINDOW_SCALE_OPTIONS.includes(windowScale)
                    ? windowScale
                    : (WINDOW_SCALE_OPTIONS.find(o => Math.abs(o - windowScale) < 0.001) ?? 1)
                }
                onChange={e => {
                  const next = Number(e.target.value);
                  const applied = setWindowScale(next);
                  setWindowScaleState(applied);
                }}
                sx={{ minWidth: 110, mr: 0.5 }}
              >
                {WINDOW_SCALE_OPTIONS.map(opt => (
                  <MenuItem key={opt} value={opt}>
                    {Math.round(opt * 100)}%
                  </MenuItem>
                ))}
              </Select>
            </ListItem>
          </List>
          <List
            subheader={
              <ListSubheader
                color="inherit"
                sx={{
                  bgcolor: theme =>
                    theme.palette.mode === 'dark' ? '#323135' : theme.palette.background.paper,
                }}
              >
                Notifications
              </ListSubheader>
            }
          >
            <ListItem>
              <ListItemIcon>
                <Icon icon={windowPlayIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                id="switch-list-label-wifi"
                primary="Now Playing Overlay"
                secondary="Shows above other apps"
              />
              <IOSSwitch
                checked={overlayEnabled}
                onChange={e => {
                  setOverlayEnabledState(e.target.checked);
                  setOverlayEnabled(e.target.checked);
                }}
                sx={{
                  mr: 0.5,
                }}
              />
            </ListItem>
            <ListItem>
              <ListItemIcon>
                <Icon icon={windowPlayIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                id="switch-list-label-artist-images"
                primary="Fetch artist images"
                secondary="Automatically load artist profile images in lists"
              />
              <IOSSwitch
                checked={artistImageFetchEnabled}
                onChange={e => {
                  setArtistImageFetchEnabledState(e.target.checked);
                  setArtistImageFetchingEnabled(e.target.checked);
                }}
                sx={{
                  mr: 0.5,
                }}
              />
            </ListItem>
          </List>
          <List
            subheader={
              <ListSubheader
                color="inherit"
                sx={{
                  bgcolor: theme =>
                    theme.palette.mode === 'dark' ? '#323135' : theme.palette.background.paper,
                }}
              >
                Advanced Options
              </ListSubheader>
            }
          >
            <ListItem component={Stack} direction="row" spacing={2}>
              <Button
                // startIcon={
                //   isScanningLibrary ? (
                //     <CircularProgress size={16} color="inherit" />
                //   ) : (
                //     <Icon icon={syncIcon} height={'1.5rem'} />
                //   )
                // }
                variant="outlined"
                color="primary"
                fullWidth
                disabled={isScanningLibrary}
                onClick={() =>
                  invokeEventToMainProcess('open-dir', { variant: 'appdata' }).catch(
                    (err: unknown) => {
                      console.error('Error opening application data folder:', err);
                    }
                  )
                }
              >
                Open Application Data Folder
              </Button>
            </ListItem>
          </List>
        </Container>
      </Box>
    </motion.div>
  );
};

export default Settings;
