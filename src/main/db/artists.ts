import path from 'path';
import fs from 'fs';
import db from './index';
import { TRACK_ARTIST_NAMES } from './fragments';
import { ALBUM_ART_DIR, ARTIST_ART_DIR } from '../../config/core_config';

const MISSED_ARTISTS_WHERE = `ProfileImgUri IS NULL
      AND ArtistFetchedAt IS NOT NULL
      AND Name IS NOT NULL AND TRIM(Name) <> ''`;

export interface ArtistRow {
  Id: number;
  Name: string;
  ProfileImgUri: string | null;
  ArtistFetchedAt: number | null;
}

export interface PendingArtist {
  Id: number;
  Name: string;
}

interface ArtistListRow {
  Id: number;
  Name: string;
  ProfileImgUri: string | null;
  SongCount: number;
  AlbumCount: number;
}

interface AlbumListRow {
  Id: number;
  Title: string;
  ReleaseYear: number | null;
  CoverUri: string | null;
  SongCount: number;
}

function withArtistArt(row: ArtistListRow) {
  const localPath = path.join(ARTIST_ART_DIR, `${row.Id}.jpg`);
  const profilePath = fs.existsSync(localPath) ? localPath : (row.ProfileImgUri ?? null);
  return {
    Id: row.Id,
    Name: row.Name,
    ProfileImgUri: profilePath,
    ProfileImg: profilePath,
    SongCount: row.SongCount,
    AlbumCount: row.AlbumCount,
  };
}

function scalarCount(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
}

function withAlbumCover(album: AlbumListRow) {
  const coverPath = path.join(ALBUM_ART_DIR, `${album.Id}.jpg`);
  return {
    ...album,
    coverUri: album.CoverUri || (fs.existsSync(coverPath) ? coverPath : null),
  };
}

export function listArtists() {
  return db
    .prepare(
      `
      SELECT
        Artist.Id,
        Artist.Name,
        Artist.ProfileImgUri,
        COUNT(DISTINCT TrackArtist.TrackId) AS SongCount,
        COUNT(DISTINCT Track.AlbumId) AS AlbumCount
      FROM Artist
      LEFT JOIN TrackArtist ON Artist.Id = TrackArtist.ArtistId
      LEFT JOIN Track ON TrackArtist.TrackId = Track.Id
      GROUP BY Artist.Id
      HAVING COUNT(DISTINCT TrackArtist.TrackId) > 0
      ORDER BY Artist.Name COLLATE NOCASE
    `
    )
    .all()
    .map(row => withArtistArt(row as ArtistListRow));
}

export function listAlbumArtists() {
  return db
    .prepare(
      `
      SELECT
        Artist.Id,
        Artist.Name,
        Artist.ProfileImgUri,
        COUNT(DISTINCT AlbumArtist.AlbumId) AS AlbumCount,
        COUNT(DISTINCT Track.Id) AS SongCount
      FROM Artist
      JOIN AlbumArtist ON Artist.Id = AlbumArtist.ArtistId
      LEFT JOIN Album ON AlbumArtist.AlbumId = Album.Id
      LEFT JOIN Track ON Album.Id = Track.AlbumId
      GROUP BY Artist.Id
      ORDER BY Artist.Name COLLATE NOCASE
    `
    )
    .all()
    .map(row => withArtistArt(row as ArtistListRow));
}

export function getArtist(artistId: number): ArtistRow | undefined {
  return db
    .prepare('SELECT Id, Name, ProfileImgUri, ArtistFetchedAt FROM Artist WHERE Id = ?')
    .get(artistId) as ArtistRow | undefined;
}

export function findArtistIdByName(name: string): number | null {
  const row = db.prepare('SELECT Id FROM Artist WHERE LOWER(Name) = LOWER(?) LIMIT 1').get(name) as
    | { Id: number }
    | undefined;
  return row?.Id ?? null;
}

export function getArtistMeta(artistId: number): Record<string, unknown> | null {
  const artist = db.prepare('SELECT ArtistMetaJson FROM Artist WHERE Id = ?').get(artistId) as
    | { ArtistMetaJson: string | null }
    | undefined;
  if (!artist?.ArtistMetaJson) return null;
  try {
    return JSON.parse(artist.ArtistMetaJson);
  } catch {
    console.warn('Failed to parse ArtistMetaJson for artist', artistId);
    return null;
  }
}

export function countArtistSongs(artistId: number): number {
  return scalarCount('SELECT COUNT(*) AS count FROM TrackArtist WHERE ArtistId = ?', artistId);
}

export function countArtistAlbums(artistId: number): number {
  return scalarCount('SELECT COUNT(*) AS count FROM AlbumArtist WHERE ArtistId = ?', artistId);
}

export function listArtistSongs(artistId: number) {
  return db
    .prepare(
      `
      SELECT
        Track.Id,
        Track.Title,
        Track.Uri,
        Track.Extension,
        Track.Year,
        Track.TrackNumber,
        Track.AlbumArt,
        Track.Duration,
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle,
        Album.Id AS AlbumId,
        Genre.Name AS GenreName
      FROM Track
      JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.Id IN (
        SELECT TrackId FROM TrackArtist WHERE ArtistId = ?
        UNION
        SELECT Id FROM Track WHERE ArtistId = ?
      )
      GROUP BY Track.Id
      ORDER BY COALESCE(CAST(Track.TrackNumber AS INTEGER), 9999), Track.Title COLLATE NOCASE
    `
    )
    .all(artistId, artistId);
}

export function listArtistAlbums(artistId: number) {
  return db
    .prepare(
      `
      SELECT
        Album.Id,
        Album.Title,
        COALESCE(
          Album.ReleaseYear,
          MIN(CAST(Track.ReleaseYear AS INTEGER)),
          MIN(CAST(Track.Year AS INTEGER))
        ) AS ReleaseYear,
        Album.CoverUri,
        COUNT(Track.Id) AS SongCount
      FROM Album
      JOIN Track ON Album.Id = Track.AlbumId
      JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      WHERE TrackArtist.ArtistId = ?
      GROUP BY Album.Id
      ORDER BY Album.Title COLLATE NOCASE
    `
    )
    .all(artistId)
    .map(row => withAlbumCover(row as AlbumListRow));
}

export function countAlbumArtistSongs(artistId: number): number {
  return scalarCount(
    `
      SELECT
        COUNT(DISTINCT Track.Id) AS count
      FROM Track
      JOIN Album ON Track.AlbumId = Album.Id
      JOIN AlbumArtist ON Album.Id = AlbumArtist.AlbumId
      WHERE AlbumArtist.ArtistId = ?
    `,
    artistId
  );
}

export function countAlbumArtistAlbums(artistId: number): number {
  return scalarCount(
    'SELECT COUNT(DISTINCT AlbumId) AS count FROM AlbumArtist WHERE ArtistId = ?',
    artistId
  );
}

export function listAlbumArtistSongs(artistId: number) {
  return db
    .prepare(
      `
      SELECT
        Track.Id,
        Track.Title,
        Track.Uri,
        Track.Extension,
        Track.Year,
        Track.TrackNumber,
        Track.AlbumArt,
        Track.Duration,
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle,
        Album.Id AS AlbumId,
        Genre.Name AS GenreName
      FROM Track
      JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.Id IN (
        SELECT Track.Id FROM Track
        JOIN Album ON Track.AlbumId = Album.Id
        JOIN AlbumArtist ON Album.Id = AlbumArtist.AlbumId
        WHERE AlbumArtist.ArtistId = ?
      )
      GROUP BY Track.Id
      ORDER BY COALESCE(CAST(Track.TrackNumber AS INTEGER), 9999), Track.Title COLLATE NOCASE
    `
    )
    .all(artistId);
}

export function listAlbumArtistAlbums(artistId: number) {
  return db
    .prepare(
      `
      SELECT
        Album.Id,
        Album.Title,
        COALESCE(
          Album.ReleaseYear,
          MIN(CAST(Track.ReleaseYear AS INTEGER)),
          MIN(CAST(Track.Year AS INTEGER))
        ) AS ReleaseYear,
        Album.CoverUri,
        COUNT(Track.Id) AS SongCount
      FROM Album
      JOIN AlbumArtist ON Album.Id = AlbumArtist.AlbumId
      LEFT JOIN Track ON Album.Id = Track.AlbumId
      WHERE AlbumArtist.ArtistId = ?
      GROUP BY Album.Id
      ORDER BY Album.Title COLLATE NOCASE
    `
    )
    .all(artistId)
    .map(row => withAlbumCover(row as AlbumListRow));
}

export function saveArtistProfile(
  artistId: number,
  profileImgUri: string | null,
  metaJson: string
): void {
  db.prepare(
    'UPDATE Artist SET ProfileImgUri = ?, ArtistMetaJson = ?, ArtistFetchedAt = ? WHERE Id = ?'
  ).run(profileImgUri, metaJson, Date.now(), artistId);
}

export function markArtistLookedUp(artistId: number): void {
  db.prepare('UPDATE Artist SET ArtistFetchedAt = ? WHERE Id = ?').run(Date.now(), artistId);
}

export function clearArtistProfile(artistId: number): void {
  db.prepare(
    'UPDATE Artist SET ProfileImgUri = NULL, ArtistMetaJson = NULL, ArtistFetchedAt = NULL WHERE Id = ?'
  ).run(artistId);
}

/**
 * Artists never looked up before. A lookup that came back empty stays excluded;
 * TheAudioDB has no entry for a lot of local-library artists, and re-asking on a
 * timer spends its rate budget on answers that won't change. Retry is manual.
 */
export function pendingArtists(limit: number): PendingArtist[] {
  return db
    .prepare(
      `SELECT Id, Name FROM Artist
        WHERE Name IS NOT NULL AND TRIM(Name) <> ''
          AND ProfileImgUri IS NULL
          AND ArtistFetchedAt IS NULL
        ORDER BY Id
        LIMIT ?`
    )
    .all(limit) as PendingArtist[];
}

export function countMissedArtists(): number {
  return scalarCount(`SELECT COUNT(*) AS count FROM Artist WHERE ${MISSED_ARTISTS_WHERE}`);
}

export function clearMissedArtists(): number {
  return db
    .prepare(`UPDATE Artist SET ArtistFetchedAt = NULL WHERE ${MISSED_ARTISTS_WHERE}`)
    .run().changes;
}
