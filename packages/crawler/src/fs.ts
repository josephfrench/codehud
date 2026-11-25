import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoFile } from './types.ts';

export const IGNORED_DIRS = new Set([
  'node_modules', 'dist', '.git', 'build', '.astro', '.svelte-kit', '.next', '.output', '.vercel',
  '.wrangler', '.turbo', '.cache', 'coverage', 'out', '.idea', '.vscode', '.pnpm-store', 'tmp', '.codehud', '.claude',
  // test data: never part of the system being described (crawl such a directory directly if it is the system)
  'fixtures', '__fixtures__', 'testdata', '__snapshots__', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.terraform', 'cdk.out', '.serverless', '.aws-sam', 'target', 'vendor',
]);

export const SOURCE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'astro', 'svelte', 'vue', 'md', 'mdx']);
export const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'astro', 'svelte', 'vue']);

const MAX_FILE_BYTES = 1_000_000;

export function posix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function dirOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

export function baseOf(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

export function stripExt(rel: string): string {
  const b = baseOf(rel);
  const i = b.lastIndexOf('.');
  return i <= 0 ? rel : rel.slice(0, rel.length - (b.length - i));
}

/** Depth-first, sorted walk. Returns every regular file outside ignored dirs. */
export function walk(root: string, extraIgnore: string[] = []): RepoFile[] {
  const ignore = new Set([...IGNORED_DIRS, ...extraIgnore]);
  const out: RepoFile[] = [];
  const visit = (dir: string, relDir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    entries.sort();
    for (const name of entries) {
      const abs = join(dir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (ignore.has(name)) continue;
        visit(abs, rel);
      } else if (st.isFile()) {
        if (st.size > MAX_FILE_BYTES) continue;
        out.push({ rel, abs, ext: extOf(name), base: name });
      }
    }
  };
  visit(root, '');
  return out;
}

export function readText(abs: string): string {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

/** Lenient JSON (JSONC: comments and trailing commas). Returns undefined on failure. */
export function parseJsonc<T = unknown>(text: string): T | undefined {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(stripped) as T;
  } catch {
    return undefined;
  }
}

export function readJsonc<T = unknown>(abs: string): T | undefined {
  const text = readText(abs);
  return text ? parseJsonc<T>(text) : undefined;
}

/**
 * First sentence of the most relevant doc comment, trimmed to ~140 chars. With `anchor`, the JSDoc
 * block immediately preceding the first anchor match wins (e.g. the handler of a route); otherwise
 * the first column-0 JSDoc block (file or top-level declaration docs, never an indented inner one),
 * then leading `//` lines.
 */
export function firstDocSentence(text: string, anchor?: RegExp | 'any'): string | undefined {
  let body: string | undefined;
  if (anchor === 'any') body = /\/\*\*([\s\S]*?)\*\//.exec(text)?.[1];
  else if (anchor) {
    const a = anchor.exec(text);
    if (a) {
      const before = text.slice(0, a.index).trimEnd();
      if (before.endsWith('*/')) {
        const start = before.lastIndexOf('/**');
        if (start >= 0) body = before.slice(start + 3, -2);
      }
    }
  }
  if (!body) body = /(?:^|\n)\/\*\*([\s\S]*?)\*\//.exec(text)?.[1];
  if (!body) {
    const lines = text.split('\n').slice(0, 5).filter((l) => l.trim().startsWith('//'));
    if (lines.length) body = lines.map((l) => l.replace(/^\s*\/\/\s?/, '')).join(' ');
  }
  if (!body) return undefined;
  const clean = body
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .filter((l) => !/^\s*@\w+/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return undefined;
  const sentence = clean.split(/(?<=\.)\s/)[0] ?? clean;
  return sentence.length > 140 ? sentence.slice(0, 137).trimEnd() + '…' : sentence;
}

/** Remove block comments and whole-line / trailing `//` comments (keeps `https://` inside strings). */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

export function lineOfIndex(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Index just past the parenthesis that closes the one opened at `openIndex`. */
export function matchParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}
