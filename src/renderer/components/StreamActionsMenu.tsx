import React, { useCallback, useState } from 'react';
import { Button, IconButton, Menu, MenuItem, Stack, TextField } from '@mui/material';
import { Icon } from '@iconify/react';
import moreVerticalIcon from '@iconify/icons-fluent/more-vertical-24-regular';
import editIcon from '@iconify/icons-fluent/edit-24-regular';
import AppDialog from './AppDialog';
import { useIpc } from '../state/ipc';
import { useConfirm } from '../utils/useConfirm';

export interface EditableStream {
  Id: number;
  Name: string;
  CoverUri: string | null;
}

interface StreamActionsMenuProps {
  stream: EditableStream;
  /** 'icon' sits on a grid card, 'button' in a page toolbar. */
  variant?: 'icon' | 'button';
  onChanged: () => void | Promise<void>;
  onDeleted?: () => void;
}

// MUI's Menu portals to document.body but React still bubbles its clicks through
// the tree, so without this a menu click also reaches whatever wraps the trigger.
const stopEventPropagation = (event: unknown): void => {
  (event as { stopPropagation?: () => void } | null)?.stopPropagation?.();
};

const StreamActionsMenu: React.FC<StreamActionsMenuProps> = ({
  stream,
  variant = 'icon',
  onChanged,
  onDeleted,
}) => {
  const { invokeEventToMainProcess } = useIpc();
  const confirm = useConfirm();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(stream.Name);
  const close = () => setAnchorEl(null);

  const handleRename = useCallback(async () => {
    await invokeEventToMainProcess('rename-stream', {
      streamId: stream.Id,
      name: renameValue,
    });
    setRenameOpen(false);
    await onChanged();
  }, [invokeEventToMainProcess, stream.Id, renameValue, onChanged]);

  const handleCover = useCallback(
    async (clear?: boolean) => {
      const res = (await invokeEventToMainProcess('set-stream-cover', {
        streamId: stream.Id,
        clear,
      })) as { canceled?: boolean };
      if (res?.canceled) return;
      await onChanged();
    },
    [invokeEventToMainProcess, stream.Id, onChanged]
  );

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: 'Remove Stream',
      message: `Remove "${stream.Name}"?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await invokeEventToMainProcess('delete-stream', { streamId: stream.Id });
    await onChanged();
    onDeleted?.();
  }, [confirm, invokeEventToMainProcess, stream.Id, stream.Name, onChanged, onDeleted]);

  const openMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const runAction = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    close();
    action();
  };

  return (
    <>
      {variant === 'button' ? (
        <Button
          variant="outlined"
          startIcon={<Icon icon={editIcon} />}
          onClick={openMenu}
          aria-label={`Edit ${stream.Name}`}
        >
          Edit
        </Button>
      ) : (
        <IconButton
          size="small"
          onMouseDown={e => e.stopPropagation()}
          onClick={openMenu}
          aria-label={`Edit ${stream.Name}`}
          sx={{ color: 'text.secondary' }}
        >
          <Icon icon={moreVerticalIcon} width={18} />
        </IconButton>
      )}

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={event => {
          stopEventPropagation(event);
          close();
        }}
      >
        <MenuItem
          onClick={runAction(() => {
            setRenameValue(stream.Name);
            setRenameOpen(true);
          })}
        >
          Rename
        </MenuItem>
        <MenuItem onClick={runAction(() => void handleCover())}>
          {stream.CoverUri ? 'Change Cover…' : 'Set Cover…'}
        </MenuItem>
        {stream.CoverUri && (
          <MenuItem onClick={runAction(() => void handleCover(true))}>Remove Cover</MenuItem>
        )}
        <MenuItem onClick={runAction(() => void handleDelete())} sx={{ color: 'error.main' }}>
          Delete
        </MenuItem>
      </Menu>

      <AppDialog open={renameOpen} onClose={() => setRenameOpen(false)} title="Rename Stream">
        <Stack spacing={2}>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleRename();
            }}
          />
          <Stack direction="row" justifyContent="flex-end" spacing={1}>
            <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => void handleRename()}>
              Save
            </Button>
          </Stack>
        </Stack>
      </AppDialog>
    </>
  );
};

export default StreamActionsMenu;
