// How an exported favourite, playlist entry or play count finds its track again.
// TrackIds don't survive a database wipe or a different install, so an entry
// carries the track's address, the file's hash and its filename instead. The
// address matches on the same machine, the hash survives a rename (and for MP3 a
// tag edit), and the filename catches the rest, including entries exported under
// an older hash scheme. Plain JS with no deps so the main process and test_favouriteMatch.js
// can both load it.
const path = require('path');

function buildTrackIndex(tracks) {
  const byUri = new Map();
  const byHash = new Map();
  const byName = new Map();
  for (const track of tracks || []) {
    if (!track) continue;
    if (track.Uri && !byUri.has(track.Uri)) byUri.set(track.Uri, track.Id);
    if (track.FileHash && !byHash.has(track.FileHash)) byHash.set(track.FileHash, track.Id);
    // Every Jellyfin/Emby stream ends in `universal?...`, so URLs have no usable filename.
    if (/^https?:\/\//i.test(track.Uri || '')) continue;
    // First one wins: two files with the same name in different folders are
    // indistinguishable once the hash has missed.
    const name = path.basename(track.Uri || '').toLowerCase();
    if (name && !byName.has(name)) byName.set(name, track.Id);
  }
  return { byUri, byHash, byName };
}

// Callers leave `file` off where a wrong match costs more than none (play counts).
function matchFavourite(index, entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.uri) {
    const exact = index.byUri.get(entry.uri);
    if (exact != null) return exact;
  }
  if (entry.hash) {
    const hashed = index.byHash.get(entry.hash);
    if (hashed != null) return hashed;
  }
  const name = String(entry.file || '').toLowerCase();
  const named = name ? index.byName.get(name) : undefined;
  return named == null ? null : named;
}

module.exports = { buildTrackIndex, matchFavourite };
