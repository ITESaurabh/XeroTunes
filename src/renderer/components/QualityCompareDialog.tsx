/**
 * Two files checked side by side, for "is this a worthy replacement". Opened
 * from a Quality Report with a file the user picks, and from the duplicate
 * finder with two copies of one song. Compares only; nothing is changed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AlertTitle, Box, IconButton, Skeleton, Stack, Typography } from '@mui/material';
import { Icon, type IconifyIcon } from '@iconify/react';
import dismissIcon from '@iconify/icons-fluent/dismiss-24-regular';
import checkIcon from '@iconify/icons-fluent/checkmark-circle-24-filled';
import againstIcon from '@iconify/icons-fluent/dismiss-circle-24-filled';
import noteIcon from '@iconify/icons-fluent/info-24-filled';
import AppDialog from './AppDialog';
import { LabelText, formatFileSize } from './SongInfoDialog';
import { SpectrumCompareChart, kHz } from './QualityCharts';
import { formatDuration } from '../utils/formatDuration';
import {
  compareChecks,
  compareFiles,
  ISSUE_LABEL,
  type CompareOutcome,
  type Comparison,
} from '../utils/qualityCheck';

export interface CompareFile {
  uri: string;
  /** How the verdict names it, e.g. "current file". */
  label: string;
  duration?: number | null;
}

type Checked = Comparison['a'];

const OUTCOME: Record<
  CompareOutcome,
  { severity: 'success' | 'info' | 'warning' | 'error'; headline: (a: string, b: string) => string }
> = {
  better: { severity: 'success', headline: (_a, b) => `The ${b} is better` },
  same: { severity: 'info', headline: () => 'No real difference' },
  // "Keep what you have" is an answer, not a warning.
  worse: { severity: 'info', headline: a => `The ${a} is better` },
  different: { severity: 'warning', headline: () => 'Not the same recording' },
  unreadable: { severity: 'error', headline: (_a, b) => `Couldn't read the ${b}` },
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function splitPath(uri: string) {
  const cut = Math.max(uri.lastIndexOf('\\'), uri.lastIndexOf('/'));
  return { name: uri.slice(cut + 1), folder: uri.slice(0, cut) };
}

const ROWS: { label: string; value: (c: Checked) => string }[] = [
  {
    label: 'Format',
    value: ({ format: f }) =>
      f
        ? [
            f.lossless ? 'Lossless' : 'Lossy',
            f.bitRate ? `${Math.round(f.bitRate / 1000)} kbps` : null,
            f.sampleRate ? `${f.sampleRate / 1000} kHz` : null,
            f.bitDepth ? `${f.bitDepth} bit` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : '–',
  },
  { label: 'Size', value: ({ format: f }) => (f?.size ? formatFileSize(f.size) : '–') },
  {
    label: 'Frequency cutoff',
    value: ({ metrics: m }) => (!m ? '–' : m.cutoffHz != null ? kHz(m.cutoffHz) : 'None'),
  },
  {
    label: 'Clipping',
    value: ({ metrics: m }) =>
      !m
        ? '–'
        : m.clipPpm == null
          ? 'Not measurable'
          : m.clipPpm
            ? `${m.clipPpm.toLocaleString()} per million`
            : 'None',
  },
  {
    label: 'Peak',
    value: ({ metrics: m }) =>
      m ? `${m.peakDb.toFixed(1)} dBFS · ${(m.hotPpm / 1e4).toFixed(1)}% at ceiling` : '–',
  },
  { label: 'Loudness', value: ({ metrics: m }) => (m ? `${m.lufs.toFixed(1)} LUFS` : '–') },
  { label: 'Dynamic range', value: ({ metrics: m }) => (m ? `DR${m.dynamicRange}` : '–') },
  { label: 'Length', value: ({ metrics: m }) => (m ? formatDuration(m.decodedS) : '–') },
  {
    label: 'Issues',
    value: c =>
      c.error ? "Couldn't read" : c.issues.map(i => ISSUE_LABEL[i.kind]).join(', ') || 'None',
  },
];

const FAVOURS: Record<'a' | 'b' | 'note', { icon: IconifyIcon; color: string }> = {
  b: { icon: checkIcon, color: 'success.main' },
  a: { icon: againstIcon, color: 'error.main' },
  note: { icon: noteIcon, color: 'text.secondary' },
};

interface QualityCompareDialogProps {
  open: boolean;
  onClose: () => void;
  /** The file being kept or replaced. */
  a: CompareFile | null;
  /** The file it's weighed against. */
  b: CompareFile | null;
}

export default function QualityCompareDialog({ open, onClose, a, b }: QualityCompareDialogProps) {
  // Callers clear the files as they close it, while the dialog is still
  // animating out; drawing the last pair keeps it from flashing empty. Keyed on
  // the paths: callers pass fresh objects on every render, and each new pair
  // means decoding both files again.
  const key = a && b ? `${a.uri}\n${b.uri}` : null;
  const [held, setHeld] = useState<{ key: string; files: [CompareFile, CompareFile] } | null>(null);
  if (key && a && b && key !== held?.key) setHeld({ key, files: [a, b] });
  const files = held?.files ?? null;
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !held) return;
    let live = true;
    setResult(null);
    setError(null);
    compareFiles(held.files[0], held.files[1])
      .then(r => live && setResult(r))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [open, held]);

  const names = useMemo<[string, string]>(
    () => (files ? [files[0].label, files[1].label] : ['', '']),
    [files]
  );
  const verdict = result ? compareChecks(result.a, result.b, result.match, names) : null;

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Compare"
      maxWidth="md"
      headerAction={
        <IconButton onClick={onClose} aria-label="Close">
          <Icon icon={dismissIcon} width={20} />
        </IconButton>
      }
    >
      {files && (
        <Stack spacing={2}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 1,
            }}
          >
            {files.map(f => {
              const { name, folder } = splitPath(f.uri);
              return (
                <Box
                  key={f.label}
                  sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', minWidth: 0 }}
                >
                  <LabelText>{f.label}</LabelText>
                  <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
                    {name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {folder}
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {error ? (
            <Alert severity="error">{error}</Alert>
          ) : !result || !verdict ? (
            <Box>
              <Skeleton variant="rounded" height={120} />
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ mt: 0.75 }}
              >
                Decoding both files…
              </Typography>
            </Box>
          ) : (
            <>
              <Alert severity={OUTCOME[verdict.outcome].severity}>
                <AlertTitle>{OUTCOME[verdict.outcome].headline(names[0], names[1])}</AlertTitle>
                <Stack spacing={0.75}>
                  {verdict.reasons.map(r => {
                    const look = FAVOURS[r.favours ?? 'note'];
                    return (
                      <Stack key={r.text} direction="row" spacing={1} alignItems="flex-start">
                        <Box sx={{ display: 'flex', color: look.color, mt: '2px', flexShrink: 0 }}>
                          <Icon icon={look.icon} width={16} />
                        </Box>
                        <Typography variant="body2">{r.text}</Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              </Alert>

              {result.a.metrics && result.b.metrics && (
                <Box>
                  <LabelText>Spectrum</LabelText>
                  <SpectrumCompareChart
                    a={{ name: capitalise(names[0]), metrics: result.a.metrics }}
                    b={{ name: capitalise(names[1]), metrics: result.b.metrics }}
                  />
                </Box>
              )}

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(96px, auto) 1fr 1fr',
                  columnGap: 2,
                  rowGap: 1,
                  alignItems: 'baseline',
                }}
              >
                <span />
                <LabelText>{names[0]}</LabelText>
                <LabelText>{names[1]}</LabelText>
                {ROWS.map(row => (
                  <React.Fragment key={row.label}>
                    <LabelText>{row.label}</LabelText>
                    <Typography variant="body2">{row.value(result.a)}</Typography>
                    <Typography variant="body2">{row.value(result.b)}</Typography>
                  </React.Fragment>
                ))}
              </Box>
            </>
          )}
        </Stack>
      )}
    </AppDialog>
  );
}
