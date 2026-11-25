/**
 * The crawler reads repositories; it must never run them. This guard makes the rule mechanical:
 * while a crawl is active, any CommonJS `require()` whose resolved file lives under the crawled
 * root throws. (ESM `import()` of repo files cannot be intercepted without loader hooks; the
 * crawler contains no such call, and the test suite checks the source for it.) codehud's own
 * packages directory is exempt so codehud can crawl itself.
 */
import Module, { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { posix } from './fs.ts';

const activeRoots = new Set<string>();
let installed = false;

/** codehud's own code: may be loaded even when it sits under the crawl root (self-crawl). Fixtures are not on this list. */
const PACKAGES_DIR = posix(resolve(dirname(fileURLToPath(import.meta.url)), '../..')) + '/';
export const SELF_DIRS = [
  PACKAGES_DIR + 'crawler/src/',
  PACKAGES_DIR + 'crawler/test/',
  PACKAGES_DIR + 'crawler/node_modules/',
  PACKAGES_DIR + 'schema/src/',
  posix(resolve(PACKAGES_DIR, '..')) + '/node_modules/',
];

export function isUnder(file: string, root: string): boolean {
  const f = posix(file).toLowerCase();
  const r = (root.endsWith('/') ? root : root + '/').toLowerCase();
  return f.startsWith(r);
}

export class RepoExecutionError extends Error {
  file: string;
  constructor(file: string) {
    super(`codehud crawler refused to load ${file}: the crawler never executes code from the crawled repository`);
    this.name = 'RepoExecutionError';
    this.file = file;
  }
}

/** True when loading `file` would execute code from a repository being crawled. */
export function wouldExecuteRepoCode(file: string): boolean {
  const f = posix(file);
  for (const root of activeRoots) {
    if (!isUnder(f, root)) continue;
    if (SELF_DIRS.some((d) => isUnder(f, d))) return false;
    return true;
  }
  return false;
}

type Loader = (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;

export function installExecGuard(): void {
  if (installed) return;
  installed = true;
  const M = Module as unknown as { _load: Loader; _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string };
  const original = M._load;
  M._load = function guardedLoad(this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (activeRoots.size) {
      let filename: string | undefined;
      try { filename = M._resolveFilename(request, parent, isMain); } catch { filename = undefined; }
      if (filename && /[\\/]/.test(filename) && wouldExecuteRepoCode(filename)) throw new RepoExecutionError(filename);
    }
    return original.call(this, request, parent, isMain);
  } as Loader;
}

/** Mark a root as being crawled for the duration of `fn`. */
export async function withGuard<T>(root: string, fn: () => Promise<T>): Promise<T> {
  installExecGuard();
  const r = posix(resolve(root)).replace(/\/$/, '') + '/';
  activeRoots.add(r);
  try {
    return await fn();
  } finally {
    activeRoots.delete(r);
  }
}

export function guardedRoots(): string[] {
  return [...activeRoots];
}

/** For tests: a require() bound to this module, so the guard can be exercised directly. */
export const selfRequire = createRequire(import.meta.url);
