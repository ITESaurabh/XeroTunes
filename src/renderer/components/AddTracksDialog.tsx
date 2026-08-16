import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  InputAdornment,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import searchIcon from '@iconify/icons-fluent/search-24-regular';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useQuery } from '@tanstack/react-query';
import AppDialog from './AppDialog';
import ArtistCell from './ArtistCell';
import { useIpc } from '../state/ipc';
import { Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { listRowSx } from '../styles/listSx';

interface AddTracksDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (_trackIds: Array<string | number>) => Promise<void> | void;
}

function matchesQuery(song: Track, needle: string): boolean {
  const haystack = `${song.Title || ''} ${song.ArtistName || ''} ${song.AlbumTitle || ''}`;
  return haystack.toLowerCase().includes(needle);
}

const AddTracksDialog: React.FC<AddTracksDialogProps> = ({ open, onClose, onAdd }) => {
  const { invokeEventToMainProcess } = useIpc();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [dialogReady, setDialogReady] = useState(false);
  useEffect(() => {
    if (!open) setDialogReady(false);
  }, [open]);

  const { data: songs = [] as Track[], isLoading } = useQuery({
    queryKey: [QUERY_KEYS.ALL_SONGS],
    queryFn: () => invokeEventToMainProcess('get-all-songs', undefined) as Promise<Track[]>,
    enabled: open,
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return songs;
    return songs.filter(s => matchesQuery(s, needle));
  }, [songs, query]);

  const toggle = useCallback((id: string | number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleClose = useCallback(() => {
    setQuery('');
    setSelected(new Set());
    onClose();
  }, [onClose]);

  const handleAdd = useCallback(async () => {
    setAdding(true);
    try {
      await onAdd([...selected]);
    } finally {
      setAdding(false);
      handleClose();
    }
  }, [onAdd, selected, handleClose]);

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const song = filtered[index];
      const isSelected = song.Id != null && selected.has(song.Id);
      return (
        <ListItemButton
          style={style}
          sx={listRowSx(index)}
          onClick={() => song.Id != null && toggle(song.Id)}
        >
          <Checkbox checked={isSelected} tabIndex={-1} disableRipple size="small" />
          <Box sx={{ flex: 1, minWidth: 0, px: 1 }}>
            <Typography variant="body2" noWrap>
              {(song.Title as string) || 'Unknown'}
            </Typography>
            <ArtistCell artistNameRaw={song.ArtistName as string | undefined} variant="caption" />
          </Box>
        </ListItemButton>
      );
    },
    [filtered, selected, toggle]
  );

  return (
    <AppDialog
      open={open}
      onClose={handleClose}
      title="Add songs"
      maxWidth="md"
      contentSx={{ display: 'flex', flexDirection: 'column', p: 0, height: '70vh' }}
      onEntered={() => setDialogReady(true)}
    >
      <Box sx={{ p: 2 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="Search your library…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon icon={searchIcon} width={18} />
              </InputAdornment>
            ),
          }}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, px: 1 }}>
        {isLoading || !dialogReady ? (
          <Box
            sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <CircularProgress size={28} />
          </Box>
        ) : filtered.length === 0 ? (
          <Typography sx={{ p: 3, color: 'text.secondary' }}>No songs found</Typography>
        ) : (
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <FixedSizeList
                height={height}
                width={width}
                itemCount={filtered.length}
                itemSize={48}
                overscanCount={30}
              >
                {Row}
              </FixedSizeList>
            )}
          </AutoSizer>
        )}
      </Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}
      >
        <Typography variant="body2" color="text.secondary">
          {selected.size} selected
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            variant="contained"
            disabled={selected.size === 0 || adding}
            onClick={() => void handleAdd()}
          >
            Add {selected.size > 0 ? selected.size : ''}
          </Button>
        </Stack>
      </Stack>
    </AppDialog>
  );
};

export default AddTracksDialog;
