import React, { useCallback, useState } from 'react';
import { Button, ListItemIcon, ListItemText, MenuItem, Stack, TextField } from '@mui/material';
import { Icon } from '@iconify/react';
import addIcon from '@iconify/icons-fluent/add-24-regular';
import { useQueryClient } from '@tanstack/react-query';
import AppDialog from './AppDialog';
import { useIpc } from '../state/ipc';
import { QUERY_KEYS } from '../constants/queryKeys';

/**
 * Item and dialog come back separately because the dialog has to sit outside the
 * `Menu`: a menu unmounts its children on close, taking the open dialog with it.
 * `getTrackIds` is read on click, since the selection the menu described is gone
 * by the time the name is typed.
 */
export function useNewPlaylist(
  getTrackIds: () => Array<string | number>,
  onPicked?: () => void,
  onAdded?: (_name: string, _added: number) => void
) {
  const { invokeEventToMainProcess } = useIpc();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Array<string | number> | null>(null);
  const [name, setName] = useState('');

  const create = useCallback(async () => {
    const trackIds = pending;
    const trimmed = name.trim();
    if (!trackIds || !trimmed) return;
    setPending(null);
    setName('');
    const created = (await invokeEventToMainProcess('create-playlist', { name: trimmed })) as {
      id: number;
    };
    if (created?.id == null) return;
    const res = (await invokeEventToMainProcess('add-tracks-to-playlist', {
      playlistId: created.id,
      trackIds,
    })) as { added: number };
    await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PLAYLISTS] });
    onAdded?.(trimmed, res?.added ?? trackIds.length);
  }, [pending, name, invokeEventToMainProcess, queryClient, onAdded]);

  const newPlaylistItem = (
    <MenuItem
      onClick={() => {
        setPending(getTrackIds());
        onPicked?.();
      }}
    >
      <ListItemIcon>
        <Icon icon={addIcon} width={20} />
      </ListItemIcon>
      <ListItemText>New playlist…</ListItemText>
    </MenuItem>
  );

  const newPlaylistDialog = (
    <AppDialog
      open={pending !== null}
      onClose={() => setPending(null)}
      title="New Playlist"
      actions={
        <>
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="contained" disabled={!name.trim()} onClick={() => void create()}>
            Create &amp; add
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <TextField
          autoFocus
          fullWidth
          label="Name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void create();
          }}
        />
      </Stack>
    </AppDialog>
  );

  return { newPlaylistItem, newPlaylistDialog };
}
