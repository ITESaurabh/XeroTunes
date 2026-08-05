import React from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import AppDialog from './AppDialog';
import { ResetTarget } from '../../config/app_settings';
import { useIpc } from '../state/ipc';
import { useConfirm } from '../utils/useConfirm';

interface ResetItem {
  key: ResetTarget;
  label: string;
  detail: string;
}

const RESET_ITEMS: ResetItem[] = [
  {
    key: 'localState',
    label: 'Local state',
    detail: 'Playback queue, view state and anything else this window keeps between launches',
  },
  {
    key: 'settings',
    label: 'Settings',
    detail: 'Every preference back to its default: playback, output, overlay, window scale',
  },
  {
    key: 'themes',
    label: 'Themes',
    detail: 'Deletes custom themes and switches back to Amethyst',
  },
  {
    key: 'database',
    label: 'Library database',
    detail: 'Empties every table: tracks, albums, artists, music folders, play counts',
  },
  {
    key: 'firstrun',
    label: 'First-run marker',
    detail: 'Onboarding runs again on the next launch',
  },
  {
    key: 'albumArts',
    label: 'Album art cache',
    detail: 'album_arts, rebuilt by the next library scan',
  },
  {
    key: 'artistArts',
    label: 'Artist image cache',
    detail: 'artist_arts, refetched in the background',
  },
];

const labelFor = (key: ResetTarget) => RESET_ITEMS.find(i => i.key === key)?.label ?? key;

interface FactoryResetDialogProps {
  open: boolean;
  onClose: () => void;
}

const FactoryResetDialog: React.FC<FactoryResetDialogProps> = ({ open, onClose }) => {
  const { invokeEventToMainProcess, sendEventToMainProcess } = useIpc();
  const confirm = useConfirm();
  const [selected, setSelected] = React.useState<Set<ResetTarget>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<ResetTarget[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setFailed([]);
    setBusy(false);
  }, [open]);

  const toggle = (key: ResetTarget) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const allSelected = selected.size === RESET_ITEMS.length;

  const handleReset = async () => {
    const ok = await confirm({
      title: 'Reset selected data?',
      message: `${selected.size} item${selected.size === 1 ? '' : 's'} will be deleted for good.`,
      detail:
        'XeroTunes restarts once it is done. Your music files are never touched, only what the app stores about them.',
      confirmLabel: 'Reset and restart',
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    // localStorage lives in this process, so main can't clear it.
    if (selected.has('localState')) localStorage.clear();

    try {
      const res = (await invokeEventToMainProcess('factory-reset', {
        targets: [...selected],
      })) as { failed?: ResetTarget[] };
      if (res?.failed?.length) {
        setFailed(res.failed);
        setBusy(false);
        return;
      }
    } catch (error) {
      console.error('Factory reset failed:', error);
      setFailed([...selected]);
      setBusy(false);
      return;
    }
    sendEventToMainProcess('restart-app');
  };

  return (
    <AppDialog open={open} onClose={busy ? () => undefined : onClose} title="Factory Reset">
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          Pick what to wipe. Music files on disk are never touched.
        </Typography>

        <FormControlLabel
          control={
            <Checkbox
              checked={allSelected}
              indeterminate={selected.size > 0 && !allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(RESET_ITEMS.map(i => i.key)))
              }
            />
          }
          label={<Typography variant="body2">Select everything</Typography>}
        />
        <Divider />

        {RESET_ITEMS.map(item => (
          <FormControlLabel
            key={item.key}
            sx={{ alignItems: 'flex-start', mr: 0 }}
            control={
              <Checkbox
                checked={selected.has(item.key)}
                onChange={() => toggle(item.key)}
                sx={{ pt: 0.5 }}
              />
            }
            label={
              <Stack sx={{ py: 0.5 }}>
                <Typography variant="body2">{item.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.detail}
                </Typography>
              </Stack>
            }
          />
        ))}

        {failed.length > 0 && (
          <Alert severity="error">
            Could not remove: {failed.map(labelFor).join(', ')}. A restart releases whatever still
            holds them.
          </Alert>
        )}

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 1 }}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {failed.length > 0 && (
            <Button color="warning" onClick={() => sendEventToMainProcess('restart-app')}>
              Restart anyway
            </Button>
          )}
          <Button
            variant="contained"
            color="error"
            disabled={busy || selected.size === 0}
            onClick={handleReset}
          >
            {busy ? 'Resetting…' : 'Reset'}
          </Button>
        </Stack>
      </Stack>
    </AppDialog>
  );
};

export default FactoryResetDialog;
