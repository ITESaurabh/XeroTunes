import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, IconButton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Icon } from '@iconify/react';
import subtractIcon from '@iconify/icons-fluent/subtract-24-regular';
import addIcon from '@iconify/icons-fluent/add-24-regular';
import AppDialog from './AppDialog';
import XTFader from './XTFader';
import { getTempo, previewTempo, setTempo } from '../utils/LocStoreUtil';
import { formatDuration } from '../utils/formatDuration';
import { TEMPO_MAX, TEMPO_MIN, TEMPO_STEP } from '../../config/equalizer';

interface TempoDialogProps {
  open: boolean;
  onClose: () => void;
  /** Length of the playing track in seconds; 0 hides the "this song takes" line. */
  duration: number;
}

const QUICK = [0.5, 0.75, 1, 1.25, 1.5, 2];
// Steps of 0.05 drift in binary (0.1 + 0.05 = 0.15000000000000002).
const round = (v: number): number => Math.round(v * 100) / 100;
const clamp = (v: number): number => Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, round(v)));

const describe = (tempo: number): string =>
  tempo === 1 ? 'Normal speed' : tempo > 1 ? 'Faster' : 'Slower';

const TempoDialog: React.FC<TempoDialogProps> = ({ open, onClose, duration }) => {
  const [tempo, setLocal] = useState(getTempo);

  useEffect(() => {
    if (open) setLocal(getTempo());
  }, [open]);

  const commit = (next: number): void => {
    setLocal(next);
    setTempo(next);
  };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Tempo"
      maxWidth="xs"
      fullScreenOnMobile={false}
      actions={
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Stack spacing={2} sx={{ pt: 0.5, pb: 1 }}>
        <Box sx={{ textAlign: 'center', pb: 1 }}>
          <Typography
            sx={{
              fontSize: '3rem',
              fontWeight: 700,
              lineHeight: 1.1,
              fontVariantNumeric: 'tabular-nums',
              color: tempo === 1 ? 'text.primary' : 'primary.main',
              transition: 'color 200ms',
            }}
          >
            {tempo}×
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {describe(tempo)}
            {duration > 0 && tempo !== 1 && (
              <>
                {' · this song takes '}
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                  {formatDuration(duration / tempo)}
                </Box>
                {` instead of ${formatDuration(duration)}`}
              </>
            )}
          </Typography>
        </Box>

        <Box
          sx={{
            bgcolor: 'surfaces.well',
            borderRadius: 3,
            // Centres each 44px button in the pill's rounded end.
            px: 0.75,
            py: 0.75,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <IconButton
            aria-label="Slower"
            disabled={tempo <= TEMPO_MIN}
            onClick={() => commit(clamp(tempo - TEMPO_STEP))}
            sx={{ width: 44, height: 44 }}
          >
            <Icon icon={subtractIcon} width={22} />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0, px: 1 }}>
            <XTFader
              orientation="horizontal"
              value={tempo}
              min={TEMPO_MIN}
              max={TEMPO_MAX}
              origin={1}
              step={TEMPO_STEP}
              marks={QUICK.map(value => ({ value }))}
              sx={{
                '& .MuiSlider-mark': {
                  width: 2,
                  height: 14,
                  borderRadius: 1,
                  bgcolor: theme => alpha(theme.palette.text.primary, 0.3),
                },
              }}
              aria-label="Playback speed"
              onChange={(_, v) => {
                const next = clamp(v as number);
                setLocal(next);
                previewTempo(next);
              }}
              onChangeCommitted={(_, v) => setTempo(clamp(v as number))}
            />
          </Box>
          <IconButton
            aria-label="Faster"
            disabled={tempo >= TEMPO_MAX}
            onClick={() => commit(clamp(tempo + TEMPO_STEP))}
            sx={{ width: 44, height: 44 }}
          >
            <Icon icon={addIcon} width={22} />
          </IconButton>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
          {QUICK.map(value => (
            <Chip
              key={value}
              label={value === 1 ? 'Normal' : `${value}×`}
              clickable
              color={tempo === value ? 'primary' : 'default'}
              variant={tempo === value ? 'filled' : 'outlined'}
              onClick={() => commit(value)}
            />
          ))}
        </Box>
      </Stack>
    </AppDialog>
  );
};

export default TempoDialog;
