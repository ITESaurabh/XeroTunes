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
  Chip,
  Tooltip,
  TextField,
  Divider,
  useTheme,
} from '@mui/material';
import { Icon } from '@iconify/react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PageToolbar from '../components/PageToolbar';
import foldersIcon from '@iconify/icons-fluent/folder-24-regular';
import windowPlayIcon from '@iconify/icons-fluent/window-play-20-regular';
import headphonesIcon from '@iconify/icons-fluent/headphones-20-regular';
import syncIcon from '@iconify/icons-fluent/arrow-sync-24-regular';
import addFolderIcon from '@iconify/icons-fluent/folder-add-24-regular';
import zoomIcon from '@iconify/icons-fluent/zoom-in-24-regular';
import checkmarkCircleIcon from '@iconify/icons-fluent/checkmark-circle-16-filled';
import windowHeaderIcon from '@iconify/icons-fluent/window-header-vertical-20-regular';
import minimizeIcon from '@iconify/icons-fluent/minimize-16-regular';
import maximizeIcon from '@iconify/icons-fluent/maximize-16-regular';
import closeIcon from '@iconify/icons-fluent/dismiss-16-regular';
import chevronDownIcon from '@iconify/icons-fluent/chevron-down-16-regular';
import chevronUpIcon from '@iconify/icons-fluent/chevron-up-16-regular';
import artistIcon from '@iconify/icons-fluent/mic-24-regular';
import darkThemeIcon from '@iconify/icons-fluent/dark-theme-24-regular';
import addIcon from '@iconify/icons-fluent/add-24-regular';
import GnomeCloseIcon from 'svg-react-loader?name=GnomeCloseIcon!../../assets/icons/gnome-close.svg';
import GnomeMinimizeIcon from 'svg-react-loader?name=GnomeMinimizeIcon!../../assets/icons/gnome-minimize.svg';
import GnomeResizeIcon from 'svg-react-loader?name=GnomeResizeIcon!../../assets/icons/gnome-resize.svg';
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
  getTitleBarStyle,
  getPauseOnAudioOutputChange,
  setPauseOnAudioOutputChange,
  getMultiArtistSeparators,
  setMultiArtistSeparators,
  getMultiArtistExceptions,
  setMultiArtistExceptions,
  getThemeMode,
} from '../utils/LocStoreUtil';
import { WINDOW_SCALE_OPTIONS, TitleBarStyle, ThemeMode } from '../../config/app_settings';
import { useConfirm, ConfirmOptions } from '../utils/useConfirm';
import { OS_MAC } from '../../config/constants';
import os from 'os';

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

interface TitlebarStyleOption {
  value: TitleBarStyle;
  label: string;
  description: string;
  macOnly?: boolean;
}

const TITLEBAR_STYLE_OPTIONS: TitlebarStyleOption[] = [
  {
    value: 'default',
    label: 'System Default',
    description: 'Automatically picks style based on OS',
  },
  {
    value: 'mac',
    label: 'macOS',
    description: 'Native macOS traffic lights',
    macOnly: true,
  },
  {
    value: 'mac-fake',
    label: 'macOS (fake)',
    description: 'macOS-style traffic lights on any OS',
  },
  {
    value: 'windows',
    label: 'Windows',
    description: 'Windows-style minimize / maximize / close',
  },
  {
    value: 'linux-gnome',
    label: 'GNOME',
    description: 'GNOME Adwaita style window controls',
  },
  {
    value: 'linux-kde',
    label: 'KDE Plasma',
    description: 'KDE Breeze style window controls',
  },
];

interface TitlebarPreviewProps {
  style: TitleBarStyle;
  isDark: boolean;
}

const TitlebarPreview: React.FC<TitlebarPreviewProps> = ({ style, isDark }) => {
  const bg = isDark ? '#201e23' : '#f4f1f9';
  const iconColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)';

  const circleSx = (bgColor: string, hoverFilter: string, size = 12) => ({
    borderRadius: '50%',
    width: size,
    height: size,
    bgcolor: bgColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'filter 0.1s',
    cursor: 'default',
    '&:hover': { filter: hoverFilter },
  });

  const flatBtnSx = (hoverBg: string) => ({
    width: 30,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    cursor: 'default',
    transition: 'background-color 0.1s ease-in-out',
    '&:hover': { bgcolor: hoverBg },
  });

  switch (style) {
    case 'mac':
    case 'mac-fake':
      return (
        <Box
          sx={{
            height: 28,
            bgcolor: bg,
            display: 'flex',
            alignItems: 'center',
            pl: '10px',
            gap: '5px',
          }}
        >
          <Box sx={circleSx('#ff5f56', 'brightness(0.85)')}>
            <Icon icon={closeIcon} height={7} color="rgba(0,0,0,0.4)" />
          </Box>
          <Box sx={circleSx('#ffbd2e', 'brightness(0.85)')}>
            <Icon icon={minimizeIcon} height={7} color="rgba(0,0,0,0.4)" />
          </Box>
          <Box sx={circleSx('#27c93f', 'brightness(0.85)')} />
        </Box>
      );

    case 'windows':
      return (
        <Box sx={{ height: 28, bgcolor: bg, display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flex: 1 }} />
          <Box sx={flatBtnSx(isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')}>
            <Icon icon={minimizeIcon} height={10} color={iconColor} />
          </Box>
          <Box sx={flatBtnSx(isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')}>
            <Icon icon={maximizeIcon} height={10} color={iconColor} />
          </Box>
          <Box sx={flatBtnSx('error.main')}>
            <Icon icon={closeIcon} height={10} color={iconColor} />
          </Box>
        </Box>
      );

    case 'linux-gnome':
      return (
        <Box
          sx={{
            height: 28,
            bgcolor: bg,
            display: 'flex',
            alignItems: 'center',
            pl: '10px',
            gap: '5px',
          }}
        >
          <Box sx={{ flex: 1 }} />
          <Box sx={circleSx('#38383C', 'brightness(1.4)', 13)}>
            <GnomeMinimizeIcon
              width={15}
              height={10}
              viewBox="0 0 16 16"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </Box>
          <Box sx={circleSx('#38383C', 'brightness(1.4)', 13)}>
            <GnomeResizeIcon
              width={8}
              height={8}
              viewBox="0 0 16 16"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </Box>
          <Box sx={circleSx('#38383C', 'brightness(1.25)', 13)} mr={1}>
            <GnomeCloseIcon
              width={12}
              height={10}
              viewBox="0 0 15 16"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </Box>
        </Box>
      );

    case 'linux-kde':
      return (
        <Box sx={{ height: 28, bgcolor: bg, display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', pr: '8px' }}>
            {([chevronDownIcon, chevronUpIcon, closeIcon] as const).map((icon, i) => (
              <Box
                key={i}
                sx={{
                  width: 22,
                  height: 16,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  cursor: 'default',
                  transition: 'background-color 0.1s ease-in-out',
                  '&:hover':
                    i === 2
                      ? { bgcolor: 'error.main' }
                      : { bgcolor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' },
                }}
              >
                <Icon icon={icon} height={9} color={iconColor} />
              </Box>
            ))}
          </Box>
        </Box>
      );

    case 'default':
    default:
      return (
        <Box sx={{ height: 28, bgcolor: bg, display: 'flex', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', pl: '8px', gap: '4px', opacity: 0.4 }}>
            {(['#ff5f56', '#ffbd2e', '#27c93f'] as const).map((c, i) => (
              <Box key={i} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c }} />
            ))}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', opacity: 0.4 }}>
            {([minimizeIcon, maximizeIcon] as const).map((icon, i) => (
              <Box
                key={i}
                sx={{
                  width: 26,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon icon={icon} height={9} color={iconColor} />
              </Box>
            ))}
            <Box
              sx={{
                width: 26,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'rgba(196,43,28,0.55)',
              }}
            >
              <Icon icon={closeIcon} height={9} color="white" />
            </Box>
          </Box>
        </Box>
      );
  }
};

interface TitlebarStyleCardProps {
  option: TitlebarStyleOption;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  isDark: boolean;
}

const TitlebarStyleCard: React.FC<TitlebarStyleCardProps> = ({
  option,
  selected,
  disabled,
  onClick,
  isDark,
}) => {
  const card = (
    <Box
      onClick={disabled ? undefined : onClick}
      sx={{
        borderRadius: 1,
        border: '2px solid',
        borderColor: selected
          ? 'primary.main'
          : isDark
            ? 'rgba(255,255,255,0.08)'
            : 'rgba(0,0,0,0.1)',
        overflow: 'hidden',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.38 : 1,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        userSelect: 'none',
        '&:hover': disabled
          ? {}
          : {
              borderColor: selected ? 'primary.main' : 'primary.light',
              boxShadow: theme => `0 0 0 1px ${theme.palette.primary.light}22`,
            },
      }}
    >
      {/* Titlebar preview */}
      <Box sx={{ height: 28, overflow: 'hidden' }}>
        <TitlebarPreview style={option.value} isDark={isDark} />
      </Box>

      {/* Fake window content area */}
      <Box
        sx={{
          height: 18,
          bgcolor: isDark ? '#2a2730' : '#f0ecf7',
          display: 'flex',
          alignItems: 'center',
          px: 1,
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            flex: 1,
            height: 3,
            borderRadius: 1,
            bgcolor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)',
          }}
        />
        <Box
          sx={{
            width: '30%',
            height: 3,
            borderRadius: 1,
            bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
          }}
        />
      </Box>

      {/* Label row */}
      <Box
        sx={{
          px: 1,
          pt: 0.75,
          pb: 0.75,
          bgcolor: 'background.paper',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="caption" fontWeight={selected ? 600 : 400} fontSize="0.7rem" noWrap>
          {option.label}
        </Typography>
        {option.macOnly && (
          <Chip
            label="macOS"
            size="small"
            color="secondary"
            variant="outlined"
            sx={{
              height: 14,
              fontSize: '0.55rem',
              '& .MuiChip-label': { px: 0.6, py: 0 },
            }}
          />
        )}
      </Box>

      {/* Selected checkmark */}
      {selected && (
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            color: 'primary.main',
            lineHeight: 0,
          }}
        >
          <Icon icon={checkmarkCircleIcon} height={16} />
        </Box>
      )}
    </Box>
  );

  if (disabled) {
    return (
      <Tooltip title="Only available on macOS" placement="top" arrow>
        <span style={{ display: 'block' }}>{card}</span>
      </Tooltip>
    );
  }

  return card;
};

interface ChipListEditorProps {
  values: string[];
  onChange: (_next: string[]) => void;
  placeholder: string;
  ariaLabel: string;
  /**
   * When provided, removing a chip first asks for confirmation using the
   * returned options (native dialog). Return value built per-item so the
   * message can name the value being removed.
   */
  removeConfirm?: (_value: string) => ConfirmOptions;
}

const ChipListEditor: React.FC<ChipListEditorProps> = ({
  values,
  onChange,
  placeholder,
  ariaLabel,
  removeConfirm,
}) => {
  const [input, setInput] = React.useState('');
  const confirm = useConfirm();

  const addValue = (): void => {
    const value = input.trim();
    if (!value) return;
    // De-dupe case-insensitively to match how the scanner compares names.
    if (!values.some(existing => existing.toLowerCase() === value.toLowerCase())) {
      onChange([...values, value]);
    }
    setInput('');
  };

  const removeValue = async (target: string): Promise<void> => {
    if (removeConfirm && !(await confirm(removeConfirm(target)))) return;
    onChange(values.filter(v => v !== target));
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
        {values.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            None
          </Typography>
        ) : (
          values.map(v => (
            <Chip key={v} label={v} onDelete={() => void removeValue(v)} size="small" />
          ))
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
          inputProps={{ 'aria-label': ariaLabel }}
          sx={{ flex: 1, maxWidth: 420 }}
        />
        <Button
          onClick={addValue}
          variant="outlined"
          size="small"
          startIcon={<Icon icon={addIcon} height="1rem" />}
          disabled={!input.trim()}
        >
          Add
        </Button>
      </Box>
    </Box>
  );
};

const Settings: React.FC = () => {
  const [expanded, setExpanded] = React.useState<boolean>(false);
  const [folders, setFolders] = React.useState<MusicFolder[]>([]);
  const [overlayEnabled, setOverlayEnabledState] = React.useState<boolean>(getOverlayEnabled);
  const [artistImageFetchEnabled, setArtistImageFetchEnabledState] = React.useState<boolean>(
    getArtistImageFetchingEnabled()
  );
  const [pauseOnOutputChange, setPauseOnOutputChangeState] = React.useState<boolean>(
    getPauseOnAudioOutputChange()
  );
  const [windowScale, setWindowScaleState] = React.useState<number>(getWindowScale());
  const [titleBarStyle, setTitleBarStyleState] = React.useState<TitleBarStyle>(getTitleBarStyle());
  const [themeMode, setThemeModeState] = React.useState<ThemeMode>(getThemeMode());
  const [artistSeparators, setArtistSeparatorsState] =
    React.useState<string[]>(getMultiArtistSeparators);
  const [artistExceptions, setArtistExceptionsState] =
    React.useState<string[]>(getMultiArtistExceptions);
  const { invokeEventToMainProcess } = useIpc();
  const confirm = useConfirm();
  const { state, dispatch } = useContext(store);
  const { isScanningLibrary, isFullScan } = state;
  const basicScanning = isScanningLibrary && !isFullScan;
  const fullScanning = isScanningLibrary && isFullScan;
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const currOs = os.type();

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

  const handleThemeModeChange = (mode: ThemeMode): void => {
    setThemeModeState(mode);
    // Dispatch applies the theme live and persists it via the reducer.
    dispatch({ type: 'SET_THEME_MODE', payload: mode });
  };

  const handleSeparatorsChange = (next: string[]): void => {
    setArtistSeparatorsState(next);
    setMultiArtistSeparators(next);
  };

  const handleExceptionsChange = (next: string[]): void => {
    setArtistExceptionsState(next);
    setMultiArtistExceptions(next);
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
                  basicScanning ? (
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
                {basicScanning ? 'Scanning…' : 'Rescan Media'}
              </Button>
              <Button
                startIcon={
                  fullScanning ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Icon icon={syncIcon} height={'1.5rem'} />
                  )
                }
                variant="outlined"
                color="warning"
                fullWidth
                disabled={isScanningLibrary}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Full rescan the library?',
                    message: 'This rebuilds the entire library from scratch.',
                    detail:
                      "All track's metadata and album thumbnails will be rebuilt, and the “Recently Added” list will be reset. This can take a while for large libraries.",
                    confirmLabel: 'Yes, Just do it!',
                    destructive: true,
                  });
                  if (!ok) return;
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
                {fullScanning ? 'Scanning…' : 'Full Rescan'}
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
                              onClick={async () => {
                                const ok = await confirm({
                                  title: 'Remove music folder?',
                                  message: `Remove "${folder.Uri}" from your library?`,
                                  detail:
                                    'Its tracks will be removed from the library on the next scan. Files on disk are not deleted.',
                                  confirmLabel: 'Remove',
                                  destructive: true,
                                });
                                if (!ok) return;
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

            <ListItem sx={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, width: '100%' }}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Icon icon={artistIcon} width="1.5rem" />
                </ListItemIcon>
                <ListItemText
                  primary="Artist Name Handling"
                  secondary="Control how multi-artist tags are split into separate artists. Changes apply on the next rescan."
                  secondaryTypographyProps={{ fontSize: '0.75rem' }}
                />
              </Box>

              <Box sx={{ pl: { xs: 0, sm: 6 }, width: '100%' }}>
                <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
                  Separators
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1 }}
                >
                  Characters used to split a tag into multiple artists (e.g. &quot;,&quot; and
                  &quot;&amp;&quot;).
                </Typography>
                <ChipListEditor
                  values={artistSeparators}
                  onChange={handleSeparatorsChange}
                  placeholder="Add a separator, e.g. ;"
                  ariaLabel="Add multi-artist separator"
                  removeConfirm={value => ({
                    title: 'Remove separator?',
                    message: `Remove "${value}" from the multi-artist separators?`,
                    detail:
                      'Artist tags will no longer be split on this character after the next rescan.',
                    confirmLabel: 'Remove',
                    destructive: true,
                  })}
                />

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
                  Exceptions
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1 }}
                >
                  Names kept intact even when they contain a separator (e.g. &quot;AC/DC&quot;,
                  &quot;Eminem &amp; Linkin Park&quot;).
                </Typography>
                <ChipListEditor
                  values={artistExceptions}
                  onChange={handleExceptionsChange}
                  placeholder="Add an exception, e.g. Eminem & Linkin Park"
                  ariaLabel="Add multi-artist exception"
                  removeConfirm={value => ({
                    title: 'Remove exception?',
                    message: `Remove "${value}" from the artist name exceptions?`,
                    detail:
                      'Multi-artist tags matching this name will be split again on the next rescan.',
                    confirmLabel: 'Remove',
                    destructive: true,
                  })}
                />
              </Box>
            </ListItem>
          </List>

          {/* ── Appearance ── */}
          <List
            subheader={
              <ListSubheader
                color="inherit"
                sx={{
                  bgcolor: theme =>
                    theme.palette.mode === 'dark' ? '#323135' : theme.palette.background.paper,
                }}
              >
                Appearance
              </ListSubheader>
            }
          >
            <ListItem>
              <ListItemIcon>
                <Icon icon={darkThemeIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                id="select-theme-mode"
                primary="Theme"
                secondary="Choose light, dark, or follow the system"
              />
              <Select
                size="small"
                value={themeMode}
                onChange={e => handleThemeModeChange(Number(e.target.value) as ThemeMode)}
                sx={{ minWidth: 130, mr: 0.5 }}
              >
                <MenuItem value={0}>System</MenuItem>
                <MenuItem value={1}>Light</MenuItem>
                <MenuItem value={2}>Dark</MenuItem>
              </Select>
            </ListItem>
            <ListItem sx={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, width: '100%' }}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Icon icon={windowHeaderIcon} width="1.5rem" />
                </ListItemIcon>
                <ListItemText
                  primary="Title Bar Style"
                  secondary="Choose how the window controls are displayed"
                  secondaryTypographyProps={{ fontSize: '0.75rem' }}
                />
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: 1.5,
                  width: '100%',
                }}
              >
                {TITLEBAR_STYLE_OPTIONS.map(option => {
                  const isDisabled = !!option.macOnly && currOs !== OS_MAC;
                  return (
                    <TitlebarStyleCard
                      key={option.value}
                      option={option}
                      selected={titleBarStyle === option.value}
                      disabled={isDisabled}
                      isDark={isDark}
                      onClick={() => {
                        setTitleBarStyleState(option.value);
                        dispatch({ type: 'SET_TITLEBAR_STYLE', payload: option.value });
                      }}
                    />
                  );
                })}
              </Box>

              {titleBarStyle !== 'default' && titleBarStyle !== state.titleBarStyle && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                  Applied - changes take effect immediately.
                </Typography>
              )}
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
                Playback
              </ListSubheader>
            }
          >
            <ListItem>
              <ListItemIcon>
                <Icon icon={headphonesIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                id="switch-list-label-pause-on-output-change"
                primary="Pause on audio output change"
                secondary="Automatically pause when headphones are unplugged or a Bluetooth device disconnects"
              />
              <IOSSwitch
                checked={pauseOnOutputChange}
                onChange={e => {
                  setPauseOnOutputChangeState(e.target.checked);
                  setPauseOnAudioOutputChange(e.target.checked);
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
