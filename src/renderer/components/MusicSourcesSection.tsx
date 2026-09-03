import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Icon } from '@iconify/react';
import sourcesIcon from '@iconify/icons-fluent/music-note-2-24-regular';
import folderIcon from '@iconify/icons-fluent/folder-24-regular';
import serverIcon from '@iconify/icons-fluent/server-24-regular';
import cloudIcon from '@iconify/icons-fluent/cloud-24-regular';
import networkIcon from '@iconify/icons-fluent/globe-24-regular';
import addFolderIcon from '@iconify/icons-fluent/folder-add-24-regular';
import addIcon from '@iconify/icons-fluent/add-24-regular';
import downloadIcon from '@iconify/icons-fluent/arrow-download-24-regular';
import helpIcon from '@iconify/icons-fluent/question-circle-24-regular';
import AppDialog from './AppDialog';
import { useIpc } from '../state/ipc';
import { store } from '../utils/store';
import { useConfirm } from '../utils/useConfirm';

const { ipcRenderer } = window.require('electron');

interface MusicFolder {
  Id: number;
  Uri: string;
  Name?: string;
}

interface Provider {
  type: string;
  label: string;
  blurb: string;
  accent: string;
  available: boolean;
  /** It has discover(), so the form offers a network scan. */
  discoverable: boolean;
  /** Its metadata comes from the files, so it offers the choice below. */
  fileTags: boolean;
  /** It takes a token, so the form offers one alongside the sign-in fields. */
  tokenAuth: boolean;
  /** The server's own docs for what to type here. Absent hides the Guide button. */
  guide?: string;
  /** It cannot connect without a username and password, so the form marks them. */
  needsAccount: boolean;
}

interface Discovered {
  name: string;
  address: string;
}

const sameAddress = (a: string | null, b: string) =>
  (a ?? '').replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/**
 * How much of a file share to open during a sync. Reading tens of thousands of
 * files is expensive, and only the owner of the server knows whether that cost
 * is worth paying.
 */
const METADATA_MODES = [
  {
    value: 'eager',
    label: 'Read tags while syncing',
    hint: 'Every file is opened once. Slowest to sync, and the library is complete when it finishes.',
  },
  {
    value: 'onPlay',
    label: 'Read tags when a track plays',
    hint: 'Syncs in seconds. Tracks are named after their files until you play them.',
  },
  {
    value: 'off',
    label: 'Never read tags',
    hint: 'Nothing is ever opened. Titles, artists and albums come from the folder names.',
  },
] as const;

/**
 * What to type in the address field, where a server type wants something other
 * than a plain `host:port`.
 */
const ADDRESS_HINT: Record<
  string,
  {
    placeholder: string;
    helper?: string;
    /** Sits under Password, where the choice is made. */ signIn?: string;
  }
> = {
  nextcloud: {
    placeholder: 'https://cloud.example.com',
    helper:
      'Needs the Music app, and the password it generates under Settings → Music — not your account password.',
  },
  subsonic: {
    placeholder: 'http://localhost:4533',
    helper: 'Navidrome, Airsonic, Gonic and friends. The same sign-in as the server’s own web app.',
  },
  plex: {
    placeholder: 'http://localhost:32400',
    helper: 'The address of your own server.',
    signIn: 'These go to plex.tv, not to the address above.',
  },
  webdav: { placeholder: 'http://192.168.1.10:8081/music' },
};

/** Absent until the check answers, so a row shows nothing rather than guessing. */
interface SourceStatus {
  reachable: boolean;
  authValid: boolean;
}

interface Source {
  Id: number;
  Type: string;
  Name: string | null;
  BaseUrl: string | null;
  Username: string | null;
  LastSyncedAt: number | null;
  TrackCount: number;
  DownloadedCount: number;
  Metadata: string;
}

/** Until real brand marks are dropped in, shape stands in for the logo. */
const PROVIDER_ICON: Record<string, typeof serverIcon> = {
  jellyfin: serverIcon,
  emby: serverIcon,
  plex: serverIcon,
  subsonic: serverIcon,
  upnp: networkIcon,
  nextcloud: cloudIcon,
  webdav: cloudIcon,
};

function lastSyncLabel(at: number | null): string {
  if (!at) return 'never synced';
  // Seconds add width without telling anyone anything useful here.
  return `synced ${new Date(at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`;
}

export default function MusicSourcesSection() {
  const { invokeEventToMainProcess, sendEventToMainProcess } = useIpc();
  const confirm = useConfirm();

  const { state } = useContext(store);
  // Adding, removing or repointing a source races whatever is writing its rows,
  // so every control that does so is locked for the duration.
  const libraryBusy = state.isScanningLibrary || state.isSyncing;

  const [expanded, setExpanded] = useState(false);
  const [folders, setFolders] = useState<MusicFolder[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [statuses, setStatuses] = useState<Record<number, SourceStatus>>({});
  const [downloadFolder, setDownloadFolder] = useState('');

  // Open state is kept separate from which step is showing: clearing the step on
  // close would swap the content back to the form for the length of the exit
  // transition, which reads as a flash of the wrong screen.
  const [addOpen, setAddOpen] = useState(false);
  // '' = choosing a type, otherwise the type being configured.
  const [addingType, setAddingType] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [metadata, setMetadata] = useState<string>('eager');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null before the first scan, so "nothing found" isn't shown until one has run.
  const [discovered, setDiscovered] = useState<Discovered[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const refresh = useCallback(() => {
    invokeEventToMainProcess('get-music-folders', undefined)
      .then(d => setFolders(d as MusicFolder[]))
      .catch(() => undefined);
    invokeEventToMainProcess('get-sources', undefined)
      .then(d => setSources(d as Source[]))
      .catch(() => undefined);
    invokeEventToMainProcess('get-download-folder', undefined)
      .then(d => setDownloadFolder(String(d ?? '')))
      .catch(() => undefined);
    // A round trip per server, so it rides along with the list, not a timer.
    invokeEventToMainProcess('check-sources', undefined)
      .then(d => setStatuses((d ?? {}) as Record<number, SourceStatus>))
      .catch(() => undefined);
  }, [invokeEventToMainProcess]);

  useEffect(refresh, [refresh]);

  // Folder item counts and server track counts both move on a scan or a sync.
  useEffect(() => {
    ipcRenderer.on('library-updated', refresh);
    return () => {
      ipcRenderer.removeListener('library-updated', refresh);
    };
  }, [refresh]);

  useEffect(() => {
    invokeEventToMainProcess('get-source-providers', undefined)
      .then(d => setProviders(d as Provider[]))
      .catch(() => undefined);
  }, [invokeEventToMainProcess]);

  // Fields are reset on open, not on close, for the same reason.
  const openDialog = () => {
    setAddingType('');
    setError(null);
    setBaseUrl('');
    setUsername('');
    setPassword('');
    setToken('');
    setMetadata('eager');
    setDiscovered(null);
    setAddOpen(true);
  };

  // Name as well as address: a scan reports the machine's LAN address, while
  // someone typing it in may have used localhost or whatever the server printed.
  const addedAlready = (server: Discovered) =>
    sources.some(
      source =>
        source.Type === addingType &&
        (sameAddress(source.BaseUrl, server.address) || (source.Name ?? '') === server.name)
    );

  const scan = useCallback(
    (type: string) => {
      setScanning(true);
      invokeEventToMainProcess('discover-servers', { type })
        .then(d => setDiscovered((d ?? []) as Discovered[]))
        .catch(() => setDiscovered([]))
        .finally(() => setScanning(false));
    },
    [invokeEventToMainProcess]
  );

  const closeDialog = () => setAddOpen(false);

  const handleAddFolder = async () => {
    await invokeEventToMainProcess('add-music-folder', undefined).catch(() => undefined);
    refresh();
  };

  const handleRemoveFolder = async (folder: MusicFolder) => {
    const ok = await confirm({
      title: 'Remove music folder?',
      message: `Remove "${folder.Uri}" from your library?`,
      detail:
        'Its tracks will be removed from the library on the next scan. Files on disk are not deleted.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await invokeEventToMainProcess('remove-music-folder', { Id: folder.Id }).catch(() => undefined);
    refresh();
  };

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    const res = (await invokeEventToMainProcess('add-source', {
      type: addingType,
      baseUrl,
      username,
      password,
      token,
      metadata,
    })) as { success: boolean; error?: string };
    setBusy(false);
    if (!res?.success) {
      setError(res?.error || 'Could not connect to that server');
      return;
    }
    closeDialog();
    refresh();
  };

  const handleMetadataMode = async (source: Source, mode: string) => {
    await invokeEventToMainProcess('set-source-metadata', { sourceId: source.Id, mode }).catch(
      () => undefined
    );
    refresh();
  };

  const handleRemoveSource = async (source: Source) => {
    const ok = await confirm({
      title: 'Remove server?',
      message: `Remove "${source.Name || source.BaseUrl}" from your library?`,
      detail: source.DownloadedCount
        ? `Its ${source.TrackCount} tracks will be removed, including ${source.DownloadedCount} downloaded file(s), which are deleted from disk. Nothing on the server is touched.`
        : 'Its tracks will be removed from your library. Nothing on the server is touched.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await invokeEventToMainProcess('remove-source', { sourceId: source.Id }).catch(() => undefined);
    refresh();
  };

  const chosen = providers.find(p => p.type === addingType);
  const total = folders.length + sources.length;

  /**
   * The icon gutter, then a block holding the text and the actions. They wrap
   * inside that block rather than inside the row, so actions pushed onto their
   * own line start under the text instead of against either edge.
   */
  const row = (
    key: string,
    icon: React.ReactNode,
    primary: React.ReactNode,
    secondary: React.ReactNode,
    actions: React.ReactNode
  ) => (
    <ListItem key={key} sx={{ py: 1.5 }}>
      <ListItemIcon sx={{ minWidth: { xs: '2.75rem', sm: '3.5rem' } }}>{icon}</ListItemIcon>
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 1,
          rowGap: 1.5,
        }}
      >
        <ListItemText
          primary={primary}
          secondary={secondary}
          sx={{ flex: '1 1 12rem', minWidth: 0, my: 0 }}
          primaryTypographyProps={{ sx: { wordBreak: 'break-word' } }}
          secondaryTypographyProps={{ component: 'div', sx: { wordBreak: 'break-word' } }}
        />
        {/* Grows into whatever the text leaves, so the last action lands on the
            right edge whether it shares the line or wraps below. */}
        <Stack
          direction="row"
          spacing={1}
          sx={{
            flex: '1 1 auto',
            justifyContent: 'flex-end',
            mr: 0.5,
            flexWrap: 'wrap',
            rowGap: 1,
          }}
        >
          {actions}
        </Stack>
      </Box>
    </ListItem>
  );

  return (
    <>
      <ListItem disableGutters>
        <Accordion
          expanded={expanded}
          onChange={(_e, v) => setExpanded(v)}
          sx={{ backgroundColor: 'background.default', width: '100%' }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            id="music-sources-header"
            sx={{
              px: 2,
              '& .MuiAccordionSummary-content': {
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                rowGap: 1.5,
                minWidth: 0,
                my: 1,
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: { xs: '2.75rem', sm: '3.5rem' } }}>
              <Icon icon={sourcesIcon} width="2rem" />
            </ListItemIcon>
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: 1,
                rowGap: 1.5,
              }}
            >
              <ListItemText
                primary="Music Sources"
                secondary={
                  total
                    ? `${folders.length} folder${folders.length === 1 ? '' : 's'}, ${
                        sources.length
                      } external`
                    : 'Nothing added yet'
                }
                sx={{ flex: '1 1 12rem', minWidth: 0, my: 0 }}
              />
              <Stack direction="row" spacing={1} sx={{ flexShrink: 0, mr: 0.5 }}>
                <Button
                  startIcon={<Icon icon={addFolderIcon} height="1.2rem" />}
                  variant="contained"
                  disableElevation
                  size="small"
                  disabled={libraryBusy}
                  onClick={e => {
                    e.stopPropagation();
                    void handleAddFolder();
                  }}
                >
                  Add Folder
                </Button>
                <Button
                  startIcon={<Icon icon={addIcon} height="1.2rem" />}
                  variant="outlined"
                  size="small"
                  disabled={libraryBusy}
                  onClick={e => {
                    e.stopPropagation();
                    openDialog();
                  }}
                >
                  Add External
                </Button>
              </Stack>
            </Box>
          </AccordionSummary>

          <AccordionDetails sx={{ p: 0, pb: 1 }}>
            {total === 0 && (
              <Typography sx={{ px: 2, py: 1 }}>
                No sources yet. Add a folder on this device, or connect an external server.
              </Typography>
            )}

            {folders.map(folder =>
              row(
                `folder-${folder.Id}`,
                <Icon icon={folderIcon} width="2rem" />,
                folder.Uri,
                'Folder on this device',
                <Button
                  color="error"
                  variant="contained"
                  size="small"
                  disableElevation
                  disabled={libraryBusy}
                  onClick={() => handleRemoveFolder(folder)}
                >
                  Remove
                </Button>
              )
            )}

            {folders.length > 0 && sources.length > 0 && <Divider sx={{ my: 1 }} />}

            {sources.map(source => {
              const provider = providers.find(p => p.type === source.Type);
              const status = statuses[source.Id];
              return row(
                `source-${source.Id}`,
                <Box sx={{ color: provider?.accent, lineHeight: 0 }}>
                  <Icon icon={PROVIDER_ICON[source.Type] ?? serverIcon} width="2rem" />
                </Box>,
                // A server being down is the first thing to know about the row,
                // not a footnote under two lines of detail.
                <Box
                  component="span"
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                >
                  {source.Name || source.BaseUrl}
                  {status && !status.reachable && (
                    <Chip
                      component="span"
                      label="Offline"
                      size="small"
                      color="error"
                      sx={{ height: 20 }}
                    />
                  )}
                  {status?.reachable && !status.authValid && (
                    <Chip
                      component="span"
                      label="Sign-in failed"
                      size="small"
                      color="warning"
                      sx={{ height: 20 }}
                    />
                  )}
                </Box>,
                <>
                  <Box component="span" sx={{ display: 'block' }}>
                    {provider?.label ?? source.Type} · {source.BaseUrl}
                  </Box>
                  <Box component="span" sx={{ display: 'block' }}>
                    {source.TrackCount} tracks
                    {source.DownloadedCount ? ` · ${source.DownloadedCount} downloaded` : ''} ·{' '}
                    {lastSyncLabel(source.LastSyncedAt)}
                  </Box>
                </>,
                <>
                  {provider?.fileTags && (
                    <TextField
                      select
                      size="small"
                      label="Track details"
                      value={source.Metadata ?? 'eager'}
                      disabled={libraryBusy}
                      onChange={e => handleMetadataMode(source, e.target.value)}
                      // Grows to push REMOVE to the right edge, but only so
                      // far: six words don't need half a desktop window.
                      sx={{ minWidth: '11.5rem', maxWidth: '20rem', flex: '1 1 auto' }}
                    >
                      {METADATA_MODES.map(mode => (
                        <MenuItem key={mode.value} value={mode.value}>
                          {mode.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                  <Button
                    color="error"
                    variant="contained"
                    size="small"
                    disableElevation
                    disabled={libraryBusy}
                    onClick={() => handleRemoveSource(source)}
                  >
                    Remove
                  </Button>
                </>
              );
            })}
          </AccordionDetails>
        </Accordion>
      </ListItem>

      {row(
        'download-folder',
        <Icon icon={downloadIcon} width="2rem" />,
        'Download folder for external media',
        downloadFolder || 'Where tracks downloaded from a server are saved',
        <>
          <Button
            variant="outlined"
            size="small"
            disabled={libraryBusy}
            onClick={async () => {
              await invokeEventToMainProcess('choose-download-folder', undefined).catch(
                () => undefined
              );
              refresh();
            }}
          >
            Change
          </Button>
          <Button
            size="small"
            disabled={libraryBusy}
            onClick={async () => {
              await invokeEventToMainProcess('reset-download-folder', undefined).catch(
                () => undefined
              );
              refresh();
            }}
          >
            Default
          </Button>
        </>
      )}

      <AppDialog
        open={addOpen}
        onClose={closeDialog}
        title={addingType === '' ? 'Add External Source' : `Add ${chosen?.label ?? 'Server'}`}
        maxWidth={addingType ? 'xs' : 'sm'}
        actions={
          addingType === '' ? (
            <Button onClick={closeDialog}>Cancel</Button>
          ) : (
            <>
              {chosen?.guide && (
                <Button
                  sx={{ mr: 'auto', px: 1 }}
                  size="small"
                  startIcon={<Icon icon={helpIcon} width="1.2rem" />}
                  onClick={() => sendEventToMainProcess('open-external', { url: chosen.guide })}
                >
                  Guide
                </Button>
              )}
              <Button onClick={() => setAddingType('')}>Back</Button>
              <Button
                variant="contained"
                disableElevation
                disabled={!baseUrl || busy || (chosen?.needsAccount && (!username || !password))}
                onClick={handleConnect}
              >
                {busy ? 'Connecting…' : 'Connect'}
              </Button>
            </>
          )
        }
      >
        {addingType === '' ? (
          <Grid container spacing={1.5}>
            {providers.map(provider => (
              <Grid item xs={6} sm={4} key={provider.type}>
                <Card
                  variant="outlined"
                  sx={{ height: '100%', opacity: provider.available ? 1 : 0.5 }}
                >
                  <CardActionArea
                    disabled={!provider.available}
                    onClick={() => {
                      setAddingType(provider.type);
                      setError(null);
                      if (provider.discoverable) scan(provider.type);
                    }}
                    sx={{ p: 1.5, height: '100%' }}
                  >
                    <Stack spacing={0.75} alignItems="flex-start">
                      <Box sx={{ color: provider.accent, lineHeight: 0 }}>
                        <Icon icon={PROVIDER_ICON[provider.type] ?? serverIcon} height="1.75rem" />
                      </Box>
                      <Typography variant="subtitle2">{provider.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {provider.blurb}
                      </Typography>
                      {!provider.available && (
                        <Chip label="Coming soon" size="small" sx={{ height: 20 }} />
                      )}
                    </Stack>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              required
              label="Server address"
              placeholder={ADDRESS_HINT[addingType]?.placeholder ?? 'http://192.168.1.10:8096'}
              helperText={ADDRESS_HINT[addingType]?.helper}
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              fullWidth
              autoFocus
            />
            {chosen?.discoverable && (
              <Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle2">On your network</Typography>
                  <Button size="small" onClick={() => scan(chosen.type)} disabled={scanning}>
                    {scanning ? 'Scanning…' : 'Scan again'}
                  </Button>
                </Stack>
                {scanning && discovered === null ? (
                  <Typography variant="caption" color="text.secondary">
                    Looking for servers…
                  </Typography>
                ) : discovered?.length ? (
                  <List dense disablePadding>
                    {discovered.map(server => {
                      const added = addedAlready(server);
                      return (
                        <ListItemButton
                          key={server.address}
                          disabled={added}
                          selected={baseUrl === server.address}
                          onClick={() => setBaseUrl(server.address)}
                          sx={{ borderRadius: 1 }}
                        >
                          <ListItemText
                            primary={server.name}
                            secondary={server.address}
                            secondaryTypographyProps={{ noWrap: true }}
                          />
                          {added && <Chip label="Added" size="small" sx={{ height: 20 }} />}
                        </ListItemButton>
                      );
                    })}
                  </List>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    Nothing answered. Servers that don’t announce themselves can still be added by
                    address.
                  </Typography>
                )}
              </Box>
            )}
            {chosen?.tokenAuth && (
              <>
                <TextField
                  label="Token"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  helperText={"Plex shows it in the URL of any item's Get Info, View XML."}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && baseUrl && !busy) void handleConnect();
                  }}
                  fullWidth
                />
                <Divider sx={{ '&::before, &::after': { borderColor: 'divider' } }}>
                  <Typography variant="caption" color="text.secondary">
                    or sign in
                  </Typography>
                </Divider>
              </>
            )}
            <TextField
              required={chosen?.needsAccount}
              label="Email / Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              fullWidth
            />
            <TextField
              required={chosen?.needsAccount}
              label="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              helperText={ADDRESS_HINT[addingType]?.signIn}
              onKeyDown={e => {
                if (e.key === 'Enter' && baseUrl && !busy) void handleConnect();
              }}
              fullWidth
            />
            {chosen?.fileTags && (
              <TextField
                select
                label="Track details"
                value={metadata}
                onChange={e => setMetadata(e.target.value)}
                helperText={METADATA_MODES.find(m => m.value === metadata)?.hint}
                fullWidth
              >
                {METADATA_MODES.map(mode => (
                  <MenuItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        )}
      </AppDialog>
    </>
  );
}
