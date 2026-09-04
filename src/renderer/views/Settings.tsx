import React, { useContext } from 'react';
import type { Theme } from '@mui/material/styles';
import {
  alpha,
  Alert,
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
  Card,
} from '@mui/material';
import { Icon } from '@iconify/react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PageToolbar from '../components/PageToolbar';
import MusicSourcesSection from '../components/MusicSourcesSection';
import SyncProgressPanel from '../components/SyncProgressPanel';
import windowPlayIcon from '@iconify/icons-fluent/window-play-20-regular';
import headphonesIcon from '@iconify/icons-fluent/headphones-20-regular';
import speakerIcon from '@iconify/icons-fluent/speaker-2-24-regular';
import syncIcon from '@iconify/icons-fluent/arrow-sync-24-regular';
import zoomIcon from '@iconify/icons-fluent/zoom-in-24-regular';
import streamIcon from '@iconify/icons-fluent/live-24-regular';
import checkmarkCircleIcon from '@iconify/icons-fluent/checkmark-circle-16-filled';
import windowHeaderIcon from '@iconify/icons-fluent/window-header-vertical-20-regular';
import minimizeIcon from '@iconify/icons-fluent/minimize-16-regular';
import maximizeIcon from '@iconify/icons-fluent/maximize-16-regular';
import closeIcon from '@iconify/icons-fluent/dismiss-16-regular';
import chevronDownIcon from '@iconify/icons-fluent/chevron-down-16-regular';
import chevronUpIcon from '@iconify/icons-fluent/chevron-up-16-regular';
import artistIcon from '@iconify/icons-fluent/mic-24-regular';
import scrobbleIcon from '@iconify/icons-fluent/cloud-sync-24-regular';
import duplicateIcon from '@iconify/icons-fluent/document-copy-24-regular';
import warningIcon from '@iconify/icons-fluent/warning-24-regular';
import darkThemeIcon from '@iconify/icons-fluent/dark-theme-24-regular';
import colorIcon from '@iconify/icons-fluent/color-24-regular';
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
  WINDOW_SCALE_EVENT,
  getArtistImageFetchingEnabled,
  getStreamHistoryDays,
  setStreamHistoryDays,
  setArtistImageFetchingEnabled,
  getWindowScale,
  setWindowScale,
  getTitleBarStyle,
  getPauseOnAudioOutputChange,
  setPauseOnAudioOutputChange,
  getPerDeviceVolumeEnabled,
  setPerDeviceVolumeEnabled,
  getAudioOutputDeviceId,
  setAudioOutputDeviceId,
  getMultiArtistSeparators,
  setMultiArtistSeparators,
  getMultiArtistExceptions,
  setMultiArtistExceptions,
  getThemeMode,
  getAllThemes,
  saveCustomTheme,
  deleteCustomTheme,
  uniqueThemeName,
} from '../utils/LocStoreUtil';
import {
  STREAM_HISTORY_DAY_OPTIONS,
  WINDOW_SCALE_OPTIONS,
  TitleBarStyle,
  ThemeMode,
} from '../../config/app_settings';
import { AMETHYST, AppTheme, parseTheme } from '../../config/theme';
import ThemeEditorDialog from '../components/ThemeEditorDialog';
import FactoryResetDialog from '../components/FactoryResetDialog';
import DuplicateTracksDialog from '../components/DuplicateTracksDialog';
import XeroLogoMark from '../components/XeroLogoMark';
import { gnomeCircleBgFor, gnomeIconFilterFor } from '../components/Titlebar';
import { useConfirm, ConfirmOptions } from '../utils/useConfirm';
import { APP_DISPLAY_NAME, OS_MAC, SITE_URL } from '../../config/constants';
import type {
  ScrobblerStatus,
  ScrobbleProvider,
  ProviderStatus,
} from '../../main/modules/Scrobbler';
import os from 'os';

interface AppInfo {
  name: string;
  version: string;
  channel: string;
  license: string;
  repo: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  dataDir: string;
}

/**
 * A sticky section header only has to hide the rows scrolling under it. Dark's raised
 * surface does that and reads as a band; light's is white, which on the near-white page
 * shows up as a mismatched strip instead, so light sits flush.
 */
const subheaderSx = {
  bgcolor: (theme: Theme) =>
    theme.palette.mode === 'dark'
      ? theme.palette.surfaces.elevated
      : theme.palette.background.paper,
};

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
      color: theme.palette.common.white,
      '& + .MuiSwitch-track': {
        backgroundColor: theme.palette.surfaces.positive,
        opacity: 1,
        border: 0,
      },
      '&.Mui-disabled + .MuiSwitch-track': {
        opacity: 0.5,
      },
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': {
      color: theme.palette.surfaces.positive,
      border: `6px solid ${theme.palette.common.white}`,
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
    backgroundColor: theme.palette.surfaces.trackOff,
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
}

const TitlebarPreview: React.FC<TitlebarPreviewProps> = ({ style }) => {
  const theme = useTheme();
  const bg = theme.palette.background.default;
  const iconColor = theme.palette.text.secondary;

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
    '&:hover': { filter: hoverFilter },
  });

  const flatBtnSx = (hoverBg: string) => ({
    width: 30,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
          <Box sx={flatBtnSx(alpha(theme.palette.text.primary, 0.05))}>
            <Icon icon={minimizeIcon} height={10} color={iconColor} />
          </Box>
          <Box sx={flatBtnSx(alpha(theme.palette.text.primary, 0.05))}>
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
          <Box sx={circleSx(gnomeCircleBgFor(theme), 'brightness(1.4)', 13)}>
            <GnomeMinimizeIcon
              width={15}
              height={10}
              viewBox="0 0 16 16"
              style={{ filter: gnomeIconFilterFor(theme) }}
            />
          </Box>
          <Box sx={circleSx(gnomeCircleBgFor(theme), 'brightness(1.4)', 13)}>
            <GnomeResizeIcon
              width={8}
              height={8}
              viewBox="0 0 16 16"
              style={{ filter: gnomeIconFilterFor(theme) }}
            />
          </Box>
          <Box sx={circleSx(gnomeCircleBgFor(theme), 'brightness(1.25)', 13)} mr={1}>
            <GnomeCloseIcon
              width={12}
              height={10}
              viewBox="0 0 15 16"
              style={{ filter: gnomeIconFilterFor(theme) }}
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
                  transition: 'background-color 0.1s ease-in-out',
                  '&:hover':
                    i === 2
                      ? { bgcolor: 'error.main' }
                      : { bgcolor: theme => alpha(theme.palette.text.primary, 0.12) },
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
                bgcolor: theme => alpha(theme.palette.error.main, 0.55),
              }}
            >
              <Icon icon={closeIcon} height={9} color={theme.palette.error.contrastText} />
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
}

const TitlebarStyleCard: React.FC<TitlebarStyleCardProps> = ({
  option,
  selected,
  disabled,
  onClick,
}) => {
  const card = (
    <Box
      onClick={disabled ? undefined : onClick}
      sx={{
        borderRadius: 1,
        border: '2px solid',
        borderColor: selected ? 'primary.main' : theme => alpha(theme.palette.text.primary, 0.08),
        overflow: 'hidden',
        cursor: disabled ? 'not-allowed' : 'default',
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
        <TitlebarPreview style={option.value} />
      </Box>

      {/* Fake window content area */}
      <Box
        sx={{
          height: 18,
          bgcolor: 'surfaces.elevated',
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
            bgcolor: theme => alpha(theme.palette.text.primary, 0.07),
          }}
        />
        <Box
          sx={{
            width: '30%',
            height: 3,
            borderRadius: 1,
            bgcolor: theme => alpha(theme.palette.text.primary, 0.04),
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

const SCROBBLER_BLURBS: Record<ScrobbleProvider, string> = {
  lastfm: 'Send plays to your Last.fm profile',
  librefm: 'The free, open Last.fm alternative',
  listenbrainz: 'Paste the user token from listenbrainz.org/settings',
  gnufm: 'Any self-hosted GNU FM instance',
  'listenbrainz-custom': 'Your own ListenBrainz server',
};

interface ScrobblerRowProps {
  status: ProviderStatus;
  busy: boolean;
  awaitingApproval: boolean;
  actionError: string | null;
  onToggle: (enabled: boolean) => void;
  onDisconnect: () => void;
  onStartWebAuth: (baseUrl: string) => void;
  onFinishWebAuth: () => void;
  onConnectToken: (token: string, baseUrl: string) => void;
}

const ScrobblerRow: React.FC<ScrobblerRowProps> = ({
  status,
  busy,
  awaitingApproval,
  actionError,
  onToggle,
  onDisconnect,
  onStartWebAuth,
  onFinishWebAuth,
  onConnectToken,
}) => {
  const [baseUrl, setBaseUrl] = React.useState(status.baseUrl ?? '');
  const [token, setToken] = React.useState('');
  const tokenAuth = status.protocol === 'listenbrainz';

  const secondary = !status.configured
    ? 'This build ships without Last.fm API credentials'
    : status.connected
      ? `Connected as ${status.username ?? 'your account'}${
          status.pending ? ` - ${status.pending} waiting to send` : ''
        }`
      : awaitingApproval
        ? `Approve ${APP_DISPLAY_NAME} in your browser, then finish here`
        : SCROBBLER_BLURBS[status.provider];

  const connectDisabled =
    busy ||
    !status.configured ||
    (status.selfHosted && !baseUrl.trim()) ||
    (tokenAuth && !token.trim());

  return (
    <ListItem sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <ListItemIcon>
        <Icon icon={scrobbleIcon} width={'2rem'} />
      </ListItemIcon>
      <ListItemText primary={status.label} secondary={secondary} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: 'auto', mr: 0.5 }}>
        {status.connected ? (
          <>
            <IOSSwitch
              checked={status.enabled}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onToggle(e.target.checked)}
            />
            <Button size="small" variant="outlined" disabled={busy} onClick={onDisconnect}>
              Disconnect
            </Button>
          </>
        ) : (
          <>
            {status.selfHosted && (
              <TextField
                size="small"
                placeholder="https://fm.example.org"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                sx={{ width: 220 }}
              />
            )}
            {tokenAuth && (
              <TextField
                size="small"
                type="password"
                placeholder="User token"
                value={token}
                onChange={e => setToken(e.target.value)}
                sx={{ width: 180 }}
              />
            )}
            <Button
              size="small"
              variant={awaitingApproval ? 'contained' : 'outlined'}
              disableElevation
              disabled={connectDisabled}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => {
                if (tokenAuth) {
                  onConnectToken(token, baseUrl);
                  setToken('');
                } else if (awaitingApproval) {
                  onFinishWebAuth();
                } else {
                  onStartWebAuth(baseUrl);
                }
              }}
            >
              {awaitingApproval ? "I've approved" : 'Connect'}
            </Button>
          </>
        )}
      </Stack>
      {(actionError ?? status.lastError) && (
        <Alert severity="error" variant="outlined" sx={{ width: '100%' }}>
          {actionError ?? status.lastError}
        </Alert>
      )}
    </ListItem>
  );
};

const Settings: React.FC = () => {
  const [resetExpanded, setResetExpanded] = React.useState<boolean>(false);
  const [overlayEnabled, setOverlayEnabledState] = React.useState<boolean>(getOverlayEnabled);
  const [artistImageFetchEnabled, setArtistImageFetchEnabledState] = React.useState<boolean>(
    getArtistImageFetchingEnabled()
  );
  const [missedArtists, setMissedArtists] = React.useState<number>(0);
  const [retryingArtists, setRetryingArtists] = React.useState<boolean>(false);
  const [scrobbler, setScrobbler] = React.useState<ScrobblerStatus | null>(null);
  const [scrobblerBusy, setScrobblerBusy] = React.useState<ScrobbleProvider | null>(null);
  const [scrobblerError, setScrobblerError] = React.useState<{
    provider: ScrobbleProvider;
    message: string;
  } | null>(null);
  const [awaitingApproval, setAwaitingApproval] = React.useState<ScrobbleProvider | null>(null);
  const [pauseOnOutputChange, setPauseOnOutputChangeState] = React.useState<boolean>(
    getPauseOnAudioOutputChange()
  );
  const [perDeviceVolume, setPerDeviceVolumeState] = React.useState<boolean>(
    getPerDeviceVolumeEnabled()
  );
  const [outputDevices, setOutputDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [outputDeviceId, setOutputDeviceIdState] = React.useState<string>(getAudioOutputDeviceId);
  const [windowScale, setWindowScaleState] = React.useState<number>(getWindowScale());
  const [streamHistoryDays, setStreamHistoryDaysState] =
    React.useState<number>(getStreamHistoryDays());
  const [titleBarStyle, setTitleBarStyleState] = React.useState<TitleBarStyle>(getTitleBarStyle());
  const [themeMode, setThemeModeState] = React.useState<ThemeMode>(getThemeMode());
  const [artistSeparators, setArtistSeparatorsState] =
    React.useState<string[]>(getMultiArtistSeparators);
  const [artistExceptions, setArtistExceptionsState] =
    React.useState<string[]>(getMultiArtistExceptions);
  const [artistRulesDirty, setArtistRulesDirty] = React.useState(false);
  const [themes, setThemes] = React.useState<AppTheme[]>(getAllThemes);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = React.useState(false);
  const [appInfo, setAppInfo] = React.useState<AppInfo | null>(null);
  const [themeMessage, setThemeMessage] = React.useState<{ text: string; error?: boolean } | null>(
    null
  );
  const { invokeEventToMainProcess, sendEventToMainProcess } = useIpc();
  const confirm = useConfirm();
  const { state, dispatch } = useContext(store);
  const { isScanningLibrary, scanMode } = state;
  const basicScanning = isScanningLibrary && scanMode === 'basic';
  const fullScanning = isScanningLibrary && scanMode === 'full';
  const applyingArtistRules = isScanningLibrary && scanMode === 'artists';
  const theme = useTheme();
  const currOs = os.type();

  React.useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: false });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

  React.useEffect(() => {
    invokeEventToMainProcess('get-missed-artist-count')
      .then((count: unknown) => setMissedArtists(Number(count) || 0))
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    invokeEventToMainProcess('get-app-info')
      .then((info: unknown) => setAppInfo(info as AppInfo))
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    // Submissions fail in the background with no event to listen for.
    const refresh = () =>
      invokeEventToMainProcess('scrobbler-status')
        .then((s: unknown) => setScrobbler(s as ScrobblerStatus))
        .catch(() => undefined);
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const runScrobblerAction = React.useCallback(
    async (provider: ScrobbleProvider, action: () => Promise<unknown>) => {
      setScrobblerBusy(provider);
      setScrobblerError(null);
      try {
        const result = await action();
        if (result) setScrobbler(result as ScrobblerStatus);
      } catch (err) {
        // ipcRenderer.invoke wraps the thrown message in its own boilerplate.
        const msg = err instanceof Error ? err.message : String(err);
        setScrobblerError({
          provider,
          message: msg.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, ''),
        });
      } finally {
        setScrobblerBusy(null);
      }
    },
    []
  );

  React.useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setOutputDevices(devices.filter(d => d.kind === 'audiooutput'));
      } catch (err) {
        console.error('Error enumerating audio output devices:', err);
      }
    };
    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);

  const handleResetExpansion = (): void => {
    setResetExpanded(prevExpanded => !prevExpanded);
  };

  const handleOutputDeviceChange = (deviceId: string): void => {
    setOutputDeviceIdState(deviceId);
    setAudioOutputDeviceId(deviceId);
  };

  // Fall back to default when the saved device is gone, so the Select value stays in range.
  const outputDeviceValue = outputDevices.some(d => d.deviceId === outputDeviceId)
    ? outputDeviceId
    : 'default';

  const handleThemeModeChange = (mode: ThemeMode): void => {
    setThemeModeState(mode);
    // Dispatch applies the theme live and persists it via the reducer.
    dispatch({ type: 'SET_THEME_MODE', payload: mode });
  };

  const isBuiltInTheme = state.appTheme.name === AMETHYST.name;

  const applyTheme = (theme: AppTheme, message: string): void => {
    setThemes(saveCustomTheme(theme));
    dispatch({ type: 'SET_APP_THEME', payload: theme });
    setThemeMessage({ text: message });
  };

  const handleDuplicateTheme = (): void => {
    const copy = { ...state.appTheme, name: uniqueThemeName(`${state.appTheme.name} copy`) };
    applyTheme(copy, `Created "${copy.name}" — customise it below.`);
    setEditorOpen(true);
  };

  const handleSaveTheme = (edited: AppTheme): void => {
    // A rename leaves the old entry behind, so drop it before saving the new name.
    if (edited.name !== state.appTheme.name) deleteCustomTheme(state.appTheme.name);
    applyTheme(edited, `Saved "${edited.name}".`);
    setEditorOpen(false);
  };

  const handleDeleteTheme = async (): Promise<void> => {
    const name = state.appTheme.name;
    const ok = await confirm({
      title: 'Delete theme',
      message: `Delete "${name}"?`,
      detail: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setThemes(deleteCustomTheme(name));
    dispatch({ type: 'SET_APP_THEME', payload: AMETHYST });
    setThemeMessage({ text: `Deleted "${name}".` });
  };

  const handleExportTheme = (): void => {
    invokeEventToMainProcess('export-theme', { theme: state.appTheme })
      .then((res: unknown) => {
        const result = res as { success: boolean; canceled?: boolean; error?: string };
        if (result.canceled) return;
        setThemeMessage(
          result.success
            ? { text: `Exported "${state.appTheme.name}".` }
            : { text: result.error ?? 'Export failed.', error: true }
        );
      })
      .catch((err: unknown) => setThemeMessage({ text: String(err), error: true }));
  };

  const handleImportTheme = (): void => {
    invokeEventToMainProcess('import-theme')
      .then((res: unknown) => {
        const result = res as {
          success: boolean;
          canceled?: boolean;
          error?: string;
          theme?: unknown;
        };
        if (result.canceled) return;
        if (!result.success) {
          setThemeMessage({ text: result.error ?? 'Import failed.', error: true });
          return;
        }
        const parsed = parseTheme(result.theme);
        if ('error' in parsed) {
          setThemeMessage({ text: `Invalid theme file: ${parsed.error}`, error: true });
          return;
        }
        const imported = { ...parsed.theme, name: uniqueThemeName(parsed.theme.name) };
        applyTheme(imported, `Imported "${imported.name}".`);
      })
      .catch((err: unknown) => setThemeMessage({ text: String(err), error: true }));
  };

  // The View menu changes the scale too, so follow it instead of only reading
  // the stored value on mount.
  React.useEffect(() => {
    const onScale = (event: Event): void => {
      setWindowScaleState((event as CustomEvent).detail as number);
    };
    window.addEventListener(WINDOW_SCALE_EVENT, onScale);
    return () => window.removeEventListener(WINDOW_SCALE_EVENT, onScale);
  }, []);

  const handleSeparatorsChange = (next: string[]): void => {
    setArtistSeparatorsState(next);
    setMultiArtistSeparators(next);
    setArtistRulesDirty(true);
  };

  const handleExceptionsChange = (next: string[]): void => {
    setArtistExceptionsState(next);
    setMultiArtistExceptions(next);
    setArtistRulesDirty(true);
  };

  const handleApplyArtistRules = (): void => {
    setArtistRulesDirty(false);
    invokeEventToMainProcess('reapply-artist-rules')
      .then((res: unknown) => {
        // Refused before it started: no folders, or a scan already running.
        if (!(res as { success?: boolean })?.success) setArtistRulesDirty(true);
      })
      .catch((err: unknown) => {
        console.error('Error re-applying artist rules:', err);
        setArtistRulesDirty(true);
      });
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
              <ListSubheader color="inherit" sx={subheaderSx}>
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
                    })
                    .catch((err: unknown) => {
                      console.error('Error during full rescan:', err);
                    });
                }}
              >
                {fullScanning ? 'Scanning…' : 'Full Rescan'}
              </Button>
            </ListItem>
            <SyncProgressPanel />
            <MusicSourcesSection />
            <ListItem>
              <ListItemIcon>
                <Icon icon={duplicateIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                primary="Duplicate tracks"
                secondary="Find identical files added more than once and drop the extra copies"
              />
              <Button
                variant="outlined"
                size="small"
                disabled={isScanningLibrary}
                onClick={() => setDuplicatesOpen(true)}
                sx={{ mr: 0.5, flexShrink: 0 }}
              >
                Find
              </Button>
            </ListItem>
          </List>

          <List
            subheader={
              <ListSubheader color="inherit" sx={subheaderSx}>
                Playback
              </ListSubheader>
            }
          >
            <ListItem
              sx={{
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'center' },
                gap: { xs: 1, sm: 0 },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, width: '100%' }}>
                <ListItemIcon>
                  <Icon icon={speakerIcon} width={'2rem'} />
                </ListItemIcon>
                <ListItemText
                  id="select-audio-output-device"
                  primary="Output Device"
                  secondary="Where playback audio is sent"
                />
              </Box>
              <Select
                size="small"
                value={outputDeviceValue}
                onChange={e => handleOutputDeviceChange(String(e.target.value))}
                sx={{
                  minWidth: 200,
                  maxWidth: { xs: 'none', sm: 300, lg: 'none' },
                  mr: { xs: 0, sm: 0.5 },
                  width: { xs: '100%', sm: 'auto' },
                }}
              >
                {outputDevices.length === 0 ? (
                  <MenuItem value="default">System Default</MenuItem>
                ) : (
                  outputDevices.map(device => (
                    <MenuItem key={device.deviceId} value={device.deviceId}>
                      {device.label ||
                        (device.deviceId === 'default'
                          ? 'System Default'
                          : `Output (${device.deviceId.slice(0, 8)})`)}
                    </MenuItem>
                  ))
                )}
              </Select>
            </ListItem>
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
            <ListItem>
              <ListItemIcon>
                <Icon icon={speakerIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                id="switch-list-label-per-device-volume"
                primary="Remember volume per device"
                secondary="Keep a separate volume for each output device so switching to headphones doesn't blast the last level. Turn off to share one volume across all devices."
              />
              <IOSSwitch
                checked={perDeviceVolume}
                onChange={e => {
                  setPerDeviceVolumeState(e.target.checked);
                  setPerDeviceVolumeEnabled(e.target.checked);
                }}
                sx={{
                  mr: 0.5,
                }}
              />
            </ListItem>
          </List>

          {/* ── Appearance ── */}
          <List
            subheader={
              <ListSubheader color="inherit" sx={subheaderSx}>
                Appearance
              </ListSubheader>
            }
          >
            <ListItem
              sx={{
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'center' },
                gap: { xs: 1, sm: 0 },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, width: '100%' }}>
                <ListItemIcon>
                  <Icon icon={darkThemeIcon} width={'2rem'} />
                </ListItemIcon>
                <ListItemText
                  id="select-theme-mode"
                  primary="Theme"
                  secondary="Choose light, dark, or follow the system"
                />
              </Box>
              <Select
                size="small"
                value={themeMode}
                onChange={e => handleThemeModeChange(Number(e.target.value) as ThemeMode)}
                sx={{ minWidth: 130, mr: { xs: 0, sm: 0.5 }, width: { xs: '100%', sm: 'auto' } }}
              >
                <MenuItem value={0}>System</MenuItem>
                <MenuItem value={1}>Light</MenuItem>
                <MenuItem value={2}>Dark</MenuItem>
              </Select>
            </ListItem>
            <ListItem sx={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, width: '100%' }}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Icon icon={colorIcon} width="1.5rem" />
                </ListItemIcon>
                <ListItemText
                  primary="Colour Theme"
                  secondary="Duplicate a theme to customise it, or import one you've been sent"
                  secondaryTypographyProps={{ fontSize: '0.75rem' }}
                />
              </Box>

              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap', gap: 1, pl: 4.5, alignItems: 'center' }}
              >
                <Select
                  size="small"
                  value={state.appTheme.name}
                  onChange={e => {
                    const next = themes.find(t => t.name === e.target.value);
                    if (next) dispatch({ type: 'SET_APP_THEME', payload: next });
                  }}
                  sx={{ minWidth: 180 }}
                >
                  {themes.map(t => (
                    <MenuItem key={t.name} value={t.name}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box
                          sx={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            bgcolor: t[theme.palette.mode].primary,
                            border: th => `1px solid ${th.palette.divider}`,
                          }}
                        />
                        <span>{t.name}</span>
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>

                <Button size="small" onClick={handleDuplicateTheme}>
                  Duplicate
                </Button>
                <Tooltip
                  title={isBuiltInTheme ? 'The built-in theme cannot be edited — duplicate it' : ''}
                >
                  <span>
                    <Button
                      size="small"
                      disabled={isBuiltInTheme}
                      onClick={() => setEditorOpen(true)}
                    >
                      Customise
                    </Button>
                  </span>
                </Tooltip>
                <Button size="small" onClick={handleExportTheme}>
                  Export
                </Button>
                <Button size="small" onClick={handleImportTheme}>
                  Import
                </Button>
                <Tooltip title={isBuiltInTheme ? 'The built-in theme cannot be deleted' : ''}>
                  <span>
                    <Button
                      size="small"
                      color="error"
                      disabled={isBuiltInTheme}
                      onClick={handleDeleteTheme}
                    >
                      Delete
                    </Button>
                  </span>
                </Tooltip>
              </Stack>

              {themeMessage && (
                <Typography
                  variant="caption"
                  color={themeMessage.error ? 'error' : 'text.secondary'}
                  sx={{ pl: 4.5, mt: 1 }}
                >
                  {themeMessage.text}
                </Typography>
              )}
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
              <ListSubheader color="inherit" sx={subheaderSx}>
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
              <ListSubheader color="inherit" sx={subheaderSx}>
                Streams
              </ListSubheader>
            }
          >
            <ListItem>
              <ListItemIcon>
                <Icon icon={streamIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                id="select-stream-history"
                primary="Keep recently played for"
                secondary="Bookmarked songs will be kept forever, everything else will be vanished."
              />
              <Select
                size="small"
                value={streamHistoryDays}
                onChange={e => {
                  const next = Number(e.target.value);
                  setStreamHistoryDaysState(next);
                  setStreamHistoryDays(next);
                }}
                sx={{ minWidth: 110, mr: 0.5 }}
              >
                {STREAM_HISTORY_DAY_OPTIONS.map(opt => (
                  <MenuItem key={opt} value={opt}>
                    {opt} day{opt === 1 ? '' : 's'}
                  </MenuItem>
                ))}
              </Select>
            </ListItem>
          </List>
          <List
            subheader={
              <ListSubheader color="inherit" sx={subheaderSx}>
                Artist Name Handling
              </ListSubheader>
            }
          >
            <ListItem sx={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, width: '100%' }}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Icon icon={artistIcon} width="1.5rem" />
                </ListItemIcon>
                <ListItemText
                  primary="Artist Name Handling"
                  secondary="Control how multi-artist tags are split into separate artists. Edit the rules, then apply them to your library."
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
                  placeholder="Add a separator"
                  ariaLabel="Add multi-artist separator"
                  removeConfirm={value => ({
                    title: 'Remove separator?',
                    message: `Remove "${value}" from the multi-artist separators?`,
                    detail:
                      'Artist tags will no longer be split on this character once you apply the rules.',
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
                  Names kept intact even when they contain a separator (e.g. &quot;AC/DC&quot;).
                </Typography>
                <ChipListEditor
                  values={artistExceptions}
                  onChange={handleExceptionsChange}
                  placeholder="Add an exception"
                  ariaLabel="Add multi-artist exception"
                  removeConfirm={value => ({
                    title: 'Remove exception?',
                    message: `Remove "${value}" from the artist name exceptions?`,
                    detail: 'Tags matching this name will be split again once you apply the rules.',
                    confirmLabel: 'Remove',
                    destructive: true,
                  })}
                />

                <Divider sx={{ my: 2 }} />

                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                    {applyingArtistRules
                      ? 'Re-splitting your library under the new rules…'
                      : artistRulesDirty
                        ? 'Your library still uses the previous rules.'
                        : 'Re-splits every track from its stored tags — no files are re-read, no album art is rebuilt.'}
                  </Typography>
                  <Button
                    startIcon={
                      applyingArtistRules ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <Icon icon={syncIcon} height={'1.25rem'} />
                      )
                    }
                    variant={artistRulesDirty ? 'contained' : 'outlined'}
                    size="small"
                    disableElevation
                    disabled={isScanningLibrary}
                    onClick={handleApplyArtistRules}
                    sx={{ flexShrink: 0 }}
                  >
                    {applyingArtistRules ? 'Applying…' : 'Apply to Library'}
                  </Button>
                </Stack>
              </Box>
            </ListItem>
          </List>
          <List
            subheader={
              <ListSubheader color="inherit" sx={subheaderSx}>
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
            <ListItem>
              <ListItemIcon>
                <Icon icon={artistIcon} width={'2rem'} />
              </ListItemIcon>
              <ListItemText
                primary="Retry artists with no match"
                secondary={
                  missedArtists > 0
                    ? `${missedArtists} artist${missedArtists === 1 ? '' : 's'} came back empty and won't be looked up again on their own`
                    : 'No artists are waiting on a retry'
                }
              />
              <Button
                startIcon={
                  retryingArtists ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Icon icon={syncIcon} height={'1.25rem'} />
                  )
                }
                variant="outlined"
                size="small"
                disabled={retryingArtists || missedArtists === 0 || !artistImageFetchEnabled}
                onClick={() => {
                  setRetryingArtists(true);
                  invokeEventToMainProcess('retry-missed-artists')
                    .then(() => setMissedArtists(0))
                    .catch(() => undefined)
                    .finally(() => setRetryingArtists(false));
                }}
                sx={{ mr: 0.5, flexShrink: 0 }}
              >
                Retry
              </Button>
            </ListItem>
          </List>
          <List
            subheader={
              <ListSubheader color="inherit" sx={subheaderSx}>
                Scrobbling
              </ListSubheader>
            }
          >
            {(scrobbler ?? []).map(s => (
              <ScrobblerRow
                key={s.provider}
                status={s}
                busy={scrobblerBusy === s.provider}
                awaitingApproval={awaitingApproval === s.provider}
                actionError={
                  scrobblerError?.provider === s.provider ? scrobblerError.message : null
                }
                onToggle={enabled =>
                  runScrobblerAction(s.provider, () =>
                    invokeEventToMainProcess('scrobbler-set-enabled', {
                      provider: s.provider,
                      enabled,
                    })
                  )
                }
                onDisconnect={() =>
                  runScrobblerAction(s.provider, () =>
                    invokeEventToMainProcess('scrobbler-disconnect', { provider: s.provider })
                  )
                }
                onStartWebAuth={baseUrl =>
                  runScrobblerAction(s.provider, async () => {
                    await invokeEventToMainProcess('scrobbler-auth-start', {
                      provider: s.provider,
                      baseUrl,
                    });
                    setAwaitingApproval(s.provider);
                    return null;
                  })
                }
                onFinishWebAuth={() =>
                  runScrobblerAction(s.provider, async () => {
                    const status = await invokeEventToMainProcess('scrobbler-auth-finish', {
                      provider: s.provider,
                    });
                    setAwaitingApproval(null);
                    return status;
                  })
                }
                onConnectToken={(token, baseUrl) =>
                  runScrobblerAction(s.provider, () =>
                    invokeEventToMainProcess('scrobbler-connect-token', {
                      provider: s.provider,
                      token,
                      baseUrl,
                    })
                  )
                }
              />
            ))}
          </List>
          <List
            subheader={
              <ListSubheader color="inherit" sx={subheaderSx}>
                Advanced Options
              </ListSubheader>
            }
          >
            <ListItem disableGutters>
              <Accordion
                expanded={resetExpanded}
                slots={{ transition: Fade }}
                slotProps={{ transition: { timeout: 400 } }}
                sx={{
                  '& .MuiAccordion-region': { height: resetExpanded ? 'auto' : 0 },
                  '& .MuiAccordionDetails-root': { display: resetExpanded ? 'block' : 'none' },
                  backgroundColor: 'background.default',
                  width: '100%',
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon onClick={handleResetExpansion} />}
                  aria-controls="factory-reset-content"
                  id="factory-reset-header"
                >
                  <Box
                    component={Stack}
                    onClick={handleResetExpansion}
                    alignItems={'center'}
                    direction={'row'}
                    width={'100%'}
                  >
                    <ListItemIcon sx={{ mr: -2 }}>
                      <Icon icon={warningIcon} height={'1.5rem'} />
                    </ListItemIcon>
                    <ListItemText primary="Factory Reset" />
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.5} alignItems="flex-start">
                    <Typography variant="body2" color="text.secondary">
                      Wipe your library, settings, themes and cached art, individually or all at
                      once. Music files on disk are never touched.
                    </Typography>
                    <Button
                      variant="contained"
                      color="error"
                      disableElevation
                      disabled={isScanningLibrary}
                      onClick={() => setResetOpen(true)}
                    >
                      Factory Reset…
                    </Button>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </ListItem>
          </List>

          <List
            subheader={
              <ListSubheader color="inherit" sx={subheaderSx}>
                About
              </ListSubheader>
            }
          >
            <Card
              variant="outlined"
              sx={{
                py: 1,
                mb: 1,
              }}
            >
              <ListItem sx={{ alignItems: 'flex-start', gap: 2 }}>
                <XeroLogoMark width={56} height={56} style={{ flexShrink: 0, marginTop: 4 }} />
                <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                  <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                    {appInfo?.name ?? APP_DISPLAY_NAME}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Version {appInfo?.version ?? '—'}
                    {appInfo?.channel === 'beta' && ' · Beta channel'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    An open source cross-platform music player, licensed{' '}
                    {appInfo?.license ?? 'GPL-3.0'}.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        appInfo?.repo &&
                        sendEventToMainProcess('open-external', { url: SITE_URL })
                      }
                    >
                      Website
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      onClick={() =>
                        appInfo?.repo &&
                        sendEventToMainProcess('open-external', { url: appInfo.repo })
                      }
                    >
                      GitHub
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="info"
                      onClick={() =>
                        invokeEventToMainProcess('open-dir', { variant: 'appdata' }).catch(
                          () => undefined
                        )
                      }
                    >
                      Data folder
                    </Button>
                  </Stack>
                </Stack>
              </ListItem>
              <ListItem sx={{ pt: 0, mt: 1 }}>
                <Stack sx={{ width: '100%' }}>
                  <Divider sx={{ mb: 1 }} />
                  {[
                    ['Electron', appInfo?.electron],
                    ['Chromium', appInfo?.chrome],
                    ['Node', appInfo?.node],
                    ['System', appInfo?.platform],
                    ['Library data', appInfo?.dataDir],
                  ].map(([label, value]) => (
                    <Stack key={label} direction="row" spacing={2} sx={{ py: 0.25 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ width: 110, flexShrink: 0 }}
                      >
                        {label}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {value ?? '—'}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </ListItem>
            </Card>
          </List>
        </Container>
      </Box>

      <FactoryResetDialog open={resetOpen} onClose={() => setResetOpen(false)} />

      <DuplicateTracksDialog open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />

      <ThemeEditorDialog
        open={editorOpen}
        theme={state.appTheme}
        takenNames={themes.filter(t => t.name !== state.appTheme.name).map(t => t.name)}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveTheme}
      />
    </motion.div>
  );
};

export default Settings;
