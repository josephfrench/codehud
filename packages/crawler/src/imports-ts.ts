/**
 * Import graph via the TypeScript compiler API: parse-only (`createSourceFile`), never a Program,
 * never type-checking, never loading anything from the repository. Specifiers resolve through the
 * package alias table first, then `ts.resolveModuleName` with the package's tsconfig for `paths`
 * and `baseUrl` imports the simple resolver does not understand. Falls back to the regex scanner
 * per file when parsing throws.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { packageNameOf } from './framework.ts';
import { posix } from './fs.ts';
import { resolveSpecifier, scanImports } from './imports.ts';
import type { ExportInfo, ImportRecord, PackageInfo, SourceFile } from './types.ts';

const configCache = new Map<string, ts.CompilerOptions | null>();

/** Compiler options of the nearest tsconfig for a package (JSON only; `extends` chains are JSON too). */
function compilerOptionsFor(root: string, pkg: PackageInfo): ts.CompilerOptions | null {
  const key = `${root}|${pkg.dir}`;
  const cached = configCache.get(key);
  if (cached !== undefined) return cached;
  let opts: ts.CompilerOptions | null = null;
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = join(root, pkg.dir, name);
    if (!existsSync(file)) continue;
    try {
      const read = ts.readConfigFile(file, ts.sys.readFile);
      if (read.error || !read.config) continue;
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(file), undefined, file);
      opts = { ...parsed.options, noEmit: true, allowJs: true, resolveJsonModule: true };
      if (opts.moduleResolution === undefined || opts.moduleResolution === ts.ModuleResolutionKind.Classic) opts.moduleResolution = ts.ModuleResolutionKind.Bundler;
      if (opts.module === undefined) opts.module = ts.ModuleKind.ESNext;
      break;
    } catch {
      /* unreadable tsconfig: no TS resolution for this package */
    }
  }
  configCache.set(key, opts);
  return opts;
}

/** Script portion of a file: `<script>` blocks for Svelte/Vue, frontmatter for Astro, the file otherwise. */
export function scriptOf(file: SourceFile): { text: string; kind: ts.ScriptKind } | undefined {
  switch (file.ext) {
    case 'ts': case 'mts': case 'cts': return { text: file.text, kind: ts.ScriptKind.TS };
    case 'tsx': return { text: file.text, kind: ts.ScriptKind.TSX };
    case 'js': case 'mjs': case 'cjs': return { text: file.text, kind: ts.ScriptKind.JS };
    case 'jsx': return { text: file.text, kind: ts.ScriptKind.JSX };
    case 'svelte': case 'vue': {
      const blocks: string[] = [];
      for (const m of file.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) blocks.push(m[1]!);
      return { text: blocks.join('\n;\n'), kind: ts.ScriptKind.TS };
    }
    case 'astro': {
      const m = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(file.text);
      return { text: m?.[1] ?? '', kind: ts.ScriptKind.TS };
    }
    default: return undefined;
  }
}

function literal(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function signatureText(sf: ts.SourceFile, node: ts.FunctionLikeDeclaration, name: string): string {
  const start = node.name ? node.name.getStart(sf) : node.getStart(sf);
  const end = node.body ? node.body.getStart(sf) : node.getEnd();
  let sig = sf.text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (!sig.startsWith(name)) sig = `${name}${sig.startsWith('(') ? '' : ' '}${sig}`;
  if (ts.isArrowFunction(node)) sig = sig.replace(/\s*=>\s*$/, '');
  sig = sig.replace(/\s*\{?\s*$/, '');
  return sig.length > 200 ? sig.slice(0, 197) + '…' : sig;
}

function isExported(node: ts.Node): boolean {
  return !!(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

export interface TsScan {
  imports: ImportRecord[];
  exports: ExportInfo[];
}

export function tsScan(file: SourceFile, files: Set<string>, root: string): TsScan | undefined {
  const script = scriptOf(file);
  if (!script) return undefined;
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(file.abs, script.text, ts.ScriptTarget.Latest, false, script.kind);
  } catch {
    return undefined;
  }
  const out: ImportRecord[] = [];
  const bySpec = new Map<string, ImportRecord>();
  const push = (spec: string, names: string[], typeOnly: boolean) => {
    const existing = bySpec.get(spec);
    if (existing) {
      for (const n of names) if (!existing.names.includes(n)) existing.names.push(n);
      if (!typeOnly) delete existing.typeOnly;
      return;
    }
    const rec: ImportRecord = { spec, names };
    if (typeOnly) rec.typeOnly = true;
    const resolved = resolveSpecifier(spec, file, files) ?? tsResolve(spec, file, root, files);
    if (resolved) rec.file = resolved;
    else {
      const pkg = packageNameOf(spec);
      if (pkg) rec.pkg = pkg;
    }
    bySpec.set(spec, rec);
    out.push(rec);
  };
  const exports: ExportInfo[] = [];

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const spec = literal(st.moduleSpecifier);
      if (!spec) continue;
      const clause = st.importClause;
      const names: string[] = [];
      let typeOnly = !!clause?.isTypeOnly;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if (el.isTypeOnly) continue;
          names.push((el.propertyName ?? el.name).text);
        }
        if (!typeOnly && clause.namedBindings.elements.length && clause.namedBindings.elements.every((e) => e.isTypeOnly) && !clause.name) typeOnly = true;
      }
      push(spec, names, typeOnly);
    } else if (ts.isExportDeclaration(st)) {
      const spec = literal(st.moduleSpecifier);
      if (spec) {
        const names: string[] = [];
        if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const el of st.exportClause.elements) if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
        push(spec, names, !!st.isTypeOnly);
      }
      if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const el of st.exportClause.elements) exports.push({ name: el.name.text, kind: el.isTypeOnly || st.isTypeOnly ? 'type' : 'other' });
    } else if (ts.isImportEqualsDeclaration(st)) {
      if (ts.isExternalModuleReference(st.moduleReference)) {
        const spec = literal(st.moduleReference.expression);
        if (spec) push(spec, [], false);
      }
    } else if (ts.isExportAssignment(st)) {
      exports.push({ name: 'default', kind: 'default' });
    } else if (ts.isFunctionDeclaration(st) && isExported(st)) {
      const name = st.name?.text ?? 'default';
      exports.push({ name, kind: 'function', signature: signatureText(sf, st, name) });
    } else if (ts.isClassDeclaration(st) && isExported(st)) {
      const name = st.name?.text ?? 'default';
      const ext = st.heritageClauses?.map((h) => h.getText(sf)).join(' ');
      exports.push({ name, kind: 'class', signature: `class ${name}${ext ? ' ' + ext : ''}` });
    } else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) exports.push({ name: d.name.text, kind: 'function', signature: signatureText(sf, init, d.name.text) });
        else exports.push({ name: d.name.text, kind: 'const' });
      }
    } else if ((ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isEnumDeclaration(st)) && isExported(st)) {
      exports.push({ name: st.name.text, kind: 'type' });
    }
  }

  // dynamic import() and require() anywhere in the tree
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg = node.arguments[0];
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = literal(arg);
        if (spec) push(spec, [], false);
      } else if (ts.isIdentifier(callee) && callee.text === 'require') {
        const spec = literal(arg);
        if (spec) push(spec, [], false);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return { imports: out, exports };
}

/** `ts.resolveModuleName` for non-relative specifiers the alias table missed; only results inside the repo count. */
function tsResolve(spec: string, file: SourceFile, root: string, files: Set<string>): string | undefined {
  if (spec.startsWith('.') || spec.startsWith('/') || /^[a-z][a-z0-9+-]*:/i.test(spec)) return undefined;
  const opts = compilerOptionsFor(root, file.pkg);
  if (!opts) return undefined;
  const hasPaths = !!opts.paths && Object.keys(opts.paths).some((k) => spec === k.replace(/\*$/, '') || (k.endsWith('*') && spec.startsWith(k.slice(0, -1))));
  if (!hasPaths && !opts.baseUrl) return undefined;
  try {
    const r = ts.resolveModuleName(spec, file.abs, opts, ts.sys);
    const name = r.resolvedModule?.resolvedFileName;
    if (!name || r.resolvedModule?.isExternalLibraryImport) return undefined;
    const abs = posix(name);
    const prefix = root.endsWith('/') ? root : root + '/';
    if (!abs.startsWith(prefix) || abs.includes('/node_modules/')) return undefined;
    const rel = abs.slice(prefix.length);
    return files.has(rel) ? rel : undefined;
  } catch {
    return undefined;
  }
}

/** TS scan with regex fallback; `exports` is empty when the fallback ran. */
export function scanImportsBest(file: SourceFile, files: Set<string>, root: string, useTs: boolean): TsScan & { ts: boolean } {
  if (useTs) {
    const r = tsScan(file, files, root);
    if (r) return { ...r, ts: true };
  }
  return { imports: scanImports(file, files), exports: [], ts: false };
}
