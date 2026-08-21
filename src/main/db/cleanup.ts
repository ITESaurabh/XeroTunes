/**
 * Orphan cleanup, shared by the scan worker and the main process. The worker owns
 * its own better-sqlite3 connection, so `db` is passed in; importing ./index there
 * would open a second handle on the same file.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'path';
import fs from 'fs';

export interface ArtDirs {
  ALBUM_ART_DIR?: string;
  ARTIST_ART_DIR?: string;
}

// Diffing disk against the DB, rather than tracking what we just deleted, also
// clears art left behind by older scan logic that never cleaned up.
function sweepOrphanArt(dir: string | undefined, liveIds: Iterable<number>, prefix = ''): number {
  if (!dir) return 0;
  let removed = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const live = new Set(liveIds);
    const pattern = new RegExp(`^${prefix}(\\d+)\\.jpg$`, 'i');
    for (const file of fs.readdirSync(dir)) {
      const m = pattern.exec(file);
      if (!m) continue;
      if (live.has(Number(m[1]))) continue;
      try {
        fs.unlinkSync(path.join(dir, file));
        removed++;
      } catch (err: any) {
        console.warn('[cleanup] Failed to remove', file, err?.message || err);
      }
    }
  } catch (err: any) {
    console.warn('[cleanup] Sweep failed for', dir, err?.message || err);
  }
  return removed;
}

export function cleanupOrphans(db: any, config: ArtDirs = {}): void {
  db.prepare(
    'DELETE FROM Album WHERE Id NOT IN (SELECT AlbumId FROM Track WHERE AlbumId IS NOT NULL)'
  ).run();
  db.prepare('DELETE FROM TrackArtist WHERE TrackId NOT IN (SELECT Id FROM Track)').run();
  db.prepare('DELETE FROM AlbumArtist WHERE AlbumId NOT IN (SELECT Id FROM Album)').run();
  db.prepare('DELETE FROM AlbumArtist WHERE ArtistId NOT IN (SELECT Id FROM Artist)').run();
  db.prepare(
    `DELETE FROM Artist
     WHERE Id NOT IN (
       SELECT ArtistId FROM TrackArtist WHERE ArtistId IS NOT NULL
       UNION
       SELECT ArtistId FROM AlbumArtist WHERE ArtistId IS NOT NULL
     )`
  ).run();
  db.prepare(
    'DELETE FROM Genre WHERE Id NOT IN (SELECT GenreId FROM Track WHERE GenreId IS NOT NULL)'
  ).run();

  const liveAlbumIds = db
    .prepare('SELECT Id FROM Album')
    .all()
    .map((r: any) => r.Id);
  const liveArtistIds = db
    .prepare('SELECT Id FROM Artist')
    .all()
    .map((r: any) => r.Id);
  const liveTrackIds = db
    .prepare('SELECT Id FROM Track')
    .all()
    .map((r: any) => r.Id);
  const albumArtRemoved =
    sweepOrphanArt(config.ALBUM_ART_DIR, liveAlbumIds) +
    // track-<id>.jpg: a per-track cover, written when a tag edit must not disturb
    // the rest of the album sharing one cache file.
    sweepOrphanArt(config.ALBUM_ART_DIR, liveTrackIds, 'track-');
  const artistArtRemoved = sweepOrphanArt(config.ARTIST_ART_DIR, liveArtistIds);
  if (albumArtRemoved > 0 || artistArtRemoved > 0) {
    console.log(
      `[cleanup] Removed ${albumArtRemoved} album art file(s), ${artistArtRemoved} artist art file(s).`
    );
  }
}
