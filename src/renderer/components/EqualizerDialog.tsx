import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AppDialog from './AppDialog';
import XTFader from './XTFader';
import XTKnob from './XTKnob';
import XTSwitch from './XTSwitch';
import {
  getEqualizerSettings,
  previewEqualizer,
  setEqualizerSettings,
} from '../utils/LocStoreUtil';
import {
  BASS_MAX_DB,
  DEFAULT_EQUALIZER_SETTINGS,
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_PRESETS,
  EqualizerSettings,
} from '../../config/equalizer';
import { CURVE_FREQS, bassDb, responseDb, solveGains } from '../utils/eqMath';

interface EqualizerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Why the EQ can't reach the speakers right now; disables the controls while set. */
  notice?: string;
}

const FADER_H = 200;
const GRID_DB = [12, 6, 0, -6, -12];
// The curve may ripple a little past ±12; past this it's clipped rather than drawn off the panel.
const CURVE_LIMIT_DB = EQ_MAX_DB + 2;

const bandLabel = (hz: number): string => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);
const dbLabel = (db: number): string => (db > 0 ? `+${db}` : db < 0 ? `−${-db}` : '0');
const yFor = (db: number): number => ((EQ_MAX_DB - db) / (2 * EQ_MAX_DB)) * FADER_H;

const curveSvgSx = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  // A line sitting on ±12 would otherwise lose half its stroke at the edge.
  overflow: 'visible',
} as const;

const EqualizerDialog: React.FC<EqualizerDialogProps> = ({ open, onClose, notice }) => {
  const theme = useTheme();
  const [eq, setEq] = useState<EqualizerSettings>(getEqualizerSettings);

  useEffect(() => {
    if (open) setEq(getEqualizerSettings());
  }, [open]);

  const save = (next: EqualizerSettings): void => {
    setEq(next);
    setEqualizerSettings(next);
  };

  // Touching a band or a preset means the user wants to hear it.
  const withBand = (index: number, db: number): EqualizerSettings => ({
    ...eq,
    enabled: true,
    preset: 'custom',
    gains: eq.gains.map((g, i) => (i === index ? db : g)),
  });

  const withBass = (bass: number): EqualizerSettings => ({ ...eq, enabled: true, bass });

  const curve = useMemo(() => {
    // CURVE_FREQS share the columns' half-band margins, so point k sits at x = k / last.
    const bass = bassDb(eq.bass, CURVE_FREQS);
    const db = eq.enabled
      ? responseDb(solveGains(eq.gains), CURVE_FREQS).map((v, k) => v + bass[k])
      : CURVE_FREQS.map(() => 0);
    const last = CURVE_FREQS.length - 1;
    const pts = db.map((v, k) => {
      const clamped = Math.max(-CURVE_LIMIT_DB, Math.min(CURVE_LIMIT_DB, v));
      return `${(k / last) * 1000},${yFor(clamped)}`;
    });
    return {
      line: `M${pts.join(' L')}`,
      fill: `M0,${yFor(0)} L${pts.join(' L')} L1000,${yFor(0)} Z`,
    };
  }, [eq.enabled, eq.gains, eq.bass]);

  const accent = theme.palette.primary.main;
  const activePreset = EQ_PRESETS[eq.preset] ? eq.preset : 'custom';
  const unsupported = Boolean(notice);
  const dimmed = !eq.enabled || unsupported;

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Equalizer"
      headerAction={
        <XTSwitch
          checked={eq.enabled}
          disabled={unsupported}
          onChange={(_, enabled) => save({ ...eq, enabled })}
          inputProps={{ 'aria-label': 'Equalizer on' }}
        />
      }
      maxWidth="md"
      // A thumb's hover halo pokes past the edge faders and would scroll the dialog sideways.
      contentSx={{ overflowX: 'hidden' }}
      actions={
        <>
          <Button
            disabled={unsupported}
            onClick={() => save({ ...DEFAULT_EQUALIZER_SETTINGS, enabled: eq.enabled })}
          >
            Reset
          </Button>
          <Button variant="contained" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ py: 1 }}>
        {notice && <Alert severity="info">{notice}</Alert>}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {Object.entries(EQ_PRESETS).map(([key, { label }]) => (
            <Chip
              key={key}
              label={label}
              clickable
              disabled={unsupported}
              color={activePreset === key ? 'primary' : 'default'}
              variant={activePreset === key ? 'filled' : 'outlined'}
              onClick={() =>
                save({ ...eq, enabled: true, preset: key, gains: EQ_PRESETS[key].gains })
              }
            />
          ))}
          {activePreset === 'custom' && <Chip label="Custom" color="primary" />}
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            opacity: dimmed ? 0.45 : 1,
            transition: 'opacity 200ms',
          }}
        >
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              bgcolor: 'surfaces.well',
              borderRadius: 1,
              px: { xs: 1, sm: 2 },
              pt: 2,
              pb: 1.5,
            }}
          >
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Box sx={{ position: 'relative', width: 24, flexShrink: 0, mt: 3, height: FADER_H }}>
                {GRID_DB.filter(db => db % 12 === 0).map(db => (
                  <Typography
                    key={db}
                    variant="caption"
                    color="text.disabled"
                    sx={{
                      position: 'absolute',
                      right: 0,
                      top: yFor(db),
                      transform: 'translateY(-50%)',
                      fontVariantNumeric: 'tabular-nums',
                      lineHeight: 1,
                    }}
                  >
                    {dbLabel(db)}
                  </Typography>
                ))}
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', height: 24, alignItems: 'flex-start' }}>
                  {EQ_BANDS.map((hz, i) => (
                    <Typography
                      key={hz}
                      variant="caption"
                      align="center"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color: eq.gains[i] ? accent : 'text.disabled',
                      }}
                    >
                      {dbLabel(eq.gains[i])}
                    </Typography>
                  ))}
                </Box>

                <Box sx={{ position: 'relative', height: FADER_H }}>
                  <Box
                    component="svg"
                    viewBox={`0 0 1000 ${FADER_H}`}
                    preserveAspectRatio="none"
                    aria-hidden
                    sx={curveSvgSx}
                  >
                    <defs>
                      <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                        <stop offset="50%" stopColor={accent} stopOpacity={0.06} />
                        <stop offset="100%" stopColor={accent} stopOpacity={0.35} />
                      </linearGradient>
                    </defs>
                    {GRID_DB.map(db => (
                      <line
                        key={db}
                        x1={0}
                        x2={1000}
                        y1={yFor(db)}
                        y2={yFor(db)}
                        stroke={alpha(theme.palette.text.primary, db === 0 ? 0.22 : 0.08)}
                        strokeDasharray={db === 0 ? undefined : '6 8'}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <path d={curve.fill} fill="url(#eq-fill)" />
                  </Box>

                  <Box sx={{ position: 'relative', display: 'flex', height: '100%' }}>
                    {EQ_BANDS.map((hz, i) => (
                      <Box
                        key={hz}
                        sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}
                      >
                        <XTFader
                          value={eq.gains[i]}
                          min={-EQ_MAX_DB}
                          max={EQ_MAX_DB}
                          origin={0}
                          step={1}
                          disabled={unsupported}
                          sx={{ height: FADER_H, '& .MuiSlider-thumb': { zIndex: 2 } }}
                          aria-label={`${bandLabel(hz)} Hz`}
                          onChange={(_, v) => {
                            const next = withBand(i, v as number);
                            setEq(next);
                            previewEqualizer(next);
                          }}
                          onChangeCommitted={(_, v) =>
                            setEqualizerSettings(withBand(i, v as number))
                          }
                        />
                      </Box>
                    ))}
                  </Box>

                  {/* The glass rails are opaque, so the line goes over them and under the thumbs. */}
                  <Box
                    component="svg"
                    viewBox={`0 0 1000 ${FADER_H}`}
                    preserveAspectRatio="none"
                    aria-hidden
                    sx={{ ...curveSvgSx, zIndex: 1, pointerEvents: 'none' }}
                  >
                    <path
                      d={curve.line}
                      fill="none"
                      stroke={accent}
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', mt: 1.5 }}>
                  {EQ_BANDS.map(hz => (
                    <Typography
                      key={hz}
                      variant="caption"
                      color="text.secondary"
                      align="center"
                      sx={{ flex: 1, minWidth: 0 }}
                    >
                      {bandLabel(hz)}
                    </Typography>
                  ))}
                </Box>
              </Box>
            </Box>
          </Box>

          <Box
            sx={{
              width: { xs: '100%', sm: 120 },
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.5,
              textAlign: 'center',
            }}
          >
            <XTKnob
              size={104}
              value={eq.bass}
              min={0}
              max={BASS_MAX_DB}
              aria-label="Bass boost"
              getAriaValueText={v => `${dbLabel(v)} dB`}
              disabled={unsupported}
              onChange={v => {
                const next = withBass(v);
                setEq(next);
                previewEqualizer(next);
              }}
              onChangeCommitted={v => setEqualizerSettings(withBass(v))}
            />
            <Box>
              <Typography variant="caption" component="div" color="text.secondary">
                Bass boost
              </Typography>
              <Typography
                variant="caption"
                component="div"
                sx={{
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: eq.bass ? accent : 'text.disabled',
                }}
              >
                {dbLabel(eq.bass)} dB
              </Typography>
            </Box>
          </Box>
        </Box>
      </Stack>
    </AppDialog>
  );
};

export default EqualizerDialog;
