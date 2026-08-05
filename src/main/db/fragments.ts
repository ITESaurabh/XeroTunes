export const TRACK_ARTIST_NAMES = `(
        SELECT GROUP_CONCAT(ar.Name, ', ' ORDER BY ta.Id)
        FROM TrackArtist ta
        JOIN Artist ar ON ar.Id = ta.ArtistId
        WHERE ta.TrackId = Track.Id
      ) AS ArtistName`;

export function albumArtistNames(alias: string): string {
  return `(
        SELECT GROUP_CONCAT(ar.Name, ', ' ORDER BY aa.Id)
        FROM AlbumArtist aa
        JOIN Artist ar ON ar.Id = aa.ArtistId
        WHERE aa.AlbumId = Album.Id
      ) AS ${alias}`;
}
