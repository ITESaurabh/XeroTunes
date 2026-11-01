/**
 * Ships packages webpack leaves external, with their runtime dependencies. The
 * webpack plugin packages only .webpack/, so require() would find nothing.
 */
import fs from 'fs';
import path from 'path';

function findPackage(name: string, fromDir: string): string | null {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

export function shipNodeModules(names: string[], projectDir: string, buildPath: string): void {
  const shipped = new Map<string, string>();
  const visit = (name: string, fromDir: string, optional: boolean): void => {
    const dir = findPackage(name, fromDir);
    if (!dir) {
      // An optional dependency can be absent, like sharp's binaries for other platforms.
      if (optional) return;
      throw new Error(`${name} is needed at runtime but isn't installed.`);
    }
    const already = shipped.get(name);
    if (already === dir) return;
    if (already) throw new Error(`Two copies of ${name} would ship flat: ${already} and ${dir}.`);
    shipped.set(name, dir);
    fs.cpSync(dir, path.join(buildPath, 'node_modules', name), { recursive: true, dereference: true });
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pj.dependencies ?? {})) visit(dep, dir, false);
    for (const dep of Object.keys(pj.optionalDependencies ?? {})) visit(dep, dir, true);
  };
  for (const name of names) visit(name, projectDir, false);
}
