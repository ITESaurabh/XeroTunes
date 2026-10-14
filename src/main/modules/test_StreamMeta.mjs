// Run with: node src/main/modules/test_StreamMeta.mjs
// Serves a fake Icecast stream so the metadata-block offsets are checked
// without touching the network. Plain .mjs so node can load the TypeScript
// module directly (type stripping) without a build step.
import assert from 'assert';
import http from 'http';
import { parseStreamTitle, startStreamMeta, stopStreamMeta } from './StreamMeta.ts';

assert.deepStrictEqual(parseStreamTitle('On Wings of Hope - Happiness in a Closet'), {
  raw: 'On Wings of Hope - Happiness in a Closet',
  artist: 'On Wings of Hope',
  title: 'Happiness in a Closet',
});
assert.deepStrictEqual(parseStreamTitle('Station ID'), {
  raw: 'Station ID',
  title: 'Station ID',
  artist: null,
});

const META_INT = 64;

function metaBlock(title) {
  const payload = Buffer.from(`StreamTitle='${title}';`, 'utf8');
  const blocks = Math.ceil(payload.length / 16);
  const body = Buffer.alloc(blocks * 16);
  payload.copy(body);
  return Buffer.concat([Buffer.from([blocks]), body]);
}

// Splits the response mid-metadata so the multi-chunk path is exercised too.
const server = http.createServer((req, res) => {
  assert.strictEqual(req.headers['icy-metadata'], '1');
  res.writeHead(200, { 'content-type': 'audio/mpeg', 'icy-metaint': String(META_INT) });
  const block = metaBlock('Notions - Disown');
  res.write(Buffer.concat([Buffer.alloc(META_INT, 0x55), block.subarray(0, 5)]));
  setTimeout(() => res.write(block.subarray(5)), 10);
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const timeout = setTimeout(() => {
    console.error('FAIL: no metadata within 5s');
    process.exit(1);
  }, 5000);

  startStreamMeta(`http://127.0.0.1:${port}/stream`, meta => {
    clearTimeout(timeout);
    assert.deepStrictEqual(meta, { raw: 'Notions - Disown', artist: 'Notions', title: 'Disown' });
    stopStreamMeta();
    server.close();
    console.log('StreamMeta ok');
  });
});
