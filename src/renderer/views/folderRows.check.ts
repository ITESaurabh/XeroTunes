/** Self-check: run with `node src/renderer/views/folderRows.check.ts`. */
import assert from 'node:assert';
import { buildFolderRows, gridColumns, type SubFolder } from './folderRows.ts';

const folder = (Name: string): SubFolder => ({ Path: `/m/${Name}`, Name, SongCount: 1 });
const song = (Id: number) => ({ Id, Title: `t${Id}` });
const kinds = (rows: ReturnType<typeof buildFolderRows>) => rows.map(r => r.kind);

// Columns must track the CSS: auto-fill packs as many tracks as the gaps allow,
// never fewer than one.
assert.equal(gridColumns(0, 150, 12), 1, 'unmeasured width still yields one column');
assert.equal(gridColumns(150, 150, 12), 1);
assert.equal(gridColumns(311, 150, 12), 1, 'one px short of a second track');
assert.equal(gridColumns(312, 150, 12), 2, '150 + 12 + 150 exactly fits two');
assert.equal(gridColumns(1000, 110, 8), 8);

// An empty folder produces no rows, so the view drives its Empty state off
// `rows.length`.
assert.deepEqual(buildFolderRows([], [], { grid: true, cols: 4, isAtRoot: true }), []);

// Grid mode slices folders into rows of `cols`; the remainder keeps its own row.
const grid = buildFolderRows([folder('a'), folder('b'), folder('c')], [], {
  grid: true,
  cols: 2,
  isAtRoot: true,
});
assert.deepEqual(kinds(grid), ['header', 'grid', 'grid']);
assert.equal(grid[0].kind === 'header' && grid[0].label, 'Music Folders');
assert.equal(grid[1].kind === 'grid' && grid[1].folders.length, 2);
assert.equal(grid[2].kind === 'grid' && grid[2].folders.length, 1);

// List mode is one row per folder, and below the root the header carries a count.
const list = buildFolderRows([folder('a'), folder('b')], [], {
  grid: false,
  cols: 3,
  isAtRoot: false,
});
assert.deepEqual(kinds(list), ['header', 'folder', 'folder']);
assert.equal(list[0].kind === 'header' && list[0].label, 'Folders (2)');

// A gap separates the two sections, and song indexes stay aligned with the
// `songs` array; an off-by-one here plays the wrong track.
const both = buildFolderRows([folder('a')], [song(10), song(11)], {
  grid: false,
  cols: 3,
  isAtRoot: false,
});
assert.deepEqual(kinds(both), ['header', 'folder', 'gap', 'header', 'song', 'song']);
assert.deepEqual(
  both.flatMap(r => (r.kind === 'song' ? [[r.index, r.song.Id]] : [])),
  [
    [0, 10],
    [1, 11],
  ]
);

// Songs with no subfolders: no folder header, and no gap to lead with.
assert.deepEqual(kinds(buildFolderRows([], [song(1)], { grid: true, cols: 4, isAtRoot: false })), [
  'header',
  'song',
]);

console.log('folderRows.check.ts OK');
