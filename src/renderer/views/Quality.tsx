import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  ButtonGroup,
  Chip,
  Container,
  Grid,
  IconButton,
  LinearProgress,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { motion } from 'motion/react';
import pulseIcon from '@iconify/icons-fluent/pulse-24-regular';
import pauseIcon from '@iconify/icons-fluent/pause-24-filled';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import stopIcon from '@iconify/icons-fluent/stop-24-filled';
import chevronDownIcon from '@iconify/icons-fluent/chevron-down-24-filled';
import PageToolbar from '../components/PageToolbar';
import Empty from '../components/Empty';
import ArtistCell from '../components/ArtistCell';
import LibraryTable, { TableColumn, useLibraryTable } from '../components/LibraryTable';
import QualityReportDialog, {
  VERDICT,
  VerdictBadge,
  cutoffLabel,
  formatShort,
} from '../components/QualityReportDialog';
import { useTrackMenu } from '../components/TrackContextMenu';
import { store } from '../utils/store';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { formatDate } from '../utils/formatDuration';
import {
  ISSUE_LABEL,
  qualityScan,
  useQualityScan,
  useQualityScanField,
  type IssueKind,
  type QualityReport,
  type Verdict,
} from '../utils/qualityCheck';

const SEVERITY_COLOR = { problem: 'error', warning: 'warning' } as const;
const TILES: Verdict[] = ['problem', 'warning', 'unreadable', 'good'];

const columns: TableColumn<QualityReport>[] = [
  { label: 'Title', key: 'Title', align: 'left', flex: 3, gridWidth: 180 },
  {
    label: 'Artist',
    key: 'ArtistName',
    align: 'left',
    flex: 2,
    gridWidth: 140,
    render: r => <ArtistCell artistNameRaw={r.ArtistName as string | undefined} />,
  },
  {
    label: 'Format',
    key: 'format',
    align: 'left',
    flex: 1.5,
    gridWidth: 130,
    format: (_, r) => formatShort(r),
    sortValue: r => r.format?.bitRate ?? null,
  },
  {
    label: 'Cutoff',
    key: 'cutoff',
    align: 'right',
    flex: 1,
    gridWidth: 120,
    format: (_, r) => cutoffLabel(r),
    // No cutoff sorts above every cutoff; compareValues subtracts, so no Infinity.
    sortValue: r => (r.metrics ? (r.metrics.cutoffHz ?? 99999) : null),
  },
  {
    label: 'Issues',
    key: 'issues',
    align: 'left',
    flex: 3,
    gridWidth: 220,
    format: (_, r) => r.issues.map(i => ISSUE_LABEL[i.kind]).join(', '),
    sortValue: r => r.issues.length,
    render: r => (
      <Stack direction="row" spacing={0.5} sx={{ overflow: 'hidden' }}>
        {r.issues.map(i => (
          <Chip
            key={i.kind}
            size="small"
            variant="outlined"
            color={SEVERITY_COLOR[i.severity]}
            label={ISSUE_LABEL[i.kind]}
          />
        ))}
      </Stack>
    ),
  },
  {
    label: 'Verdict',
    key: 'verdict',
    align: 'left',
    flex: 1.3,
    gridWidth: 150,
    format: (_, r) => VERDICT[r.verdict].label,
    sortValue: r => VERDICT[r.verdict].rank,
    render: r => <VerdictBadge verdict={r.verdict} />,
  },
];

function VerdictTile({
  verdict,
  count,
  selected,
  onClick,
}: {
  verdict: Verdict;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  const v = VERDICT[verdict];
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={selected}
      sx={{
        flex: '1 1 150px',
        justifyContent: 'flex-start',
        gap: 1.5,
        px: 2,
        py: 1.5,
        minHeight: 64,
        textAlign: 'left',
        borderRadius: 1,
        border: '2px solid',
        borderColor: selected ? 'primary.main' : theme => alpha(theme.palette.text.primary, 0.08),
        bgcolor: selected ? 'surfaces.selection' : 'transparent',
      }}
    >
      <Box sx={{ display: 'flex', color: `${v.color}.main` }}>
        <Icon icon={v.icon} width={28} />
      </Box>
      <Box>
        <Typography variant="h6" sx={{ lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
          {count.toLocaleString()}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {v.label}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

const n = (v: number) => v.toLocaleString();

/** Re-renders after every scanned track, so it stays apart from the table. */
function ScanAction() {
  const scan = useQualityScan();
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const paused = scan.status === 'paused';
  if (scan.status === 'idle') {
    // Only the tracks without a current report; once all have one, everything again.
    return (
      <>
        <ButtonGroup variant="contained" disabled={!scan.tracks}>
          <Button
            startIcon={<Icon icon={pulseIcon} />}
            onClick={() => qualityScan.start(!scan.unchecked)}
          >
            {scan.unchecked ? 'Scan library' : 'Scan again'}
          </Button>
          <Button
            size="small"
            aria-label="More scan options"
            aria-haspopup="menu"
            aria-expanded={menuAt ? 'true' : undefined}
            onClick={e => setMenuAt(e.currentTarget)}
          >
            <Icon icon={chevronDownIcon} width="1rem" />
          </Button>
        </ButtonGroup>
        <Menu
          anchorEl={menuAt}
          open={!!menuAt}
          onClose={() => setMenuAt(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            onClick={() => {
              setMenuAt(null);
              qualityScan.start(true);
            }}
          >
            <ListItemText primary="Re-check every track" secondary="Ignores the saved reports" />
          </MenuItem>
        </Menu>
      </>
    );
  }
  return (
    <Stack direction="row" spacing={0.5}>
      <Tooltip title={paused ? 'Resume scan' : 'Pause scan'}>
        <span>
          <IconButton
            aria-label={paused ? 'Resume scan' : 'Pause scan'}
            onClick={paused ? qualityScan.resume : qualityScan.pause}
          >
            <Icon icon={paused ? playIcon : pauseIcon} width={24} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Stop scan">
        <span>
          <IconButton aria-label="Stop scan" onClick={qualityScan.stop}>
            <Icon icon={stopIcon} width={24} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

function ScanStatus() {
  const scan = useQualityScan();
  const paused = scan.status === 'paused';
  const lastChecked = scan.reports.reduce((at, r) => Math.max(at, r.analysedAt), 0);
  const line =
    scan.status !== 'idle'
      ? `${paused ? 'Paused at' : 'Analysing'} ${n(scan.done)} of ${n(scan.total)}${
          !paused && scan.current ? ` · ${scan.current}` : ''
        }`
      : [
          `${n(scan.reports.length)} of ${n(scan.tracks)} tracks checked`,
          scan.unchecked ? `${n(scan.unchecked)} to check` : null,
          lastChecked ? `last check ${formatDate(lastChecked)}` : null,
          scan.streamed ? `${n(scan.streamed)} streamed tracks can't be checked` : null,
        ]
          .filter(Boolean)
          .join(' · ');
  return (
    <Box>
      {scan.status !== 'idle' && (
        <LinearProgress
          variant="determinate"
          value={scan.total ? (scan.done / scan.total) * 100 : 0}
          sx={{ borderRadius: 2, height: 4, mb: 0.75 }}
        />
      )}
      <Typography variant="caption" color="text.secondary" component="div" noWrap>
        {line}
      </Typography>
    </Box>
  );
}

const Quality: React.FC = () => {
  const { state, dispatch } = useContext(store);
  const reports = useQualityScanField('reports');
  const loaded = useQualityScanField('loaded');
  const running = useQualityScanField('status') !== 'idle';
  const [shown, setShown] = useState<Set<Verdict>>(
    () => new Set<Verdict>(['problem', 'warning', 'unreadable'])
  );
  const [issue, setIssue] = useState<IssueKind | null>(null);
  const [reportOf, setReportOf] = useState<QualityReport | null>(null);
  const { openTrackMenu, trackMenu } = useTrackMenu();
  const scrollHide = useScrollHidePlayerBar();

  // Every visit re-reads the library, so tracks added or removed since show up.
  useEffect(() => {
    void qualityScan.load();
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const counts = useMemo(() => {
    const verdicts: Record<Verdict, number> = { good: 0, warning: 0, problem: 0, unreadable: 0 };
    const issues = new Map<IssueKind, number>();
    for (const r of reports) {
      verdicts[r.verdict]++;
      if (!shown.has(r.verdict)) continue;
      for (const i of r.issues) issues.set(i.kind, (issues.get(i.kind) ?? 0) + 1);
    }
    return { verdicts, issues };
  }, [reports, shown]);

  const filtered = useMemo(
    () =>
      reports.filter(r => shown.has(r.verdict) && (!issue || r.issues.some(i => i.kind === issue))),
    [reports, shown, issue]
  );
  const { rows, view } = useLibraryTable(filtered, columns, { key: 'verdict', dir: 'asc' });

  const toggleVerdict = (v: Verdict) =>
    setShown(prev => {
      const next = new Set(prev);
      if (!next.delete(v)) next.add(v);
      return next;
    });

  if (!loaded)
    return (
      <div>
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </div>
    );

  if (!reports.length && !running)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Quality Check" action={<ScanAction />} />
        <Empty
          page="Quality Check"
          title="Nothing analysed yet"
          hint="Scan library reads every local file and looks for upscaled audio, clipping, and tracks that are cut short or damaged. Your files are never changed."
        />
      </Box>
    );

  return (
    <Grid
      component={motion.div}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      transition={{ duration: 0.3 }}
      item
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <PageToolbar title="Quality Check" action={<ScanAction />} />
      <Container
        maxWidth={false}
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Stack spacing={1.5} sx={{ py: 1.5, flexShrink: 0 }}>
          <ScanStatus />

          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1.5}>
            {TILES.map(v => (
              <VerdictTile
                key={v}
                verdict={v}
                count={counts.verdicts[v]}
                selected={shown.has(v)}
                onClick={() => toggleVerdict(v)}
              />
            ))}
          </Stack>

          {(counts.issues.size > 0 || issue) && (
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
              {(Object.keys(ISSUE_LABEL) as IssueKind[])
                // The active chip stays even at 0, or its filter couldn't be turned off.
                .filter(k => counts.issues.has(k) || k === issue)
                .map(k => (
                  <Chip
                    key={k}
                    label={`${ISSUE_LABEL[k]} · ${n(counts.issues.get(k) ?? 0)}`}
                    clickable
                    color={issue === k ? 'primary' : 'default'}
                    variant={issue === k ? 'filled' : 'outlined'}
                    onClick={() => setIssue(issue === k ? null : k)}
                    // Touch-first: a stock chip is 32px tall.
                    sx={{ height: 40, borderRadius: 20, px: 0.5 }}
                  />
                ))}
            </Stack>
          )}
        </Stack>

        {filtered.length ? (
          <LibraryTable
            rows={rows}
            columns={columns}
            getRowId={r => r.Id}
            view={view}
            isRowActive={r => r.Id === state.track?.Id}
            onRowClick={r => setReportOf(r)}
            onRowContextMenu={(r, e) => openTrackMenu(e, r)}
            onScroll={scrollHide}
          />
        ) : (
          <Empty
            compact
            page="Quality Check"
            title={shown.size ? 'Nothing here' : 'Pick a category above'}
            hint={
              shown.size
                ? running
                  ? 'Tracks show up as the scan reaches them.'
                  : 'No analysed track matches these filters.'
                : undefined
            }
          />
        )}
      </Container>

      {trackMenu}

      <QualityReportDialog
        open={reportOf !== null}
        onClose={() => setReportOf(null)}
        track={reportOf}
      />
    </Grid>
  );
};

export default Quality;
