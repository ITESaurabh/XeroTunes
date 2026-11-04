import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon, type IconifyIcon } from '@iconify/react';
import { useLocation } from 'react-router';
import dismiss24Regular from '@iconify/icons-fluent/dismiss-24-regular';
import checkmarkCircleIcon from '@iconify/icons-fluent/checkmark-circle-24-filled';
import warningIcon from '@iconify/icons-fluent/warning-24-filled';
import errorCircleIcon from '@iconify/icons-fluent/error-circle-24-filled';
import questionCircleIcon from '@iconify/icons-fluent/question-circle-24-regular';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import revealIcon from '@iconify/icons-fluent/folder-arrow-right-24-regular';
import refreshIcon from '@iconify/icons-fluent/arrow-clockwise-24-regular';
import compareIcon from '@iconify/icons-fluent/scales-24-regular';
import AppDialog from './AppDialog';
import QualityCompareDialog from './QualityCompareDialog';
import Empty from './Empty';
import { LabelText, formatFileSize } from './SongInfoDialog';
import {
  CHART_LABEL,
  CHART_VIEWS,
  ISSUE_FOCUS,
  ISSUE_VIEW,
  SamplesChart,
  SpectrogramChart,
  SpectrumChart,
  StereoChart,
  WaveformChart,
  kHz,
  type ChartView,
  type Focus,
} from './QualityCharts';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { formatDate, formatDuration } from '../utils/formatDuration';
import {
  ISSUE_LABEL,
  loadVisuals,
  qualityScan,
  useQualityReport,
  type IssueKind,
  type QualityMetrics,
  type QualityReport,
  type TrackVisuals,
  type Verdict,
} from '../utils/qualityCheck';

type StatusColor = 'success' | 'warning' | 'error' | 'info';

export const VERDICT: Record<
  Verdict,
  { label: string; headline: string; color: StatusColor; icon: IconifyIcon; rank: number }
> = {
  problem: {
    label: 'Problem',
    headline: 'Problem found',
    color: 'error',
    icon: errorCircleIcon,
    rank: 0,
  },
  unreadable: {
    label: "Couldn't read",
    headline: "Couldn't read this file",
    color: 'info',
    icon: questionCircleIcon,
    rank: 1,
  },
  warning: {
    label: 'Worth a look',
    headline: 'Worth a look',
    color: 'warning',
    icon: warningIcon,
    rank: 2,
  },
  good: {
    label: 'Good',
    headline: 'No problems found',
    color: 'success',
    icon: checkmarkCircleIcon,
    rank: 3,
  },
};

const extOf = (t: Track) =>
  String(t.Extension ?? '')
    .replace('.', '')
    .toUpperCase();

export const formatShort = (r: QualityReport): string =>
  [
    extOf(r),
    r.format?.bitRate ? `${Math.round(r.format.bitRate / 1000).toLocaleString()} kbps` : null,
  ]
    .filter(Boolean)
    .join(' · ');

export const cutoffLabel = (r: QualityReport): string =>
  !r.metrics ? '' : r.metrics.cutoffHz != null ? kHz(r.metrics.cutoffHz) : 'No cutoff';

function formatLine(r: QualityReport): string {
  const f = r.format;
  if (!f) return extOf(r);
  return [
    extOf(r),
    f.sampleRate ? `${f.sampleRate} Hz` : null,
    f.bitDepth ? `${f.bitDepth} bit` : null,
    f.channels === 2 ? 'Stereo' : f.channels === 1 ? 'Mono' : f.channels ? `${f.channels}ch` : null,
    f.bitRate ? `${Math.round(f.bitRate / 1000)} kbps` : null,
    f.size ? formatFileSize(f.size) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexShrink: 0, color: `${v.color}.main` }}>
        <Icon icon={v.icon} width={18} />
      </Box>
      <Typography variant="body2" noWrap>
        {v.label}
      </Typography>
    </Stack>
  );
}

function SeverityIcon({ severity, size }: { severity: 'warning' | 'problem'; size: number }) {
  return (
    <Box sx={{ display: 'flex', color: severity === 'problem' ? 'error.main' : 'warning.main' }}>
      <Icon icon={severity === 'problem' ? errorCircleIcon : warningIcon} width={size} />
    </Box>
  );
}

/** A measurement tile; tapping it opens its chart with the measurement marked on it. */
function Metric({
  label,
  value,
  flag,
  active,
  onClick,
}: {
  label: string;
  value: string;
  flag?: 'warning' | 'problem';
  /** Picked out on the chart right now. */
  active: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={active}
      sx={{
        display: 'block',
        textAlign: 'left',
        p: 1.5,
        borderRadius: 1,
        border: '2px solid',
        borderColor: active ? 'primary.main' : 'transparent',
        bgcolor: active ? 'surfaces.selection' : 'action.hover',
        '&:hover': { bgcolor: active ? 'surfaces.selection' : 'action.selected' },
      }}
    >
      <LabelText>{label}</LabelText>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5 }}>
        {flag && <SeverityIcon severity={flag} size={16} />}
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {value}
        </Typography>
      </Stack>
    </ButtonBase>
  );
}

function ChartLoading() {
  return (
    <Box>
      <Skeleton variant="rounded" height={250} />
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
        Decoding the track…
      </Typography>
    </Box>
  );
}

/** Decoded on open rather than stored by the scan. */
function useVisuals(report: QualityReport) {
  const [visuals, setVisuals] = useState<TrackVisuals | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    setVisuals('loading');
    void loadVisuals(report).then(v => {
      if (live) setVisuals(v ?? 'failed');
    });
    return () => {
      live = false;
    };
  }, [report]);
  return visuals;
}

function ReportBody({ report }: { report: QualityReport }) {
  const v = VERDICT[report.verdict];
  const m = report.metrics;
  const f = report.format;
  const flag = (k: IssueKind) => report.issues.find(i => i.kind === k)?.severity;
  const truncated = !!flag('truncated');
  const visuals = useVisuals(report);
  // Opens on the chart for the first issue, so a clipping report starts on the waveform.
  const [view, setView] = useState<ChartView>(() =>
    report.issues[0] ? ISSUE_VIEW[report.issues[0].kind] : 'spectrum'
  );
  const [focus, setFocus] = useState<Focus | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const viewSeverity = (c: ChartView) => {
    const hits = report.issues.filter(i => ISSUE_VIEW[i.kind] === c);
    return hits.length ? (hits.some(i => i.severity === 'problem') ? 'problem' : 'warning') : null;
  };

  const show = (next: ChartView, nextFocus: Focus | null) => {
    setView(next);
    setFocus(nextFocus);
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const tiles = (
    m: QualityMetrics
  ): {
    label: string;
    value: string;
    flag?: 'warning' | 'problem';
    chart: ChartView;
    focus: Focus;
  }[] => [
    {
      label: 'Frequency cutoff',
      value: cutoffLabel(report),
      flag: flag('upscaled'),
      chart: 'spectrum',
      focus: 'cutoff',
    },
    {
      label: 'Clipping',
      value:
        m.clipPpm === undefined
          ? 'Analyse again to measure'
          : m.clipPpm === null
            ? f?.lossless
              ? 'Not measurable when resampled'
              : 'Not measurable in lossy files'
            : m.clipPpm
              ? `${m.clipPpm.toLocaleString()} per million`
              : 'None',
      flag: flag('clipping'),
      chart: 'waveform',
      focus: 'clipping',
    },
    {
      label: 'Peak',
      value: `${m.peakDb.toFixed(1)} dBFS · ${(m.hotPpm / 1e4).toFixed(1)}% at ceiling`,
      flag: flag('loudMaster'),
      chart: 'waveform',
      focus: 'peak',
    },
    {
      label: 'Loudness',
      value: `${m.lufs.toFixed(1)} LUFS`,
      chart: 'waveform',
      focus: 'loudness',
    },
    {
      label: 'Dynamic range',
      value: `DR${m.dynamicRange}`,
      chart: 'waveform',
      focus: 'dynamicRange',
    },
    {
      label: 'Length',
      value:
        truncated && f?.duration
          ? `${formatDuration(m.decodedS)} of ${formatDuration(f.duration)}`
          : formatDuration(m.decodedS),
      flag: flag('truncated'),
      chart: 'waveform',
      focus: 'length',
    },
    {
      label: 'Silence',
      value: `${m.silenceStartS.toFixed(1)} s start · ${Math.round(m.silenceEndS)} s end`,
      flag: flag('silence'),
      chart: 'waveform',
      focus: 'silence',
    },
    {
      label: 'Channels',
      value: m.monoAsStereo
        ? 'Mono as stereo'
        : f?.channels === 1
          ? 'Mono'
          : f?.channels === 2
            ? 'Stereo'
            : `${f?.channels ?? '?'} channels`,
      flag: flag('monoAsStereo'),
      chart: 'stereo',
      focus: 'channels',
    },
    {
      label: 'DC offset',
      value: `${m.dcOffsetPct.toFixed(2)}%`,
      flag: flag('dcOffset'),
      chart: 'waveform',
      focus: 'dcOffset',
    },
  ];

  const chart = (c: ChartView) => {
    if (!m) return null;
    if (visuals === 'loading') return <ChartLoading />;
    if (visuals === 'failed') {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
          This chart needs the file decoded again, and it can't be: it may have been moved, deleted
          or changed since the check. Analyse again to refresh the report.
        </Typography>
      );
    }
    const props = { metrics: m, format: f, visuals };
    if (c === 'spectrum') return <SpectrumChart metrics={m} visuals={visuals} focus={focus} />;
    if (c === 'waveform') return <WaveformChart {...props} focus={focus} />;
    if (c === 'spectrogram') return <SpectrogramChart {...props} />;
    if (c === 'stereo') return <StereoChart {...props} />;
    return <SamplesChart {...props} ceiling={!!flag('loudMaster')} />;
  };

  return (
    <>
      {f && (
        <Box sx={{ px: 1.5, py: 1.25, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {formatLine(report)}
          </Typography>
        </Box>
      )}

      <Alert
        severity={v.color}
        icon={<Icon icon={v.icon} width={22} />}
        // The message box scrolls on overflow, and the issue rows' negative
        // margin (so their hover tint lines up with the title) counts as overflow.
        sx={{ '& .MuiAlert-message': { flex: 1, overflow: 'visible' } }}
      >
        <AlertTitle>{v.headline}</AlertTitle>
        {report.error ??
          (report.issues.length ? (
            <Stack sx={{ mx: -1 }}>
              {report.issues.map(i => (
                <ButtonBase
                  key={i.kind}
                  onClick={() => show(ISSUE_VIEW[i.kind], ISSUE_FOCUS[i.kind])}
                  disabled={!m}
                  sx={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: 1,
                    px: 1,
                    py: 0.75,
                    minHeight: 44,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Typography variant="body2">
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {ISSUE_LABEL[i.kind]}.
                    </Box>{' '}
                    {i.detail}{' '}
                    <Box
                      component="span"
                      sx={{ textDecoration: 'underline', whiteSpace: 'nowrap', opacity: 0.85 }}
                    >
                      Show in {CHART_LABEL[ISSUE_VIEW[i.kind]]}
                    </Box>
                  </Typography>
                </ButtonBase>
              ))}
            </Stack>
          ) : (
            'Every check passed.'
          ))}
      </Alert>

      {m && (
        <Box ref={tabsRef}>
          <Tabs
            value={view}
            onChange={(_, next: ChartView) => show(next, null)}
            variant="scrollable"
            scrollButtons={false}
            // MUI makes any tab with an icon 72px tall, which stretches the whole row.
            sx={{
              mb: 1.5,
              borderBottom: 1,
              borderColor: 'divider',
              minHeight: 48,
              '& .MuiTab-root': { minHeight: 48 },
            }}
          >
            {CHART_VIEWS.map(c => {
              const severity = viewSeverity(c);
              return (
                <Tab
                  key={c}
                  value={c}
                  label={CHART_LABEL[c]}
                  icon={severity ? <SeverityIcon severity={severity} size={16} /> : undefined}
                  iconPosition="end"
                />
              );
            })}
          </Tabs>
          {chart(view)}
        </Box>
      )}

      {m && (
        // CSS grid, not MUI Grid: Grid's negative margin is reset by the Stack
        // around it, which shifted the cards right and past the edge.
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
            gap: 1,
          }}
        >
          {tiles(m).map(t => (
            <Metric
              key={t.focus}
              label={t.label}
              value={t.value}
              flag={t.flag}
              active={focus === t.focus}
              // A second tap clears the mark but stays on the chart.
              onClick={() => show(t.chart, focus === t.focus ? null : t.focus)}
            />
          ))}
        </Box>
      )}

      <Typography variant="caption" color="text.secondary">
        Analysed {formatDate(report.analysedAt)}
        {m ? ` · decoded at ${m.decodeRate / 1000} kHz` : ''}
      </Typography>
    </>
  );
}

interface QualityReportDialogProps {
  open: boolean;
  onClose: () => void;
  track: Track | null;
}

export default function QualityReportDialog({
  open,
  onClose,
  track: incoming,
}: QualityReportDialogProps) {
  // Callers clear the track as they close it, while the dialog is still
  // animating out; drawing the last one keeps it from flashing empty.
  const [lastTrack, setLastTrack] = useState(incoming);
  if (incoming && incoming !== lastTrack) setLastTrack(incoming);
  const track = incoming ?? lastTrack;
  const report = useQualityReport(track?.Id);
  const { dispatch } = useContext(store);
  const { invokeEventToMainProcess } = useIpc();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const uri = typeof track?.Uri === 'string' ? track.Uri : null;

  // Opened from a track's menu, the report may be in the database but not loaded yet.
  useEffect(() => {
    if (open && track) void qualityScan.ensure(track);
  }, [open, track]);

  const pickToCompare = async () => {
    const picked = (await invokeEventToMainProcess('pick-audio-file')) as {
      canceled: boolean;
      filePath?: string;
    };
    if (!picked.canceled && picked.filePath && picked.filePath !== uri) {
      setCompareWith(picked.filePath);
    }
  };

  const reveal = () => {
    if (uri) void invokeEventToMainProcess('reveal-file', { filePath: uri });
  };

  // Stays open: the point of playing from here is to listen while reading the report.
  const play = () => {
    if (!track) return;
    dispatch({
      type: 'SET_QUEUE',
      payload: { queue: [track], index: 0, source: location.pathname + location.search },
    });
    dispatch({ type: 'SET_CURR_TRACK', payload: track });
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  };

  const analyse = async () => {
    if (!track) return;
    setBusy(true);
    try {
      await qualityScan.analyseOne(track);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Quality Report"
      maxWidth="md"
      headerAction={
        <Stack direction="row">
          <Tooltip title="Compare with another file">
            <span>
              <IconButton
                aria-label="Compare with another file"
                disabled={!uri}
                onClick={() => void pickToCompare()}
              >
                <Icon icon={compareIcon} width={20} />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton onClick={onClose} aria-label="Close">
            <Icon icon={dismiss24Regular} width={20} />
          </IconButton>
        </Stack>
      }
      actions={
        <>
          <Button startIcon={<Icon icon={playIcon} />} onClick={play} disabled={!track}>
            Play
          </Button>
          <Button startIcon={<Icon icon={revealIcon} />} onClick={reveal} disabled={!uri}>
            Show in folder
          </Button>
          <Button
            variant="contained"
            startIcon={<Icon icon={refreshIcon} />}
            onClick={() => void analyse()}
            disabled={!track || busy}
          >
            {busy ? 'Analysing…' : report ? 'Analyse again' : 'Analyse now'}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
            {String(track?.Title ?? '')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {[track?.ArtistName, track?.AlbumTitle].filter(Boolean).join(' · ')}
          </Typography>
          {uri && (
            <Typography
              variant="caption"
              onClick={reveal}
              sx={{
                display: 'block',
                mt: 0.5,
                textDecoration: 'underline',
                wordBreak: 'break-all',
                opacity: 0.85,
                cursor: 'pointer',
              }}
            >
              {uri}
            </Typography>
          )}
        </Box>
        {report ? (
          // Keyed so a re-analysis starts fresh on the new report's first issue.
          <ReportBody key={report.analysedAt} report={report} />
        ) : (
          <Empty
            compact
            page="Quality Report"
            title="Not analysed yet"
            hint="Analyse this track now, or scan the whole library from Quality Check."
            sx={{ pb: 3 }}
          />
        )}
      </Stack>

      <QualityCompareDialog
        open={compareWith !== null}
        onClose={() => setCompareWith(null)}
        a={
          uri ? { uri, label: 'current file', duration: (track?.Duration as number) || null } : null
        }
        b={compareWith ? { uri: compareWith, label: 'new file' } : null}
      />
    </AppDialog>
  );
}
