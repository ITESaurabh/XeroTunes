/* eslint-disable @typescript-eslint/no-var-requires */
// Rules that decide what the library contains: how an artist tag splits into
// artists, and whether a file still belongs to a music folder. Plain JS with no
// deps so the scan worker, the main process and test_libraryRules.js can all load it.
const path = require('path');

let multiArtistSeparators = [',', '&'];
let multiArtistExceptions = ['AC/DC', '+/-'];

function applyLibrarySettings(librarySettings) {
  if (!librarySettings) return;
  if (Array.isArray(librarySettings.multiArtistSeparators)) {
    multiArtistSeparators = librarySettings.multiArtistSeparators;
  }
  if (Array.isArray(librarySettings.multiArtistExceptions)) {
    multiArtistExceptions = librarySettings.multiArtistExceptions;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeArtistName(raw) {
  if (!raw) return '';

  if (typeof raw === 'object') {
    if (typeof raw.name === 'string' && raw.name.trim()) {
      return raw.name.trim().replace(/\s+/g, ' ');
    }
    if (typeof raw.artist === 'string' && raw.artist.trim()) {
      return raw.artist.trim().replace(/\s+/g, ' ');
    }
    return String(raw).trim().replace(/\s+/g, ' ');
  }

  return String(raw).trim().replace(/\s+/g, ' ');
}

function isException(name) {
  return multiArtistExceptions.some(exc => exc.toLowerCase() === name.toLowerCase());
}

function splitArtists(rawArtist) {
  const artistList = [];

  if (!rawArtist) return artistList;

  if (Array.isArray(rawArtist)) {
    rawArtist.forEach(item => {
      const normalized = normalizeArtistName(item);
      if (normalized) artistList.push(normalized);
    });
  } else {
    artistList.push(normalizeArtistName(rawArtist));
  }

  const result = [];

  artistList.forEach(raw => {
    const normalized = normalizeArtistName(raw);
    if (!normalized) return;

    // Separators come from user-edited settings; a blank one would compile to a
    // regex that matches between every character and shred the name.
    const separators = multiArtistSeparators.filter(Boolean);
    if (isException(normalized) || !separators.length) {
      result.push(normalized);
      return;
    }

    const sepPattern = separators.map(escapeRegex).join('|');
    normalized.split(new RegExp(`\\s*(?:${sepPattern})\\s*`, 'g')).forEach(piece => {
      const p = normalizeArtistName(piece);
      if (p) result.push(p);
    });
  });

  return [...new Set(result.filter(Boolean))];
}

function comparablePath(p) {
  const trimmed = p.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * Library folders are allowed to nest, so removing one root must not orphan a
 * file a broader root still covers. Matching is string-based rather than SQL
 * LIKE: folder names routinely contain `_` and `%`, which LIKE reads as
 * wildcards and would spare rows that should go.
 */
function isUnderAnyRoot(uri, roots) {
  const target = comparablePath(uri);
  return roots.some(root => {
    const base = comparablePath(root);
    return target === base || target.startsWith(base + path.sep);
  });
}

module.exports = { applyLibrarySettings, splitArtists, isUnderAnyRoot };
