/** Third parties: catalogued npm / PyPI packages, and env-var-configured systems (`CRM_URL` + `CRM_API_KEY`). */
import { EXTERNALS, externalFor } from '../framework.ts';
import { stripComments } from '../fs.ts';
import type { Adapter, Draft } from '../types.ts';

export const npmExternals: Adapter = {
  id: 'externals',
  detect: () => true,
  scan(ctx, out) {
    const externalPkgs = new Map<string, Set<string>>();
    const depNames = new Set<string>(ctx.importedPkgs);
    for (const d of ctx.deps) depNames.add(d);
    for (const dep of [...depNames].sort()) {
      const def = externalFor(dep);
      if (def) (externalPkgs.get(def.id) ?? externalPkgs.set(def.id, new Set()).get(def.id)!).add(dep);
    }
    for (const def of EXTERNALS) {
      const pkgs = externalPkgs.get(def.id);
      if (!pkgs) continue;
      out.drafts.push({
        id: `external:${def.id}`,
        label: def.label,
        kind: 'external',
        layer: 'external',
        summary: `npm: ${[...pkgs].join(', ')}`,
        tags: def.tags,
        meta: { packages: [...pkgs] },
        ownedFiles: [],
      });
    }
  },
  edges(file, from, ectx, sink) {
    for (const imp of ectx.importsOf.get(file.rel) ?? []) {
      if (!imp.pkg) continue;
      const def = externalFor(imp.pkg);
      if (def && ectx.externals.has(`external:${def.id}`)) sink.add(from, `external:${def.id}`, 'calls', 'high', 'dep', imp.pkg);
    }
  },
};

export const ENV_VAR_RE = /\b(?:env|process\.env|import\.meta\.env|os\.environ(?:\.get)?\(?|getenv\()?\.?\[?['"]?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;
const PUBLIC_PREFIX = /^(NEXT_PUBLIC|PUBLIC|VITE|ASTRO|EXPO_PUBLIC|REACT_APP|NUXT_PUBLIC|NG_APP)_/;
const SUFFIX = /_(BASE_URL|API_URL|URL|ENDPOINT|HOST|API_KEY|PUBLISHABLE_KEY|SECRET_KEY|WEBHOOK_SECRET|CLIENT_SECRET|CLIENT_ID|ACCOUNT_ID|SECRET|KEY|TOKEN|MODE|REGION|BUCKET|PROJECT_ID|DSN)$/;
const URLISH = /_(BASE_URL|API_URL|URL|ENDPOINT|HOST|DSN)$/;
const ENV_ACCESS_RE = /\b(?:env|process\.env|import\.meta\.env)\.([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b|\bos\.environ(?:\.get\(|\[)\s*['"]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"]|\bos\.getenv\(\s*['"]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"]/g;

/** `PUBLIC_STRIPE_PUBLISHABLE_KEY` -> `STRIPE`; `CHECKOUT_TOKEN_SECRET` -> `CHECKOUT_TOKEN`; `DB` -> undefined. */
export function envPrefix(name: string): string | undefined {
  const bare = name.replace(PUBLIC_PREFIX, '');
  if (!SUFFIX.test(bare)) return undefined;
  const prefix = bare.replace(SUFFIX, '');
  return prefix || undefined;
}

export function envVarsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(text).matchAll(ENV_ACCESS_RE)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

function catalogIdFor(prefix: string): string | undefined {
  const slug = prefix.toLowerCase().replace(/_/g, '-');
  const compact = slug.replace(/-/g, '');
  for (const def of EXTERNALS) {
    const idCompact = def.id.replace(/-/g, '');
    if (def.id === slug || idCompact === compact || def.label.toLowerCase().replace(/[^a-z0-9]/g, '') === compact) return def.id;
  }
  return undefined;
}

function labelFor(prefix: string): string {
  if (prefix.length <= 5) return prefix;
  return prefix.toLowerCase().split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

export const envExternals: Adapter = {
  id: 'env-externals',
  detect: () => true,
  scan(ctx, out) {
    const existing = new Set(out.drafts.filter((d) => d.kind === 'external').map((d) => d.id));
    const vars = new Map<string, Set<string>>(); // prefix -> var names
    for (const s of ctx.sources) {
      for (const name of envVarsIn(s.text)) {
        if (out.envRefs.has(name)) continue; // infrastructure already says what this variable points at
        const prefix = envPrefix(name);
        if (!prefix) continue;
        (vars.get(prefix) ?? vars.set(prefix, new Set()).get(prefix)!).add(name);
      }
    }
    const byPrefix = new Map<string, string>();
    for (const [prefix, names] of [...vars.entries()].sort()) {
      const catalog = catalogIdFor(prefix);
      if (catalog && existing.has(`external:${catalog}`)) {
        byPrefix.set(prefix, `external:${catalog}`);
        continue;
      }
      if (![...names].some((n) => URLISH.test(n.replace(PUBLIC_PREFIX, '')))) continue;
      const id = `external:env:${prefix.toLowerCase().replace(/_/g, '-')}`;
      const d: Draft = {
        id,
        label: labelFor(prefix),
        kind: 'external',
        layer: 'external',
        summary: `env: ${[...names].sort().join(', ')}`,
        tags: ['env'],
        meta: { env: [...names].sort() },
        ownedFiles: [],
      };
      out.drafts.push(d);
      byPrefix.set(prefix, id);
    }
    ctx.scratch.set('env-externals.byPrefix', byPrefix);
  },
  edges(file, from, ectx, sink) {
    const byPrefix = ectx.envExternals;
    if (!byPrefix.size || /(^|\/)env\.[cm]?[jt]s$/.test(file.rel)) return;
    for (const name of envVarsIn(file.text)) {
      if (/_(MODE|REGION|ENABLED|FLAG)$/.test(name)) continue; // toggles are configuration, not calls
      if (ectx.scan.envRefs.has(name)) continue;
      const prefix = envPrefix(name);
      const to = prefix && byPrefix.get(prefix);
      if (to) sink.add(from, to, 'calls', 'medium', 'env', name);
    }
  },
};
