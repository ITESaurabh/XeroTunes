import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Skeleton,
  Stack,
  Divider,
  Grid,
  Tabs,
  Tab,
} from '@mui/material';
import { Icon } from '@iconify/react';
import dismiss24Regular from '@iconify/icons-fluent/dismiss-24-regular';
import AppDialog from './AppDialog';
import { parseFile } from 'music-metadata';
import type { IAudioMetadata } from 'music-metadata';
import { Track } from '../utils/store';

const { ipcRenderer } = window.require('electron');

interface DbTrackInfo {
  PlayedTimes: number;
  LastPlayedAt: number | null;
}

interface SongInfoDialogProps {
  open: boolean;
  onClose: () => void;
  track: Track | null;
  songPath: string | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} kB`;
}

function formatArtFormat(format: string): string {
  return (format.includes('/') ? format.split('/')[1] : format).toUpperCase();
}

function sanitizeForDisplay(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `<binary: ${value.byteLength.toLocaleString()} bytes>`;
  }
  if (typeof value === 'string' && value.length > 300) {
    return `<string: ${value.length.toLocaleString()} chars>`;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForDisplay);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeForDisplay(v)])
    );
  }
  return value;
}

const LabelText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography
    variant="caption"
    sx={{
      fontWeight: 700,
      opacity: 0.6,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      display: 'block',
    }}
  >
    {children}
  </Typography>
);

const ValueText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
    {children || '-'}
  </Typography>
);

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <>
      <Grid item xs={4}>
        <LabelText>{label}</LabelText>
      </Grid>
      <Grid item xs={8}>
        <ValueText>{value}</ValueText>
      </Grid>
    </>
  );
}

export default function SongInfoDialog({ open, onClose, track, songPath }: SongInfoDialogProps) {
  const [metadata, setMetadata] = useState<IAudioMetadata | null>(null);
  const [dbInfo, setDbInfo] = useState<DbTrackInfo | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (!open || !songPath) return;

    let cancelled = false;
    setLoading(true);
    setMetadata(null);
    setDbInfo(null);
    setFileSize(null);

    (async () => {
      const [meta, db] = await Promise.all([
        parseFile(songPath, { skipCovers: false }),
        track?.Id
          ? ipcRenderer.invoke('get-track-db-info', { trackId: track.Id })
          : Promise.resolve(null),
      ]);

      if (cancelled) return;

      try {
        const fs = window.require('fs') as typeof import('fs');
        setFileSize(fs.statSync(songPath).size);
      } catch {
        /* ignore */
      }

      setMetadata(meta);
      setDbInfo(db);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, songPath]);

  const handleRevealFile = () => {
    if (songPath) ipcRenderer.invoke('reveal-file', { filePath: songPath });
  };

  const fmt = metadata?.format;
  const common = metadata?.common;
  const extension = ((track?.Extension as string) || '').toLowerCase();

  const formatLine = fmt
    ? [
        extension.toUpperCase() || fmt.container,
        fmt.duration ? `${Math.round(fmt.duration)} sec (${formatDuration(fmt.duration)})` : null,
        fmt.sampleRate ? `${fmt.sampleRate} Hz` : null,
        fmt.bitsPerSample ? `${fmt.bitsPerSample} bit` : null,
        fmt.numberOfChannels != null
          ? fmt.numberOfChannels === 2
            ? 'Stereo'
            : fmt.numberOfChannels === 1
              ? 'Mono'
              : `${fmt.numberOfChannels}ch`
          : null,
        fmt.bitrate ? `${Math.round(fmt.bitrate / 1000)} kbps` : null,
        fileSize ? formatFileSize(fileSize) : null,
      ]
        .filter(Boolean)
        .join(', ')
    : null;

  const picture = common?.picture?.[0];
  const albumArtInfo = picture
    ? `${formatArtFormat(picture.format)}, Embedded (${picture.data.byteLength.toLocaleString()} bytes)`
    : null;

  const trackLabel =
    common?.track?.no != null
      ? common.track.of
        ? `${common.track.no} / ${common.track.of}`
        : `${common.track.no}`
      : null;

  const discLabel = common?.disk?.no != null ? `${common.disk.no}` : null;

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Info / Tags"
      headerAction={
        <IconButton onClick={onClose} size="small">
          <Icon icon={dismiss24Regular} width={20} />
        </IconButton>
      }
      maxWidth="sm"
      scroll="paper"
      contentSx={{ p: 0 }}
    >
      <Tabs
        value={tab}
        variant="fullWidth"
        selectionFollowsFocus
        onChange={(_, v) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Summary" />
        <Tab label="Raw" disabled={loading} />
      </Tabs>

      <Box sx={{ p: 2 }}>
        {loading ? (
          <Stack spacing={1.5}>
            <Skeleton variant="text" width="100%" height={18} />
            <Skeleton variant="text" width="85%" height={18} />
            <Skeleton variant="rounded" width="100%" height={48} />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} variant="text" width={`${60 + (i % 4) * 10}%`} height={16} />
            ))}
          </Stack>
        ) : tab === 0 ? (
          <Grid container rowSpacing={1.5} columnSpacing={2} alignItems="baseline">
            {songPath && (
              <Grid item xs={12}>
                <Typography
                  variant="body2"
                  sx={{
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    wordBreak: 'break-all',
                    opacity: 0.85,
                  }}
                  onClick={handleRevealFile}
                >
                  {songPath}
                </Typography>
              </Grid>
            )}

            {formatLine && (
              <Grid item xs={12}>
                <Box sx={{ px: 1.5, py: 1.25, borderRadius: 1, bgcolor: 'action.hover' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {formatLine}
                  </Typography>
                </Box>
              </Grid>
            )}

            <InfoRow
              label="Track Gain"
              value={fmt?.trackGain != null ? `${fmt.trackGain.toFixed(1)} dB` : null}
            />
            <InfoRow
              label="Album Gain"
              value={fmt?.albumGain != null ? `${fmt.albumGain.toFixed(1)} dB` : null}
            />
            <InfoRow label="Played Times" value={dbInfo?.PlayedTimes ?? 0} />
            <InfoRow label="Last Played" value={formatDate(dbInfo?.LastPlayedAt)} />

            <Grid item xs={12}>
              <Divider />
            </Grid>

            <InfoRow label="Title" value={common?.title} />
            <InfoRow label="Track" value={trackLabel} />
            <InfoRow label="Disc" value={discLabel} />
            <InfoRow label="Year" value={common?.year} />
            <InfoRow label="Genre" value={common?.genre?.join(', ')} />
            <InfoRow label="Artist" value={common?.artist} />
            <InfoRow label="Album" value={common?.album} />
            <InfoRow label="Album Artist" value={common?.albumartist} />
            <InfoRow
              label="Composer"
              value={common?.composer?.length ? common.composer.join(', ') : null}
            />
            <InfoRow
              label="Comment"
              value={
                common?.comment?.length
                  ? common.comment.map(c => (typeof c === 'string' ? c : c.text)).join('; ')
                  : null
              }
            />
            <InfoRow label="Album Art" value={albumArtInfo} />
            <InfoRow label="Encoder" value={common?.encodedby} />
          </Grid>
        ) : (
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              fontSize: 11,
              lineHeight: 1.6,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify(sanitizeForDisplay(metadata), null, 2)}
          </Box>
        )}
      </Box>
    </AppDialog>
  );
}
