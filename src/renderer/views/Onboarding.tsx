import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  IconButton,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
  useTheme,
} from '@mui/material';
import { motion } from 'motion/react';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import LightModeRounded from '@mui/icons-material/LightModeRounded';
import DarkModeRounded from '@mui/icons-material/DarkModeRounded';
import SettingsBrightnessRounded from '@mui/icons-material/SettingsBrightnessRounded';
import CreateNewFolderRounded from '@mui/icons-material/CreateNewFolderRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import LibraryMusicRounded from '@mui/icons-material/LibraryMusicRounded';
import XeroLogoMark from '../components/XeroLogoMark';
import { useIpc } from '../state/ipc';
import { store } from '../utils/store';
import { completeOnboarding, getThemeMode } from '../utils/LocStoreUtil';
import { ThemeMode } from '../../config/app_settings';

interface OnboardingProps {
  onFinish: () => void;
}

interface MusicFolder {
  Id: string | number;
  Uri: string;
  Name?: string;
  ItemsCount?: number;
}

type Step_ = 'greeting' | 'theme' | 'folders' | 'scan' | 'done';

const STEPPER_STEPS = ['Theme', 'Folders', 'Scan'] as const;
const STEP_INDEX: Partial<Record<Step_, number>> = { theme: 0, folders: 1, scan: 2 };

const SUPPORTED_FORMATS = ['MP3', 'FLAC', 'WAV', 'AAC', 'OGG', 'M4A'];

const THEME_OPTIONS: {
  mode: ThemeMode;
  label: string;
  description: string;
  Icon: typeof LightModeRounded;
}[] = [
  {
    mode: 0,
    label: 'Auto',
    description: 'Follow the system appearance',
    Icon: SettingsBrightnessRounded,
  },
  { mode: 2, label: 'Dark', description: 'Easy on the eyes at night', Icon: DarkModeRounded },
  { mode: 1, label: 'Light', description: 'Bright and crisp', Icon: LightModeRounded },
];

const Onboarding: React.FC<OnboardingProps> = ({ onFinish }) => {
  const theme = useTheme();
  const { state, dispatch } = useContext(store);
  const { invokeEventToMainProcess } = useIpc();

  const [step, setStep] = useState<Step_>('greeting');
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getThemeMode());
  const [folders, setFolders] = useState<MusicFolder[]>([]);
  const [skipped, setSkipped] = useState(false);
  const [scanDone, setScanDone] = useState(false);

  const loadFolders = useCallback(() => {
    invokeEventToMainProcess('get-music-folders', undefined)
      .then(data => setFolders((data as MusicFolder[]) ?? []))
      .catch(() => undefined);
  }, [invokeEventToMainProcess]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const handleThemePick = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      dispatch({ type: 'SET_THEME_MODE', payload: mode });
    },
    [dispatch]
  );

  const handleAddFolder = useCallback(() => {
    // Skip the per-add scan; the scan step scans every folder in one pass.
    invokeEventToMainProcess('add-music-folder', { skipScan: true })
      .then(() => loadFolders())
      .catch(() => undefined);
  }, [invokeEventToMainProcess, loadFolders]);

  const handleRemoveFolder = useCallback(
    (id: string | number) => {
      invokeEventToMainProcess('remove-music-folder', { Id: id })
        .then(() => loadFolders())
        .catch(() => undefined);
    },
    [invokeEventToMainProcess, loadFolders]
  );

  // Scan when the scan step opens: wait out any running scan, then run one pass
  // over all folders. `scan-media` resolves on completion — our done signal.
  // Deps are `[step]` only; a scan flag in there would let its own setState
  // re-run the effect, whose cleanup cancels the in-flight routine.
  useEffect(() => {
    if (step !== 'scan') return;

    let cancelled = false;
    setScanDone(false);

    const run = async () => {
      let status = (await invokeEventToMainProcess('get-scan-status', undefined)) as {
        isScanning: boolean;
      } | null;
      while (!cancelled && status?.isScanning) {
        await new Promise(r => setTimeout(r, 400));
        status = (await invokeEventToMainProcess('get-scan-status', undefined)) as {
          isScanning: boolean;
        } | null;
      }
      if (cancelled) return;
      await invokeEventToMainProcess('scan-media', undefined);
      if (!cancelled) setScanDone(true);
    };
    run().catch(() => {
      if (!cancelled) setScanDone(true);
    });

    return () => {
      cancelled = true;
    };
  }, [step]);

  const finish = useCallback(
    (wasSkipped: boolean) => {
      // Skipping bypasses the scan step, so scan any added folders on the way out.
      if (wasSkipped && folders.length > 0) {
        invokeEventToMainProcess('scan-media', undefined).catch(() => undefined);
      }
      completeOnboarding({ skipped: wasSkipped });
      onFinish();
    },
    [onFinish, folders.length, invokeEventToMainProcess]
  );

  const skipSetup = useCallback(() => {
    setSkipped(true);
    setStep('done');
  }, []);

  const scanProgress = state.scanProgress;
  const percent =
    scanProgress && scanProgress.total > 0
      ? Math.min(100, Math.round((scanProgress.processed / scanProgress.total) * 100))
      : 0;
  const trackCount = state.libraryStats?.songs ?? 0;

  const stepperIndex = STEP_INDEX[step];

  // ── Panels ──────────────────────────────────────────────────────────────────
  const renderGreeting = () => (
    <Stack alignItems="center" textAlign="center" sx={{ maxWidth: 540, px: 2 }}>
      <Box sx={{ mb: 4 }}>
        <XeroLogoMark style={{ width: 120, height: 120 }} />
      </Box>

      <Typography variant="subtitle1" sx={{ color: 'primary.main', fontWeight: 600, mb: 1.5 }}>
        Welcome to XeroTunes
      </Typography>
      <Typography variant="h1" sx={{ fontWeight: 700, lineHeight: 1.1, mb: 2 }}>
        let&apos;s tune the setup.
      </Typography>
      <Typography
        variant="h6"
        color="text.secondary"
        sx={{ fontWeight: 400, lineHeight: 1.6, maxWidth: 440, mb: 5 }}
      >
        A theme, your music folders, one quick scan. Then XeroTunes is yours to play with.
      </Typography>

      <Stack spacing={1.5} alignItems="center">
        <Button
          variant="contained"
          disableElevation
          size="large"
          endIcon={<ArrowForwardRounded />}
          onClick={() => setStep('theme')}
          sx={{ width: '100%', minWidth: 250, borderRadius: 10 }}
        >
          Let&apos;s roll
        </Button>
        <Button
          variant="text"
          color="inherit"
          sx={{ width: '100%', minWidth: 250, borderRadius: 10 }}
          onClick={skipSetup}
        >
          Skip setup
        </Button>
      </Stack>
    </Stack>
  );

  const renderTheme = () => (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 680 }}>
      <Box textAlign="center">
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          Pick your vibe
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          You can change this any time in Settings.
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 2,
        }}
      >
        {THEME_OPTIONS.map(({ mode, label, description, Icon }) => {
          const selected = themeMode === mode;
          return (
            <Card
              key={mode}
              variant="outlined"
              sx={{
                display: 'flex',
                borderWidth: 2,
                borderColor: selected ? 'primary.main' : 'divider',
                bgcolor: selected ? 'action.selected' : 'background.paper',
                transition: 'border-color 0.15s, background-color 0.15s',
              }}
            >
              <CardActionArea
                onClick={() => handleThemePick(mode)}
                sx={{
                  p: 2.5,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                <Stack spacing={1.25} alignItems="center" textAlign="center">
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: selected ? 'primary.main' : 'action.hover',
                      color: selected ? 'primary.contrastText' : 'text.secondary',
                    }}
                  >
                    <Icon />
                  </Box>
                  <Typography fontWeight={600}>{label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {description}
                  </Typography>
                </Stack>
              </CardActionArea>
            </Card>
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary" textAlign="center">
        Now showing the <b>{theme.palette.mode}</b> theme.
      </Typography>
    </Stack>
  );

  const renderFolders = () => (
    <Stack spacing={2.5} sx={{ width: '100%', maxWidth: 680 }}>
      <Box textAlign="center">
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          Where&apos;s the good stuff?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Add the folders that hold your music. Subfolders will be scanned automatically.
        </Typography>
      </Box>

      <Card variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{ mb: folders.length ? 1.5 : 0 }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <FolderRounded color="primary" />
            <Typography fontWeight={600}>Music Folders</Typography>
          </Stack>
          <Button
            variant="contained"
            disableElevation
            size="small"
            startIcon={<CreateNewFolderRounded />}
            onClick={handleAddFolder}
          >
            Add Folder
          </Button>
        </Stack>

        {folders.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No folders yet — add one to build your library.
            </Typography>
          </Box>
        ) : (
          <Stack divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
            {folders.map(folder => (
              <Stack
                key={folder.Id}
                direction="row"
                alignItems="center"
                spacing={1.5}
                sx={{ py: 1 }}
              >
                <FolderRounded fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                <Typography
                  variant="body2"
                  noWrap
                  title={folder.Uri}
                  sx={{ fontFamily: 'monospace', fontSize: 12, flex: 1, minWidth: 0 }}
                >
                  {folder.Uri}
                </Typography>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleRemoveFolder(folder.Id)}
                  aria-label="Remove folder"
                >
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </Card>

      <Typography variant="caption" color="text.secondary" textAlign="center">
        Supported formats: {SUPPORTED_FORMATS.join(', ')}
      </Typography>
    </Stack>
  );

  const renderScan = () => {
    const noFolders = folders.length === 0;
    // A basic scan reports total = new files only, so an already-scanned library reports 0.
    const sp =
      scanProgress && scanProgress.total > 0 && typeof scanProgress.processed === 'number'
        ? scanProgress
        : null;
    const hasProgress = sp !== null;

    return (
      <Stack spacing={3} alignItems="center" textAlign="center" sx={{ maxWidth: 520 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          {scanDone ? 'Ready to play!' : 'Building your library…'}
        </Typography>

        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          {/* Static full-circle track so a low/partial value doesn't look broken. */}
          <CircularProgress
            variant="determinate"
            value={100}
            size={160}
            thickness={2.5}
            sx={{ color: 'action.hover' }}
          />
          <CircularProgress
            variant={scanDone || hasProgress ? 'determinate' : 'indeterminate'}
            value={scanDone ? 100 : hasProgress ? percent : 0}
            size={160}
            thickness={2.5}
            sx={{ position: 'absolute', left: 0 }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {noFolders ? (
              <LibraryMusicRounded sx={{ fontSize: 40, color: 'text.secondary' }} />
            ) : sp && !scanDone ? (
              <>
                <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1 }}>
                  {sp.processed}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  of {sp.total} tracks
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1 }}>
                  {trackCount}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  tracks
                </Typography>
              </>
            )}
          </Box>
        </Box>

        <Typography variant="body2" color="text.secondary">
          {noFolders
            ? 'No folders added - you can add music later from Settings.'
            : scanDone
              ? `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'} ready to play.`
              : hasProgress
                ? `${percent}% - hang tight while we process your tracks.`
                : 'Reading your library…'}
        </Typography>
      </Stack>
    );
  };

  const renderDone = () => (
    <Stack spacing={3} alignItems="center" textAlign="center" sx={{ maxWidth: 520 }}>
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      >
        <CheckCircleRounded sx={{ fontSize: 88, color: 'primary.main' }} />
      </motion.div>
      <Typography variant="h3" sx={{ fontWeight: 600 }}>
        You&apos;re all set.
      </Typography>
      <Typography variant="body1" color="text.secondary">
        {skipped
          ? 'Setup skipped — add music folders any time from Settings to fill your library.'
          : trackCount > 0
            ? `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'} catalogued and ready.`
            : 'Your library is ready. Add music folders from Settings whenever you like.'}
      </Typography>
      <Button
        variant="contained"
        disableElevation
        size="large"
        endIcon={<ArrowForwardRounded />}
        onClick={() => finish(skipped)}
        sx={{ mt: 1 }}
      >
        Enter XeroTunes
      </Button>
    </Stack>
  );

  const renderPanel = () => {
    switch (step) {
      case 'greeting':
        return renderGreeting();
      case 'theme':
        return renderTheme();
      case 'folders':
        return renderFolders();
      case 'scan':
        return renderScan();
      case 'done':
        return renderDone();
    }
  };

  // ── Footer navigation ─────────────────────────────────────────────────────
  const renderFooter = () => {
    if (step === 'greeting' || step === 'done') return null;

    const backTarget: Record<'theme' | 'folders' | 'scan', Step_> = {
      theme: 'greeting',
      folders: 'theme',
      scan: 'folders',
    };
    const isScan = step === 'scan';
    const nextDisabled = isScan && !scanDone;

    const goNext = () => {
      if (step === 'theme') setStep('folders');
      else if (step === 'folders') setStep('scan');
      else if (step === 'scan') setStep('done');
    };

    return (
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ width: '100%', maxWidth: 680, mx: 'auto' }}
      >
        {/* Keep Skip away from the primary CTA to avoid accidental exits. */}
        <Stack direction="row" spacing={2} alignItems="center">
          <Button
            startIcon={<ArrowBackRounded />}
            color="inherit"
            onClick={() => setStep(backTarget[step as 'theme' | 'folders' | 'scan'])}
          >
            Back
          </Button>
          <Button variant="text" color="inherit" onClick={skipSetup} sx={{ opacity: 0.7 }}>
            Skip setup
          </Button>
        </Stack>
        <Button
          variant="contained"
          disableElevation
          endIcon={<ArrowForwardRounded />}
          onClick={goNext}
          disabled={nextDisabled}
        >
          {isScan ? 'Finish' : 'Continue'}
        </Button>
      </Stack>
    );
  };

  const footerContent = renderFooter();

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        top: 32, // clear the titlebar
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 5,
      }}
    >
      {stepperIndex !== undefined && (
        <Box sx={{ px: 3, pt: 3, pb: 1 }}>
          <Stepper activeStep={stepperIndex} alternativeLabel sx={{ maxWidth: 680, mx: 'auto' }}>
            {STEPPER_STEPS.map(label => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
          <Typography variant="caption" color="text.secondary" textAlign="center" display="block">
            Step {(stepperIndex ?? 0) + 1} of 3
          </Typography>
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {renderPanel()}
        </motion.div>
      </Box>

      {footerContent && <Box sx={{ p: 2 }}>{footerContent}</Box>}
    </Box>
  );
};

export default Onboarding;
