/* eslint-disable @typescript-eslint/no-var-requires */
// Reads and writes playlists in the four formats real players actually produce:
// M3U/M3U8 (Winamp/VLC/foobar2000), PLS (Winamp/Shoutcast), and XSPF (VLC, XML).
// No XeroTunes-specific fields go in these files, only what each spec defines,
// so a playlist exported here opens correctly in any other player, and one
// exported by another player imports correctly here. Plain JS with no deps so
// the main process and test_playlistFormats.js can both load it.
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

const FORMATS = ['m3u', 'm3u8', 'pls', 'xspf'];

function detectPlaylistFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return FORMATS.includes(ext) ? ext : null;
}

// A location is a URI (file://, http(s)://, ...) or a path relative/absolute
// to the playlist file. Only file:// and bare paths resolve to something a
// local library can match; remote stream URLs pass through untouched.
function resolveLocation(raw, baseDir) {
  const loc = raw.trim();
  if (!loc) return loc;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(loc);
  if (scheme) {
    if (scheme[1].toLowerCase() !== 'file') return loc;
    try {
      return fileURLToPath(loc);
    } catch {
      return loc;
    }
  }
  return path.resolve(baseDir, loc);
}

// ── M3U / M3U8 ────────────────────────────────────────────────────────────
function parseM3U(content, baseDir) {
  const entries = [];
  let pendingTitle;
  let pendingDuration;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const rest = line.slice('#EXTINF:'.length);
      const comma = rest.indexOf(',');
      const durStr = comma === -1 ? rest : rest.slice(0, comma);
      const dur = parseFloat(durStr);
      pendingDuration = Number.isFinite(dur) && dur > 0 ? dur : undefined;
      pendingTitle = comma === -1 ? undefined : rest.slice(comma + 1).trim() || undefined;
      continue;
    }
    if (line.startsWith('#')) continue;
    entries.push({ location: resolveLocation(line, baseDir), title: pendingTitle, duration: pendingDuration });
    pendingTitle = undefined;
    pendingDuration = undefined;
  }
  return entries;
}

function relativizeOrAbsolute(target, outDir) {
  const rel = path.relative(outDir, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : target;
}

function writeM3U(entries, outDir) {
  const lines = ['#EXTM3U'];
  for (const e of entries) {
    const seconds = e.duration ? Math.round(e.duration) : -1;
    const label = e.artist ? `${e.artist} - ${e.title || 'Unknown'}` : e.title || 'Unknown';
    lines.push(`#EXTINF:${seconds},${label}`);
    lines.push(relativizeOrAbsolute(e.location, outDir));
  }
  return lines.join('\r\n') + '\r\n';
}

// ── PLS ───────────────────────────────────────────────────────────────────
function parsePLS(content, baseDir) {
  const files = new Map();
  const titles = new Map();
  const lengths = new Map();
  const lineRe = /^(File|Title|Length)(\d+)=(.*)$/i;
  for (const raw of content.split(/\r?\n/)) {
    const m = lineRe.exec(raw.trim());
    if (!m) continue;
    const idx = parseInt(m[2], 10);
    const kind = m[1].toLowerCase();
    if (kind === 'file') files.set(idx, m[3]);
    else if (kind === 'title') titles.set(idx, m[3]);
    else if (kind === 'length') {
      const len = parseInt(m[3], 10);
      if (Number.isFinite(len) && len > 0) lengths.set(idx, len);
    }
  }
  return [...files.keys()]
    .sort((a, b) => a - b)
    .map(i => ({
      location: resolveLocation(files.get(i), baseDir),
      title: titles.get(i),
      duration: lengths.get(i),
    }));
}

// PLS is Winamp/Shoutcast-native and every real-world writer (foobar2000
// included) stores absolute paths, so this skips the relative-path attempt.
function writePLS(entries) {
  const lines = ['[playlist]'];
  entries.forEach((e, i) => {
    const n = i + 1;
    const label = e.artist ? `${e.artist} - ${e.title || 'Unknown'}` : e.title || 'Unknown';
    lines.push(`File${n}=${e.location}`);
    lines.push(`Title${n}=${label}`);
    lines.push(`Length${n}=${e.duration ? Math.round(e.duration) : -1}`);
  });
  lines.push(`NumberOfEntries=${entries.length}`, 'Version=2');
  return lines.join('\r\n') + '\r\n';
}

// ── XSPF ──────────────────────────────────────────────────────────────────
// Hand-rolled instead of pulling in an XML dependency: XSPF's <track> list is
// flat (no nesting, no attributes we care about), so a couple of regexes cover
// the real spec surface without a general-purpose parser.
function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlTagText(block, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!m) return undefined;
  const raw = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw);
  return unescapeXml(cdata ? cdata[1] : raw);
}

function parseXSPF(content, baseDir) {
  const entries = [];
  const trackRe = /<track[^>]*>([\s\S]*?)<\/track>/gi;
  let m;
  while ((m = trackRe.exec(content))) {
    const block = m[1];
    const location = xmlTagText(block, 'location');
    if (!location) continue;
    const durMs = xmlTagText(block, 'duration');
    const duration = durMs ? parseInt(durMs, 10) / 1000 : undefined;
    entries.push({
      location: resolveLocation(location, baseDir),
      title: xmlTagText(block, 'title'),
      artist: xmlTagText(block, 'creator'),
      duration: Number.isFinite(duration) ? duration : undefined,
    });
  }
  return entries;
}

function writeXSPF(entries, playlistTitle) {
  const tracks = entries
    .map(e => {
      const parts = [`      <location>${xmlEscape(pathToFileURL(e.location).href)}</location>`];
      if (e.title) parts.push(`      <title>${xmlEscape(e.title)}</title>`);
      if (e.artist) parts.push(`      <creator>${xmlEscape(e.artist)}</creator>`);
      if (e.duration) parts.push(`      <duration>${Math.round(e.duration * 1000)}</duration>`);
      return `    <track>\n${parts.join('\n')}\n    </track>`;
    })
    .join('\n');
  const header = playlistTitle ? `  <title>${xmlEscape(playlistTitle)}</title>\n` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<playlist version="1" xmlns="http://xspf.org/ns/0/">\n' +
    header +
    '  <trackList>\n' +
    tracks +
    '\n  </trackList>\n' +
    '</playlist>\n'
  );
}

// ── Dispatch ──────────────────────────────────────────────────────────────
function parsePlaylistFile(filePath) {
  const format = detectPlaylistFormat(filePath);
  if (!format) throw new Error(`Unsupported playlist format: ${path.extname(filePath)}`);
  const content = fs.readFileSync(filePath, 'utf-8');
  const baseDir = path.dirname(filePath);
  if (format === 'm3u' || format === 'm3u8') return parseM3U(content, baseDir);
  if (format === 'pls') return parsePLS(content, baseDir);
  return parseXSPF(content, baseDir);
}

function writePlaylistFile(filePath, entries, playlistTitle) {
  const format = detectPlaylistFormat(filePath);
  if (!format) throw new Error(`Unsupported playlist format: ${path.extname(filePath)}`);
  const body =
    format === 'm3u' || format === 'm3u8'
      ? writeM3U(entries, path.dirname(filePath))
      : format === 'pls'
        ? writePLS(entries)
        : writeXSPF(entries, playlistTitle);
  fs.writeFileSync(filePath, body, 'utf-8');
}

module.exports = {
  FORMATS,
  detectPlaylistFormat,
  parsePlaylistFile,
  writePlaylistFile,
  // exported for the test file
  parseM3U,
  writeM3U,
  parsePLS,
  writePLS,
  parseXSPF,
  writeXSPF,
  resolveLocation,
};
