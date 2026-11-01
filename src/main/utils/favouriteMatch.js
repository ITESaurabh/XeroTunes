// How an exported favourite finds its track again. TrackIds don't survive a
// database wipe or a different install, so a .xtfav entry carries the file's hash
// and its filename instead. The hash survives a rename, and for MP3 a tag edit;
// the filename catches the rest, including entries exported under an older hash
// scheme. Plain JS with no deps so the main process and test_favouriteMatch.js
// can both load it.
const path = require('path');

function buildTrackIndex(tracks) {
  const byHash = new Map();
  const byName = new Map();
  for (const track of tracks || []) {
    if (!track) continue;
    if (track.FileHash && !byHash.has(track.FileHash)) byHash.set(track.FileHash, track.Id);
    // First one wins: two files with the same name in different folders are
    // indistinguishable once the hash has missed.
    const name = path.basename(track.Uri || '').toLowerCase();
    if (name && !byName.has(name)) byName.set(name, track.Id);
  }
  return { byHash, byName };
}

function matchFavourite(index, entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.hash) {
    const hashed = index.byHash.get(entry.hash);
    if (hashed != null) return hashed;
  }
  const name = String(entry.file || '').toLowerCase();
  const named = name ? index.byName.get(name) : undefined;
  return named == null ? null : named;
}

module.exports = { buildTrackIndex, matchFavourite };
