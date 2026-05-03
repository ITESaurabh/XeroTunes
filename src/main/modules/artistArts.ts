import path from 'path';
import fs from 'fs';
import db from '../../database';
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

  // local cache first
  if (artistId && fs.existsSync(localFilePath!)) {
    return localFilePath;
  }

  // 1) Try TheAudioDB
  try {
    const response = await fetch(
      `https://www.theaudiodb.com/api/v1/json/123/search.php?s=${encoded}`
    );

    if (response.ok) {
      const json = (await response.json()) as any;
      const artistData = json?.artists?.[0];
      if (artistData) {
        const profileMetaJson = JSON.stringify(artistData);
        console.log(artistData);
        const candidate =
          artistData.strArtistThumb ||
          artistData.strArtistFanart ||
          artistData.strArtistLogo ||
          null;

        let resolvedImageUri: string | null = null;
        if (candidate && artistId) {
          const downloaded = await downloadImageToLocal(candidate, localFilePath!);
          resolvedImageUri = downloaded || candidate;
        } else if (candidate) {
          resolvedImageUri = candidate;
        }

        if (artistId) {
          const update = db.prepare(
            'UPDATE Artist SET ProfileImgUri = ?, ArtistMetaJson = ? WHERE Id = ?'
          );
          update.run(resolvedImageUri, profileMetaJson, artistId);

          if (resolvedImageUri) {
            return resolvedImageUri;
          }
          // return local cached image for this artist if still present
          if (localFilePath && fs.existsSync(localFilePath)) {
            return localFilePath;
          }
          return null;
        }

        return resolvedImageUri;
      }
    }
  } catch (error) {
    console.log('Failed to fetch artist image from TheAudioDB:', artistName, error);
  }

  return null;
}
