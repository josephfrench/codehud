/**
 * Third-party systems that are not an npm dependency but are configured through environment
 * variables: `env.CRM_URL` + `env.CRM_API_KEY` means there is a CRM somewhere. A URL-ish variable
 * creates the external node; key/secret/mode variables with the same prefix attach to it. Prefixes
 * that name a catalogued external (STRIPE_*, BETTER_AUTH_*) fold into that node instead.
 */
import { EXTERNALS } from './framework.ts';
import { stripComments } from './fs.ts';
import type { Draft, SourceFile } from './types.ts';

export const ENV_VAR_RE = /\b(?:env|process\.env|import\.meta\.env)\.([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;
const PUBLIC_PREFIX = /^(NEXT_PUBLIC|PUBLIC|VITE|ASTRO|EXPO_PUBLIC|REACT_APP|NUXT_PUBLIC)_/;
const SUFFIX = /_(BASE_URL|API_URL|URL|ENDPOINT|HOST|API_KEY|PUBLISHABLE_KEY|SECRET_KEY|WEBHOOK_SECRET|CLIENT_SECRET|CLIENT_ID|ACCOUNT_ID|SECRET|KEY|TOKEN|MODE|REGION|BUCKET|PROJECT_ID|DSN)$/;
const URLISH = /_(BASE_URL|API_URL|URL|ENDPOINT|HOST|DSN)$/;

/** `PUBLIC_STRIPE_PUBLISHABLE_KEY` -> `STRIPE`; `CHECKOUT_TOKEN_SECRET` -> `CHECKOUT_TOKEN`; `DB` -> undefined. */
export function envPrefix(name: string): string | undefined {
  const bare = name.replace(PUBLIC_PREFIX, '');
  if (!SUFFIX.test(bare)) return undefined;
  const prefix = bare.replace(SUFFIX, '');
  return prefix || undefined;
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
  return prefix
    .toLowerCase()
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export interface EnvExternals {
  drafts: Draft[];
  /** prefix -> external node id (catalogued or env-derived) */
  byPrefix: Map<string, string>;
}

export function scanEnvExternals(sources: SourceFile[], existingExternalIds: Set<string>): EnvExternals {
  const vars = new Map<string, Set<string>>(); // prefix -> var names
  for (const s of sources) {
    for (const m of stripComments(s.text).matchAll(ENV_VAR_RE)) {
      const prefix = envPrefix(m[1]!);
      if (!prefix) continue;
      (vars.get(prefix) ?? vars.set(prefix, new Set()).get(prefix)!).add(m[1]!);
    }
  }
  const drafts: Draft[] = [];
  const byPrefix = new Map<string, string>();
  for (const [prefix, names] of [...vars.entries()].sort()) {
    const catalog = catalogIdFor(prefix);
    if (catalog && existingExternalIds.has(`external:${catalog}`)) {
      byPrefix.set(prefix, `external:${catalog}`);
      continue;
    }
    if (![...names].some((n) => URLISH.test(n.replace(PUBLIC_PREFIX, '')))) continue;
    const id = `external:env:${prefix.toLowerCase().replace(/_/g, '-')}`;
    drafts.push({
      id,
      label: labelFor(prefix),
      kind: 'external',
      layer: 'external',
      summary: `env: ${[...names].sort().join(', ')}`,
      tags: ['env'],
      meta: { env: [...names].sort() },
      ownedFiles: [],
    });
    byPrefix.set(prefix, id);
  }
  return { drafts, byPrefix };
}
