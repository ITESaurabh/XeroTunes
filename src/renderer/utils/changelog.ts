// Parses only the Markdown subset RELEASING.md allows for CHANGELOG.md; keep the two in sync.

export type Block =
  { kind: 'version' | 'section' | 'text'; text: string } | { kind: 'list'; items: string[] };

export type Span =
  { kind: 'text' | 'code' | 'bold'; text: string } | { kind: 'link'; text: string; href: string };

export function parseChangelog(md: string): Block[] {
  const blocks: Block[] = [];
  let wrap: ((line: string) => void) | null = null;
  // The intro is for people reading the file, not the app.
  const start = md.search(/^## /m);
  for (const line of start < 0 ? [] : md.slice(start).split(/\r?\n/)) {
    const heading = /^(##|###) (.+)/.exec(line);
    const last = blocks[blocks.length - 1];
    if (heading) {
      const text = heading[2].trim().replace(/^\[([^\]]+)\]/, '$1');
      blocks.push({ kind: heading[1] === '##' ? 'version' : 'section', text });
      wrap = null;
    } else if (line.startsWith('- ')) {
      const list = last?.kind === 'list' ? last : { kind: 'list' as const, items: [] };
      if (list !== last) blocks.push(list);
      const i = list.items.push(line.slice(2).trim()) - 1;
      wrap = more => (list.items[i] += ' ' + more);
    } else if (!line.trim()) {
      wrap = null;
    } else if (wrap) {
      wrap(line.trim());
    } else {
      const para = { kind: 'text' as const, text: line.trim() };
      blocks.push(para);
      wrap = more => (para.text += ' ' + more);
    }
  }
  return blocks;
}

const isBeta = (version: string) => /^\d+\.\d+\.\d+-/.test(version);
const isStable = (version: string) => /^\d+\.\d+\.\d+(\s|$)/.test(version);

/** `stableOnly` drops betas only once a stable release exists; until then they're all there is. */
export function latestReleases(blocks: Block[], limit: number, stableOnly: boolean): Block[] {
  const releases: Array<{ version: string; blocks: Block[] }> = [];
  for (const block of blocks) {
    if (block.kind === 'version') releases.push({ version: block.text, blocks: [block] });
    else releases[releases.length - 1]?.blocks.push(block);
  }
  const shown =
    stableOnly && releases.some(r => isStable(r.version))
      ? releases.filter(r => !isBeta(r.version))
      : releases;
  return shown.slice(0, limit).flatMap(r => r.blocks);
}

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > at) spans.push({ kind: 'text', text: text.slice(at, index) });
    if (m[1] !== undefined) spans.push({ kind: 'code', text: m[1] });
    else if (m[2] !== undefined) spans.push({ kind: 'bold', text: m[2] });
    else spans.push({ kind: 'link', text: m[3], href: m[4] });
    at = index + m[0].length;
  }
  if (at < text.length) spans.push({ kind: 'text', text: text.slice(at) });
  return spans;
}
