import React from 'react';
import { Box, Checkbox, ListItemButton, Typography } from '@mui/material';
import { Icon } from '@iconify/react';
import musicNoteIcon from '@iconify/icons-fluent/music-note-2-24-regular';
import ArtistCell from './ArtistCell';
import EqualizerBars from './EqualizerBars';
import { listRowSx } from '../styles/listSx';
import { formatDuration } from '../utils/formatDuration';
import { Track } from '../utils/store';

export const TRACK_ROW_H = 54;
export const TRACK_ROW_PHONE_H = 40;

export interface TrackRowProps {
  song: Track;
  /** Also picks the alternating stripe. */
  index: number;
  height: number;
  /** Leading number; omit for the music-note glyph. */
  number?: number | null;
  isSelected: boolean;
  isCurrent: boolean;
  isPlaying?: boolean;
  anySelected: boolean;
  /** Drops the artist/album subtitle. */
  compact?: boolean;
  onPlay: (_index: number) => void;
  onToggle: (_index: number, _extend: boolean) => void;
  /** Passing this adds the album name as a link beside the artist. */
  onOpenAlbum?: (_albumId: string | number) => void;
  onContextMenu?: (_e: React.MouseEvent, _song: Track) => void;
}

const TrackRow: React.FC<TrackRowProps> = ({
  song,
  index,
  height,
  number,
  isSelected,
  isCurrent,
  isPlaying = false,
  anySelected,
  compact = false,
  onPlay,
  onToggle,
  onOpenAlbum,
  onContextMenu,
}) => (
  <ListItemButton
    data-track-id={song.Id ?? ''}
    onClick={e => {
      if ((e.target as HTMLElement).closest('[data-nav-cell]')) return;
      onPlay(index);
    }}
    onContextMenu={onContextMenu && (e => onContextMenu(e, song))}
    selected={isSelected || isCurrent}
    sx={{
      gap: 1.5,
      px: 1.5,
      py: 0.75,
      height: height - 2,
      ...listRowSx(index),
      '&:hover .rowCheck': { opacity: 1 },
    }}
  >
    <Box
      className="rowCheck"
      data-nav-cell="true"
      onClick={e => {
        e.stopPropagation();
        onToggle(index, e.shiftKey);
      }}
      sx={{
        display: 'flex',
        flexShrink: 0,
        opacity: anySelected ? 1 : 0,
        transition: 'opacity 120ms',
      }}
    >
      <Checkbox size="medium" checked={isSelected} tabIndex={-1} sx={{ p: 0.25 }} />
    </Box>

    <Box
      sx={{
        minWidth: 24,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isCurrent ? 'primary.main' : 'text.secondary',
      }}
    >
      {isCurrent ? (
        <EqualizerBars playing={isPlaying} height={14} barWidth={4} barCount={4} />
      ) : number != null ? (
        <Typography variant="body2" sx={{ color: 'text.disabled' }}>
          {number}
        </Typography>
      ) : (
        <Icon icon={musicNoteIcon} height="1.3rem" />
      )}
    </Box>

    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        variant="body2"
        noWrap
        sx={{
          fontWeight: isCurrent ? 700 : 400,
          color: isCurrent ? 'primary.main' : 'text.primary',
        }}
      >
        {(song.Title as string) || 'Unknown'}
      </Typography>
      {!compact && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            color: 'text.secondary',
          }}
        >
          <Box sx={{ display: 'flex', flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
            <ArtistCell artistNameRaw={song.ArtistName as string | undefined} variant="caption" />
          </Box>
          {onOpenAlbum && song.AlbumTitle && (
            <>
              <Typography variant="caption" sx={{ flexShrink: 0 }}>
                &nbsp;·&nbsp;
              </Typography>
              <Typography
                variant="caption"
                noWrap
                data-nav-cell="true"
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation();
                  if (song.AlbumId != null) onOpenAlbum(song.AlbumId as string | number);
                }}
                sx={{
                  flexShrink: 0,
                  '&:hover':
                    song.AlbumId != null
                      ? { textDecoration: 'underline', color: 'primary.main' }
                      : undefined,
                }}
              >
                {song.AlbumTitle as string}
              </Typography>
            </>
          )}
        </Box>
      )}
    </Box>

    <Typography
      variant="caption"
      sx={{ color: 'text.secondary', flexShrink: 0, minWidth: 36, textAlign: 'right' }}
    >
      {formatDuration(song.Duration)}
    </Typography>
  </ListItemButton>
);

export default React.memo(TrackRow);
