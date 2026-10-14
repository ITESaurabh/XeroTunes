import path from 'path';
import fs from 'fs';
import { BrowserWindow, ipcMain } from 'electron';
import * as artists from '../db/artists';
import { fetchArtistProfileImage } from '../modules/artistArts';
import { startArtistSweep, wakeArtistSweep } from '../modules/artistSweep';
import { ARTIST_ART_DIR } from '../../config/core_config';

/** A miss is only retried when the user asks, so an answered artist never refetches. */
async function resolveDetailArt(artist: artists.ArtistRow): Promise<string | null> {
  if (artist.ProfileImgUri || artist.ArtistFetchedAt) {
    const localPath = path.join(ARTIST_ART_DIR, `${artist.Id}.jpg`);
    if (fs.existsSync(localPath)) return localPath;
    return artist.ProfileImgUri;
  }
  try {
    return await fetchArtistProfileImage(artist.Name, undefined, artist.Id);
  } catch {
    return null;
  }
}

export function registerArtistIpc(
  mainWin: BrowserWindow,
  isFetchingEnabled: () => boolean
): void {
  ipcMain.handle('get-all-artists', () => artists.listArtists());
  ipcMain.handle('get-all-album-artists', () => artists.listAlbumArtists());
  ipcMain.handle('get-artist-meta', (e, { artistId }) => artists.getArtistMeta(artistId));
  ipcMain.handle('get-artist-songs', (e, { artistId }) => artists.listArtistSongs(artistId));
  ipcMain.handle('get-artist-albums', (e, { artistId }) => artists.listArtistAlbums(artistId));
  ipcMain.handle('get-album-artist-songs', (e, { artistId }) =>
    artists.listAlbumArtistSongs(artistId)
  );
  ipcMain.handle('get-album-artist-albums', (e, { artistId }) =>
    artists.listAlbumArtistAlbums(artistId)
  );

  ipcMain.handle('find-artist-by-name', (e, { name }) => {
    if (!name || typeof name !== 'string') return null;
    const id = artists.findArtistIdByName(name);
    return id === null ? null : { id };
  });

  ipcMain.handle('get-artist-detail', async (e, { artistId }) => {
    const artist = artists.getArtist(artistId);
    if (!artist) return null;
    const profilePath = await resolveDetailArt(artist);
    return {
      Id: artist.Id,
      Name: artist.Name,
      ProfileImgUri: profilePath,
      ProfileImg: profilePath,
      SongCount: artists.countArtistSongs(artistId),
      AlbumCount: artists.countArtistAlbums(artistId),
    };
  });

  ipcMain.handle('get-album-artist-detail', async (e, { artistId }) => {
    const artist = artists.getArtist(artistId);
    if (!artist) return null;
    const profilePath = await resolveDetailArt(artist);
    return {
      Id: artist.Id,
      Name: artist.Name,
      ProfileImgUri: profilePath,
      ProfileImg: profilePath,
      SongCount: artists.countAlbumArtistSongs(artistId),
      AlbumCount: artists.countAlbumArtistAlbums(artistId),
    };
  });

  ipcMain.handle('fetch-artist-profile-image', async (e, { artistId }) => {
    if (!artistId || typeof artistId !== 'number') return null;
    const artist = artists.getArtist(artistId);
    if (!artist || !artist.Name) return null;

    const existingUri = artist.ProfileImgUri?.trim() ? artist.ProfileImgUri : null;
    if (existingUri) {
      const isRemote = existingUri.startsWith('http://') || existingUri.startsWith('https://');
      if (isRemote || fs.existsSync(existingUri)) return existingUri;
    }

    const localPath = path.join(ARTIST_ART_DIR, `${artistId}.jpg`);
    if (fs.existsSync(localPath)) return localPath;

    try {
      return await fetchArtistProfileImage(artist.Name, undefined, artistId);
    } catch {
      return null;
    }
  });

  ipcMain.handle('force-fetch-artist-profile-image', async (e, { artistId }) => {
    if (!artistId || typeof artistId !== 'number') return null;
    const artist = artists.getArtist(artistId);
    if (!artist || !artist.Name) return null;

    const localPath = path.join(ARTIST_ART_DIR, `${artistId}.jpg`);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    artists.clearArtistProfile(artistId);

    try {
      return await fetchArtistProfileImage(artist.Name, undefined, artistId);
    } catch {
      return null;
    }
  });

  ipcMain.handle('get-missed-artist-count', () => artists.countMissedArtists());

  ipcMain.handle('retry-missed-artists', () => {
    const changes = artists.clearMissedArtists();
    wakeArtistSweep();
    return changes;
  });

  startArtistSweep({
    isEnabled: isFetchingEnabled,
    onFetched: (artistId, uri) => {
      if (!mainWin.isDestroyed()) {
        mainWin.webContents.send('artist-image-updated', { artistId, uri });
      }
    },
  });
}
