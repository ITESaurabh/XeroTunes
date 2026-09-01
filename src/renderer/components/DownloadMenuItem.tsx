import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { Icon } from '@iconify/react';
import downloadIcon from '@iconify/icons-fluent/arrow-download-24-regular';
import deleteIcon from '@iconify/icons-fluent/delete-24-regular';

const { ipcRenderer } = window.require('electron');

interface DownloadMenuItemProps {
  /** A row from a song list; needs SourceId and Uri to decide what to offer. */
  song: { Id?: unknown; Uri?: unknown; SourceId?: unknown } | null | undefined;
  onDone: () => void;
}

/**
 * Only remote tracks can be downloaded, and a downloaded one has swapped its
 * streaming Uri for a local path, which is how we tell the two apart.
 */
export default function DownloadMenuItem({ song, onDone }: DownloadMenuItemProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (song?.SourceId == null) return null;

  const downloaded = typeof song.Uri === 'string' && !/^https?:\/\//i.test(song.Uri);
  const channel = downloaded ? 'remove-download' : 'download-track';

  return (
    <MenuItem
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await ipcRenderer.invoke(channel, { trackId: song.Id }).catch(() => undefined);
        // A track's Uri changed, so every list holding it is stale. Broad, but
        // this is a deliberate one-off action, not something on a hot path.
        await queryClient.invalidateQueries();
        setBusy(false);
        onDone();
      }}
    >
      <ListItemIcon>
        <Icon icon={downloaded ? deleteIcon : downloadIcon} width={20} />
      </ListItemIcon>
      <ListItemText>
        {busy ? 'Working…' : downloaded ? 'Remove download' : 'Download'}
      </ListItemText>
    </MenuItem>
  );
}
