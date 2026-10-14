import path from 'path';
import fs from 'fs';
import { markArtistLookedUp, saveArtistProfile } from '../db/artists';
import { ARTIST_ART_DIR } from '../../config/core_config';

async function downloadImageToLocal(url: string, localPath: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(localPath, Buffer.from(arrayBuffer));
    return fs.existsSync(localPath) ? localPath : null;
  } catch (error) {
    console.log('Failed to download artist image to local path:', url, localPath, error);
    return null;
  }
}

export async function fetchArtistProfileImage(
  artistName: string,
  provider?: string,
  artistId?: number
): Promise<string | null> {
  const encoded = encodeURIComponent(artistName.trim());
  if (!encoded) return null;

  const localFilePath = artistId ? path.join(ARTIST_ART_DIR, `${artistId}.jpg`) : null;

  if (artistId && fs.existsSync(localFilePath!)) {
    return localFilePath;
  }

  // Throws on network failure rather than returning null, so the sweep can tell
  // "offline" from "no such artist" and not stamp the whole library as tried.
  const response = await fetch(`https://www.theaudiodb.com/api/v1/json/123/search.php?s=${encoded}`);
  if (!response.ok) throw new Error(`TheAudioDB search failed: ${response.status}`);

  const json = (await response.json()) as any;
  const artistData = json?.artists?.[0];

  if (!artistId) {
    if (!artistData) return null;
    return (
      artistData.strArtistThumb || artistData.strArtistFanart || artistData.strArtistLogo || null
    );
  }

  if (!artistData) {
    // Stamp the miss, or the sweep re-asks about unknown artists every pass.
    markArtistLookedUp(artistId);
    return null;
  }

  const candidate =
    artistData.strArtistThumb || artistData.strArtistFanart || artistData.strArtistLogo || null;

  let resolvedImageUri: string | null = null;
  if (candidate) {
    const downloaded = await downloadImageToLocal(candidate, localFilePath!);
    resolvedImageUri = downloaded || candidate;
  }

  saveArtistProfile(artistId, resolvedImageUri, JSON.stringify(artistData));

  if (resolvedImageUri) return resolvedImageUri;
  return localFilePath && fs.existsSync(localFilePath) ? localFilePath : null;
}
