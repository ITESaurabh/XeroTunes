import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Menu, MenuItem, Snackbar, Typography } from '@mui/material';
import { Icon } from '@iconify/react';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import addIcon from '@iconify/icons-fluent/text-bullet-list-add-24-regular';
import editIcon from '@iconify/icons-fluent/edit-24-regular';
import { useQuery } from '@tanstack/react-query';
import { useIpc } from '../state/ipc';
import { QUERY_KEYS } from '../constants/queryKeys';
import { Track } from '../utils/store';
import { isTaggable } from '../../config/constants';

/**
 * Checkbox selection over an ordered track list. Shift extends from the last
 * row touched, the way every file manager does it.
 */
export function useTrackSelection(tracks: Track[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const anchor = useRef<number | null>(null);

  const toggleAt = useCallback(
    (index: number, extend = false) => {
      const id = tracks[index]?.Id;
      if (id == null) return;
      setSelectedIds(prev => {
        const next = new Set(prev);
        const from = extend && anchor.current != null ? anchor.current : index;
        const turnOn = !next.has(id);
        for (let i = Math.min(from, index); i <= Math.max(from, index); i++) {
          const rowId = tracks[i]?.Id;
          if (rowId == null) continue;
          if (turnOn) next.add(rowId);
          else next.delete(rowId);
        }
        return next;
      });
      anchor.current = index;
    },
    [tracks]
  );

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    anchor.current = null;
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size === tracks.length
        ? new Set()
        : new Set(tracks.map(t => t.Id).filter((id): id is string | number => id != null))
    );
  }, [tracks]);

  /** Whole-set replacement, for callers that report a model rather than a row. */
  const replace = useCallback((ids: Set<string | number>) => {
    setSelectedIds(new Set(ids));
    anchor.current = null;
  }, []);

  const selected = useMemo(
    () => tracks.filter(t => t.Id != null && selectedIds.has(t.Id)),
    [tracks, selectedIds]
  );

  return { selectedIds, selected, toggleAt, toggleAll, clear, replace };
}

export function toEditableTracks(tracks: Track[]) {
  return tracks
    .filter(t => t.Id != null && typeof t.Uri === 'string')
    .map(t => ({
      Id: t.Id as string | number,
      Uri: t.Uri as string,
      Title: t.Title as string | undefined,
    }));
}

interface SelectionBarProps {
  selected: Track[];
  total: number;
  onToggleAll: () => void;
  onClear: () => void;
  onPlay: () => void;
  onEditTags: () => void;
}

interface PlaylistRow {
  Id: number;
  Name: string;
}

export default function SelectionBar({
  selected,
  total,
  onToggleAll,
  onClear,
  onPlay,
  onEditTags,
}: SelectionBarProps) {
  const { invokeEventToMainProcess } = useIpc();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { data: playlists } = useQuery({
    queryKey: [QUERY_KEYS.PLAYLISTS],
    queryFn: () => invokeEventToMainProcess('get-playlists') as Promise<PlaylistRow[]>,
    enabled: !!menuAnchor,
  });

  const taggable = selected.filter(t => isTaggable(t.Uri as string));

  const handleAddTo = useCallback(
    async (playlist: PlaylistRow) => {
      setMenuAnchor(null);
      const res = (await invokeEventToMainProcess('add-tracks-to-playlist', {
        playlistId: playlist.Id,
        trackIds: selected.map(t => t.Id),
      })) as { added: number };
      setToast(`Added ${res.added} to ${playlist.Name}`);
    },
    [invokeEventToMainProcess, selected]
  );

  return (
    <>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          px: 1,
          py: 0.75,
          mb: 1.5,
          borderRadius: 1,
          bgcolor: 'background.paper',
          boxShadow: 3,
        }}
      >
        <Checkbox
          size="medium"
          checked={selected.length === total}
          indeterminate={selected.length > 0 && selected.length < total}
          onChange={onToggleAll}
        />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {selected.length} song{selected.length === 1 ? '' : 's'} selected
        </Typography>
        <Typography
          variant="body2"
          onClick={onClear}
          sx={{
            color: 'primary.main',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          Clear
        </Typography>

        <Box sx={{ flex: 1 }} />

        <Button
          size="small"
          variant="contained"
          startIcon={<Icon icon={playIcon} width={16} />}
          onClick={onPlay}
        >
          Play
        </Button>
        <Button
          size="small"
          startIcon={<Icon icon={addIcon} width={16} />}
          onClick={e => setMenuAnchor(e.currentTarget)}
        >
          Add to
        </Button>
        <Button
          size="small"
          startIcon={<Icon icon={editIcon} width={16} />}
          onClick={onEditTags}
          disabled={!taggable.length}
          title={
            taggable.length === selected.length
              ? undefined
              : `${selected.length - taggable.length} of these files cannot be tagged`
          }
        >
          Edit tags
        </Button>
      </Box>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        {(playlists ?? []).map(p => (
          <MenuItem key={p.Id} onClick={() => handleAddTo(p)}>
            {p.Name}
          </MenuItem>
        ))}
        {playlists && !playlists.length && <MenuItem disabled>No playlists yet</MenuItem>}
      </Menu>

      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setToast(null)}>
          {toast}
        </Alert>
      </Snackbar>
    </>
  );
}
