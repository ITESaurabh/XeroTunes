// "Same song" duplicates: copies whose audio differs (another rip, another
// bitrate) but whose tags say they are the same recording. Plain JS with no deps
// so the main process and test_duplicateGroups.js can both load it.

// Live and extended cuts often share title, artist and album with the album
// version but run longer than this.
const DURATION_TOLERANCE_SECONDS = 2;

const norm = value =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

// ArtistName is concatenated in link order, which two scans of the same tag
// don't always agree on.
function songKey(track) {
  const title = norm(track.Title);
  if (!title) return null;
  const artists = norm(track.ArtistName).split(', ').sort().join(', ');
  return `${title}\0${artists}\0${norm(track.AlbumTitle)}`;
}

const byQuality = (a, b) =>
  (b.BitRate || 0) - (a.BitRate || 0) || (a.DateAdded || 0) - (b.DateAdded || 0) || a.Id - b.Id;

/** Groups of 2+ tracks, each sorted best first. Tracks need a FileHash. */
function sameSongGroups(tracks) {
  const byKey = new Map();
  for (const track of tracks || []) {
    const key = songKey(track);
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(track);
    else byKey.set(key, [track]);
  }

  const runs = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.Duration || 0) - (b.Duration || 0));
    // Measured from the run's shortest copy, so the tolerance can't chain
    // 200s, 202s and 204s into one group.
    let run = [];
    for (const track of list) {
      if (
        run.length &&
        (track.Duration || 0) - (run[0].Duration || 0) > DURATION_TOLERANCE_SECONDS
      ) {
        runs.push(run);
        run = [];
      }
      run.push(track);
    }
    runs.push(run);
  }

  // A run whose copies all share one hash is identical, and that list already has it.
  return runs
    .filter(run => new Set(run.map(t => t.FileHash)).size > 1)
    .map(run => run.sort(byQuality));
}

module.exports = { sameSongGroups };
