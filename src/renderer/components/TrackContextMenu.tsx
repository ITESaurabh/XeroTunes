import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Alert,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
} from '@mui/material';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import queueIcon from '@iconify/icons-fluent/apps-list-24-regular';
import playlistAddIcon from '@iconify/icons-fluent/text-bullet-list-add-24-regular';
import heartIcon from '@iconify/icons-fluent/heart-24-regular';
import heartOffIcon from '@iconify/icons-fluent/heart-off-24-regular';
import albumIcon from '@iconify/icons-fluent/album-24-regular';
import artistIcon from '@iconify/icons-fluent/mic-24-regular';
import editIcon from '@iconify/icons-fluent/edit-24-regular';
import infoIcon from '@iconify/icons-fluent/info-24-regular';
import revealIcon from '@iconify/icons-fluent/folder-arrow-right-24-regular';
import chevronRightIcon from '@iconify/icons-fluent/chevron-right-20-regular';
import DownloadMenuItem from './DownloadMenuItem';
import { useNewPlaylist } from './NewPlaylistItem';
import SongInfoDialog from './SongInfoDialog';
import TagEditorDialog, { EditableTrack } from './TagEditorDialog';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { isTaggable } from '../../config/constants';

interface PlaylistRow {
  Id: number;
  Name: string;
}

export interface TrackMenuState {
  top: number;
  left: number;
  song: Track;
}

const isRemoteUri = (uri: unknown) => typeof uri === 'string' && /^https?:\/\//i.test(uri);

/**
 * The right-click menu every track row shares. `extra` prepends caller-specific
 * items (e.g. "Remove from playlist") and hands them the close callback.
 */
export function useTrackMenu(extra?: (_song: Track, _close: () => void) => React.ReactNode) {
  const [menu, setMenu] = useState<TrackMenuState | null>(null);

  const openTrackMenu = useCallback((e: React.MouseEvent, song: Track) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ top: e.clientY, left: e.clientX, song });
  }, []);

  const trackMenu = <TrackContextMenu menu={menu} onClose={() => setMenu(null)} extra={extra} />;

  return { openTrackMenu, trackMenu };
}

interface Props {
  menu: TrackMenuState | null;
  onClose: () => void;
  extra?: (_song: Track, _close: () => void) => React.ReactNode;
}

const TrackContextMenu: React.FC<Props> = ({ menu, onClose, extra }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { invokeEventToMainProcess } = useIpc();
  const { state, dispatch } = useContext(store);

  const [playlistAnchor, setPlaylistAnchor] = useState<HTMLElement | null>(null);
  const [infoSong, setInfoSong] = useState<Track | null>(null);
  const [editTracks, setEditTracks] = useState<EditableTrack[] | null>(null);
  const [isFavourite, setIsFavourite] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const song = menu?.song ?? null;
  const uri = song?.Uri;
  const trackId = song?.Id;
  const isRemote = isRemoteUri(uri);

  useEffect(() => {
    if (trackId == null) return;
    let cancelled = false;
    void invokeEventToMainProcess('is-favourite', { trackId })
      .then(v => {
        if (!cancelled) setIsFavourite(!!v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [trackId, invokeEventToMainProcess]);

  const { data: playlists } = useQuery({
    queryKey: [QUERY_KEYS.PLAYLISTS],
    queryFn: () => invokeEventToMainProcess('get-playlists') as Promise<PlaylistRow[]>,
    enabled: !!playlistAnchor,
  });

  const close = useCallback(() => {
    setPlaylistAnchor(null);
    onClose();
  }, [onClose]);

  const { newPlaylistItem, newPlaylistDialog } = useNewPlaylist(
    useCallback(() => (song?.Id != null ? [song.Id as string | number] : []), [song]),
    close,
    useCallback((name: string) => setToast(`Added to ${name}`), [])
  );

  const handleEnqueue = useCallback(
    (next: boolean) => {
      if (!song) return;
      close();
      // Nothing playing yet, so there is no queue to slot into; start it instead.
      if (!state.track) {
        dispatch({ type: 'SET_QUEUE', payload: { queue: [song], index: 0 } });
        dispatch({ type: 'SET_CURR_TRACK', payload: song });
        dispatch({ type: 'SET_IS_PLAYING', payload: true });
        return;
      }
      dispatch({ type: 'ENQUEUE', payload: { tracks: [song], next } });
      setToast(next ? 'Playing next' : 'Added to queue');
    },
    [song, state.track, dispatch, close]
  );

  const handleAddToPlaylist = useCallback(
    async (playlist: PlaylistRow) => {
      if (!song) return;
      close();
      const res = (await invokeEventToMainProcess('add-tracks-to-playlist', {
        playlistId: playlist.Id,
        trackIds: [song.Id],
      })) as { added: number };
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PLAYLIST_TRACKS] });
      setToast(`Added ${res.added} to ${playlist.Name}`);
    },
    [song, invokeEventToMainProcess, queryClient, close]
  );


  const handleToggleFavourite = useCallback(async () => {
    if (trackId == null) return;
    close();
    const res = (await invokeEventToMainProcess('toggle-favourite', { trackId })) as {
      favourite?: boolean;
    };
    await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.FAVOURITE_SONGS] });
    setToast(res?.favourite ? 'Added to favourites' : 'Removed from favourites');
  }, [trackId, invokeEventToMainProcess, queryClient, close]);

  const handleGoToArtist = useCallback(async () => {
    const raw = song?.ArtistName as string | undefined;
    const name = raw?.split(',')[0]?.trim();
    close();
    if (!name) return;
    const res = (await invokeEventToMainProcess('find-artist-by-name', { name })) as {
      id?: number;
    };
    if (res?.id) navigate(`/main_window/artists/${res.id}`);
  }, [song, invokeEventToMainProcess, navigate, close]);

  return (
    <>
      <Menu
        open={menu !== null}
        onClose={close}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.top, left: menu.left } : undefined}
      >
        {song && extra?.(song, close)}

        <MenuItem onClick={() => handleEnqueue(true)}>
          <ListItemIcon>
            <Icon icon={playIcon} width={20} />
          </ListItemIcon>
          <ListItemText>Play next</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleEnqueue(false)}>
          <ListItemIcon>
            <Icon icon={queueIcon} width={20} />
          </ListItemIcon>
          <ListItemText>Add to queue</ListItemText>
        </MenuItem>
        <MenuItem onClick={e => setPlaylistAnchor(e.currentTarget)}>
          <ListItemIcon>
            <Icon icon={playlistAddIcon} width={20} />
          </ListItemIcon>
          <ListItemText>Add to playlist</ListItemText>
          <Icon icon={chevronRightIcon} width={18} style={{ marginLeft: 8, opacity: 0.6 }} />
        </MenuItem>
        <MenuItem onClick={handleToggleFavourite} disabled={trackId == null}>
          <ListItemIcon>
            <Icon icon={isFavourite ? heartOffIcon : heartIcon} width={20} />
          </ListItemIcon>
          <ListItemText>
            {isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          </ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem
          disabled={song?.AlbumId == null}
          onClick={() => {
            close();
            navigate(`/main_window/albums/${song?.AlbumId}`);
          }}
        >
          <ListItemIcon>
            <Icon icon={albumIcon} width={20} />
          </ListItemIcon>
          <ListItemText>Go to album</ListItemText>
        </MenuItem>
        <MenuItem disabled={!song?.ArtistName} onClick={handleGoToArtist}>
          <ListItemIcon>
            <Icon icon={artistIcon} width={20} />
          </ListItemIcon>
          <ListItemText>Go to artist</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem
          disabled={typeof uri !== 'string' || !isTaggable(uri)}
          onClick={() => {
            if (song?.Id != null && typeof uri === 'string') {
              setEditTracks([
                { Id: song.Id as number | string, Uri: uri, Title: song.Title as string },
              ]);
            }
            close();
          }}
        >
          <ListItemIcon>
            <Icon icon={editIcon} width={20} />
          </ListItemIcon>
          <ListItemText>Edit tags</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={isRemote || typeof uri !== 'string'}
          onClick={() => {
            void invokeEventToMainProcess('reveal-file', { filePath: uri });
            close();
          }}
        >
          <ListItemIcon>
            <Icon icon={revealIcon} width={20} />
          </ListItemIcon>
          <ListItemText>Show in file explorer</ListItemText>
        </MenuItem>
        <DownloadMenuItem song={song} onDone={close} />
        <MenuItem
          onClick={() => {
            setInfoSong(song);
            close();
          }}
        >
          <ListItemIcon>
            <Icon icon={infoIcon} width={20} />
          </ListItemIcon>
          <ListItemText>Properties</ListItemText>
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={playlistAnchor}
        open={!!playlistAnchor}
        onClose={() => setPlaylistAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {newPlaylistItem}
        {!!playlists?.length && <Divider />}
        {(playlists ?? []).map(p => (
          <MenuItem key={p.Id} onClick={() => handleAddToPlaylist(p)}>
            {p.Name}
          </MenuItem>
        ))}
      </Menu>

      {newPlaylistDialog}

      <SongInfoDialog
        open={infoSong !== null}
        onClose={() => setInfoSong(null)}
        track={infoSong}
        songPath={(infoSong?.Uri as string) ?? null}
      />

      {editTracks && (
        <TagEditorDialog open onClose={() => setEditTracks(null)} mode="track" tracks={editTracks} />
      )}

      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setToast(null)}>
          {toast}
        </Alert>
      </Snackbar>
    </>
  );
};

export default TrackContextMenu;
