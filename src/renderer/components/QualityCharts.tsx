/**
 * The Quality Report's charts, drawn with ECharts. The options are built in
 * qualityChartOptions.ts; these components resolve theme colours and mount them.
 */
import React, { Suspense, useMemo } from 'react';
import { alpha, Box, Skeleton, Stack, Typography, useTheme } from '@mui/material';
import type { EChartsCoreOption } from 'echarts/core';
import { LabelText } from './SongInfoDialog';
import {
  bitDepthOption,
  correlationOption,
  goniometerOption,
  histogramOption,
  spectrogramOption,
  spectrogramPixels,
  spectrumCompareOption,
  spectrumOption,
  waveformOption,
  type ChartColors,
  type Focus,
} from '../utils/qualityChartOptions';
import {
  BAND_HZ,
  SPECTRUM_SIZE,
  type FileFormat,
  type IssueKind,
  type QualityMetrics,
  type TrackVisuals,
} from '../utils/qualityCheck';

// Every track's right-click menu imports this file through the report dialog,
// so ECharts loads on first use rather than with the app.
const EChart = React.lazy(() => import('./EChart'));

export type { Focus };

export type ChartView = 'spectrum' | 'waveform' | 'spectrogram' | 'stereo' | 'samples';

export const CHART_VIEWS: ChartView[] = [
  'spectrum',
  'waveform',
  'spectrogram',
  'stereo',
  'samples',
];

export const CHART_LABEL: Record<ChartView, string> = {
  spectrum: 'Spectrum',
  waveform: 'Waveform',
  spectrogram: 'Spectrogram',
  stereo: 'Stereo',
  samples: 'Sample levels',
};

/** The chart that shows each issue, for jumping there from the report. */
export const ISSUE_VIEW: Record<IssueKind, ChartView> = {
  upscaled: 'spectrum',
  lowBitrate: 'spectrogram',
  clipping: 'waveform',
  loudMaster: 'waveform',
  truncated: 'waveform',
  silence: 'waveform',
  monoAsStereo: 'stereo',
  dcOffset: 'waveform',
  paddedBits: 'samples',
};

export const ISSUE_FOCUS: Record<IssueKind, Focus | null> = {
  upscaled: 'cutoff',
  lowBitrate: null,
  clipping: 'clipping',
  loudMaster: 'peak',
  truncated: 'length',
  silence: 'silence',
  monoAsStereo: 'channels',
  dcOffset: 'dcOffset',
  paddedBits: null,
};

export const kHz = (hz: number) => `${(hz / 1000).toFixed(1)} kHz`;

function useChartColors(): ChartColors {
  const theme = useTheme();
  return useMemo(
    () => ({
      paper: theme.palette.background.paper,
      primary: theme.palette.primary.main,
      dark: theme.palette.mode === 'dark',
      text: theme.palette.text.primary,
      ink: theme.palette.text.secondary,
      divider: theme.palette.divider,
      faint: alpha(theme.palette.text.primary, 0.08),
      error: theme.palette.error.main,
      warning: theme.palette.warning.main,
    }),
    [theme]
  );
}

function Chart({ option, height }: { option: EChartsCoreOption; height: number }) {
  return (
    <Suspense fallback={<Skeleton variant="rounded" height={height} />}>
      <EChart option={option} height={height} />
    </Suspense>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
      {children}
    </Typography>
  );
}

const ZOOM_HINT =
  'Ctrl + scroll or pinch to zoom in time; drag the slider to move along the track.';

interface ChartProps {
  metrics: QualityMetrics;
  format: FileFormat | null;
  visuals: TrackVisuals;
}

export function SpectrumCompareChart({
  a,
  b,
}: {
  a: { name: string; metrics: QualityMetrics };
  b: { name: string; metrics: QualityMetrics };
}) {
  const colors = useChartColors();
  const option = useMemo(() => {
    const input = ({ name, metrics }: typeof a) => ({
      name,
      s: {
        spectrum: metrics.spectrum,
        bandHz: BAND_HZ,
        nyquist: metrics.decodeRate / 2,
        cutoffHz: metrics.cutoffHz,
      },
    });
    return spectrumCompareOption([input(a), input(b)], colors);
  }, [a, b, colors]);
  return <Chart option={option} height={220} />;
}

export function SpectrumChart({
  metrics,
  visuals,
  focus,
}: {
  metrics: QualityMetrics;
  visuals: TrackVisuals;
  focus: Focus | null;
}) {
  const colors = useChartColors();
  const option = useMemo(
    () =>
      spectrumOption(
        {
          db: visuals.spectrum,
          binHz: metrics.decodeRate / SPECTRUM_SIZE,
          nyquist: metrics.decodeRate / 2,
          cutoffHz: metrics.cutoffHz,
        },
        focus,
        colors
      ),
    [metrics, visuals, focus, colors]
  );
  return <Chart option={option} height={250} />;
}

export function WaveformChart({
  metrics,
  format,
  visuals,
  focus,
}: ChartProps & { focus: Focus | null }) {
  const colors = useChartColors();
  const duration = format?.duration || metrics.decodedS;
  const option = useMemo(
    () => waveformOption({ ...metrics, ...visuals, duration }, focus, colors),
    [metrics, visuals, duration, focus, colors]
  );
  return (
    <Box>
      <Chart option={option} height={250} />
      <Caption>{ZOOM_HINT}</Caption>
    </Box>
  );
}

export function SpectrogramChart({ metrics, format, visuals }: ChartProps) {
  const colors = useChartColors();
  const duration = format?.duration || metrics.decodedS;
  const option = useMemo(() => {
    const input = {
      db: visuals.spectrogram,
      slices: visuals.slices,
      bands: metrics.spectrum.length,
      bandHz: BAND_HZ,
      duration,
      decodedS: metrics.decodedS,
      cutoffHz: metrics.cutoffHz,
    };
    const { pixels, width, height } = spectrogramPixels(input, colors);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0);
    return spectrogramOption(input, colors, canvas);
  }, [visuals, metrics, duration, colors]);
  return (
    <Box>
      <Chart option={option} height={250} />
      <Caption>{ZOOM_HINT}</Caption>
    </Box>
  );
}

export function StereoChart({ metrics, format, visuals }: ChartProps) {
  const colors = useChartColors();
  const duration = format?.duration || metrics.decodedS;
  const { correlation, goniometer } = visuals;
  const options = useMemo(
    () =>
      correlation && goniometer
        ? {
            correlation: correlationOption({ correlation, duration }, colors),
            goniometer: goniometerOption(goniometer, colors),
          }
        : null,
    [correlation, goniometer, duration, colors]
  );
  if (!options) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
        Mono file: there is only one channel to compare.
      </Typography>
    );
  }
  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <LabelText>Correlation</LabelText>
          <Chart option={options.correlation} height={200} />
        </Box>
        <Box sx={{ width: 200, flexShrink: 0 }}>
          <LabelText>Goniometer</LabelText>
          <Chart option={options.goniometer} height={200} />
        </Box>
      </Stack>
      <Caption>A vertical line in the goniometer is mono; a wide cloud is wide stereo.</Caption>
    </Box>
  );
}

export function SamplesChart({ visuals, ceiling }: ChartProps & { ceiling: boolean }) {
  const colors = useChartColors();
  const { histogram, bitsUsed } = visuals;
  const options = useMemo(
    () => ({
      histogram: histogramOption({ histogram, ceiling }, colors),
      bitDepth: bitsUsed ? bitDepthOption(bitsUsed, colors) : null,
    }),
    [histogram, bitsUsed, ceiling, colors]
  );
  const usedBits = bitsUsed?.filter(v => v > 0.001).length ?? 0;
  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <LabelText>Histogram</LabelText>
          <Chart option={options.histogram} height={200} />
          <Caption>
            How often each sample value occurs, from −1 to +1 (full scale). Music piles up near 0
            and thins out towards the edges. Bars standing up at the edges are samples pressed
            against the ceiling, the mark of a very loud master; whether they were clipped shows in
            the Waveform tab.
          </Caption>
        </Box>
        <Box sx={{ width: { sm: 240 }, flexShrink: 0 }}>
          <LabelText>Bit depth</LabelText>
          {options.bitDepth && bitsUsed ? (
            <>
              <Typography variant="caption" color="text.secondary">
                {usedBits} of {bitsUsed.length} bits in use
              </Typography>
              <Chart option={options.bitDepth} height={180} />
              <Caption>
                One bar per bit, most significant first. A dashed bit is never used: a 24-bit file
                with its last eight empty is 16-bit audio padded out.
              </Caption>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Lossy formats decode to floating point, so bit depth doesn't apply.
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
