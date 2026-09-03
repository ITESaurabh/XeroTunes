import React, { useContext, useRef } from 'react';
import { Box, Button, Collapse, LinearProgress, ListItem, Stack, Typography } from '@mui/material';
import { ipcRenderer } from 'electron';
import { store } from '../utils/store';

/**
 * The counts restart at every server, because a server's total isn't known until
 * it has been walked and there is no honest single bar across a run. Naming the
 * server and its place is what makes the restart read as progress, not lost work.
 */
export default function SyncProgressPanel(): React.ReactElement | null {
  const { state } = useContext(store);
  const { isSyncing, scanProgress } = state;

  // Held across the collapse: scanProgress is cleared the moment the sync ends,
  // and the panel would spend its exit animation showing an empty bar.
  const last = useRef(scanProgress);
  if (isSyncing && scanProgress) last.current = scanProgress;
  const shown = isSyncing ? scanProgress : last.current;

  const at = shown?.source;
  const done = shown?.processed ?? 0;
  const total = shown?.total ?? 0;
  const accent = at?.accent ?? undefined;

  return (
    <Collapse in={isSyncing} unmountOnExit>
      <ListItem sx={{ display: 'block', pt: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap title={at?.name ?? undefined}>
              {at?.name ?? 'Syncing…'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {at && at.count > 1 ? `Server ${at.index} of ${at.count} · ` : ''}
              {total > 0 ? `${done} of ${total} tracks` : 'Reading the server…'}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            sx={{ flexShrink: 0 }}
            onClick={() => {
              ipcRenderer.invoke('cancel-sync').catch(() => undefined);
            }}
          >
            Cancel
          </Button>
        </Stack>
        <LinearProgress
          variant={total > 0 ? 'determinate' : 'indeterminate'}
          value={total > 0 ? Math.min(100, Math.round((done / total) * 100)) : undefined}
          sx={{
            height: 6,
            borderRadius: 2,
            ...(accent && { '& .MuiLinearProgress-bar': { bgcolor: accent } }),
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Tracks already imported are kept if you cancel.
        </Typography>
      </ListItem>
    </Collapse>
  );
}
