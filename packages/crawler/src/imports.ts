import { dirOf } from './fs.ts';
import { packageNameOf } from './framework.ts';
import type { ImportRecord, SourceFile } from './types.ts';

const RESOLVE_EXTS = ['ts', 'tsx', 'mts', 'js', 'jsx', 'mjs', 'cjs', 'svelte', 'astro', 'vue', 'json'];

const STATIC_IMPORT = /(?:^|[^\w$.])(?:import|export)\s+(?:type\s+)?(?:([\w$*{}\s,]+?)\s+from\s+)?['"]([^'"\n]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const REQUIRE = /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g;

function normalise(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function namedImports(clause: string | undefined): string[] {
  if (!clause) return [];
  const m = /{([^}]*)}/.exec(clause);
  if (!m) return [];
  return m[1]!
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('type '))
    .map((s) => s.split(/\s+as\s+/)[0]!.trim())
    .filter(Boolean);
}

/** Resolve a relative or alias specifier to a repo file (root-relative). */
export function resolveSpecifier(spec: string, from: SourceFile, files: Set<string>): string | undefined {
  let target: string | undefined;
  if (spec.startsWith('.')) {
    target = normalise([...dirOf(from.rel).split('/'), ...spec.split('/')]);
  } else {
    for (const [prefix, to] of Object.entries(from.pkg.aliases)) {
      if (spec.startsWith(prefix)) {
        target = normalise([...to.split('/'), ...spec.slice(prefix.length).split('/')]);
        break;
      }
    }
  }
  if (target === undefined) return undefined;
  if (files.has(target)) return target;
  // TS allows importing `./x.js` for `./x.ts`
  const jsSwap = target.replace(/\.(js|mjs|cjs|jsx)$/, (_, e: string) => (e === 'jsx' ? '.tsx' : e === 'mjs' ? '.mts' : e === 'cjs' ? '.cts' : '.ts'));
  if (jsSwap !== target && files.has(jsSwap)) return jsSwap;
  for (const ext of RESOLVE_EXTS) if (files.has(`${target}.${ext}`)) return `${target}.${ext}`;
  for (const ext of RESOLVE_EXTS) if (files.has(`${target}/index.${ext}`)) return `${target}/index.${ext}`;
  return undefined;
}

export function scanImports(file: SourceFile, files: Set<string>): ImportRecord[] {
  const out: ImportRecord[] = [];
  const seen = new Set<string>();
  const push = (spec: string, names: string[]) => {
    const key = spec;
    const existing = seen.has(key) ? out.find((r) => r.spec === spec) : undefined;
    if (existing) {
      for (const n of names) if (!existing.names.includes(n)) existing.names.push(n);
      return;
    }
    seen.add(key);
    const rec: ImportRecord = { spec, names };
    const resolved = resolveSpecifier(spec, file, files);
    if (resolved) rec.file = resolved;
    else {
      const pkg = packageNameOf(spec);
      if (pkg) rec.pkg = pkg;
    }
    out.push(rec);
  };
  const text = file.text;
  for (const m of text.matchAll(STATIC_IMPORT)) push(m[2]!, namedImports(m[1]));
  for (const m of text.matchAll(DYNAMIC_IMPORT)) push(m[1]!, []);
  for (const m of text.matchAll(REQUIRE)) push(m[1]!, []);
  return out;
}
