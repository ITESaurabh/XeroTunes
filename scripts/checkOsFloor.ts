/**
 * Fails packaging when a binary needs a newer OS than src/config/osFloor.ts
 * declares, so a new Electron or build image can't raise the floor unnoticed.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface Floor {
  glibc: string;
  macos: string;
  windows: string;
}

interface Need {
  version: string;
  file: string;
}

const compare = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

const highest = (versions: string[]): string | null =>
  versions.length ? versions.reduce((a, b) => (compare(a, b) >= 0 ? a : b)) : null;

// Symlinks are skipped: a .app's Versions/Current would otherwise visit each framework twice.
function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

function head(file: string, bytes: number): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    fs.readSync(fd, buf, 0, bytes, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

const warn = (msg: string): void =>
  console.warn(`${process.env.GITHUB_ACTIONS ? '::warning::' : ''}${msg}`);

/** null when the tool isn't installed locally; CI must have it, so there it throws. */
function run(tool: string, args: string[]): string | null {
  try {
    return execFileSync(tool, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT' && !process.env.CI) return null;
    if (e.stderr?.includes('not a dynamic object')) return '';
    throw err;
  }
}

function linuxNeeds(files: string[]): Need[] | null {
  const needs: Need[] = [];
  const cxx: string[] = [];
  for (const file of files) {
    if (head(file, 4).toString('latin1') !== '\x7fELF') continue;
    const out = run('objdump', ['-T', file]);
    if (out === null) return null;
    const v = highest([...out.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)/g)].map(m => m[1]));
    if (v) needs.push({ version: v, file });
    if (/\bGLIBCXX_\d/.test(out)) cxx.push(path.basename(file));
  }
  // The build links libstdc++ statically so it can't become a second, higher floor.
  if (cxx.length) warn(`libstdc++ is linked dynamically by ${cxx.join(', ')}; that's a floor osFloor.ts doesn't declare.`);
  return needs;
}

function macNeeds(files: string[], outputPaths: string[], floor: string): Need[] | null {
  for (const out of outputPaths) {
    for (const app of fs.readdirSync(out).filter(n => n.endsWith('.app'))) {
      const plist = fs.readFileSync(path.join(out, app, 'Contents', 'Info.plist'), 'utf8');
      const declared = /<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
      if (declared !== floor)
        throw new Error(`${app} declares LSMinimumSystemVersion ${declared ?? '(none)'}, expected ${floor}.`);
    }
  }
  const needs: Need[] = [];
  for (const file of files) {
    const magic = head(file, 4).readUInt32BE(0);
    // 64-bit Mach-O (little-endian on disk) or a universal binary.
    if (magic !== 0xcffaedfe && magic !== 0xcafebabe) continue;
    const out = run('otool', ['-l', file]);
    if (out === null) return null;
    const v = highest([
      ...[...out.matchAll(/\bminos (\d+(?:\.\d+)*)/g)].map(m => m[1]),
      ...[...out.matchAll(/LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version (\d+(?:\.\d+)*)/g)].map(m => m[1]),
    ]);
    if (v) needs.push({ version: v, file });
  }
  return needs;
}

function windowsNeeds(files: string[]): Need[] {
  const needs: Need[] = [];
  for (const file of files.filter(f => /\.(exe|dll|node)$/i.test(f))) {
    const buf = head(file, 4096);
    if (buf.toString('latin1', 0, 2) !== 'MZ') continue;
    const pe = buf.readUInt32LE(0x3c);
    if (pe + 76 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') continue;
    // Windows won't load an image whose subsystem version is newer than itself.
    const opt = pe + 24;
    needs.push({ version: `${buf.readUInt16LE(opt + 48)}.${buf.readUInt16LE(opt + 50)}`, file });
  }
  return needs;
}

export function checkOsFloor(platform: string, outputPaths: string[], floor: Floor): void {
  const files = outputPaths.flatMap(p => [...walk(p)]);
  const [label, declared, needs] =
    platform === 'linux'
      ? ['glibc', floor.glibc, linuxNeeds(files)]
      : platform === 'darwin' || platform === 'mas'
        ? ['macOS', floor.macos, macNeeds(files, outputPaths, floor.macos)]
        : ['Windows', floor.windows, windowsNeeds(files)];

  if (needs === null) {
    warn(`OS floor not checked: ${platform === 'linux' ? 'objdump' : 'otool'} isn't installed.`);
    return;
  }
  const top = needs.reduce<Need | null>((a, b) => (!a || compare(b.version, a.version) > 0 ? b : a), null);
  console.log(
    `OS floor: ${label} ${top?.version ?? '(none found)'} needed, ${declared} declared` +
      (top ? ` (highest: ${path.relative(process.cwd(), top.file)})` : '')
  );
  const over = needs.filter(n => compare(n.version, declared) > 0);
  if (over.length)
    throw new Error(
      `${label} floor is ${declared} in src/config/osFloor.ts, but the build needs more:\n` +
        over.map(n => `  ${n.version}  ${path.relative(process.cwd(), n.file)}`).join('\n') +
        `\nRaise OS_FLOOR on purpose (and the README / docs/linux-support.md), or build against an older base.`
    );
}
