import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonc, readText } from './fs.ts';
import type { Framework, PackageInfo, PackageRole } from './types.ts';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

const FRAMEWORK_DEPS: [string, Framework][] = [
  ['astro', 'astro'],
  ['next', 'next'],
  ['@sveltejs/kit', 'sveltekit'],
  ['@remix-run/react', 'remix'],
  ['@remix-run/node', 'remix'],
  ['@react-router/dev', 'remix'],
  ['express', 'express'],
  ['hono', 'hono'],
  ['fastify', 'fastify'],
  ['koa', 'koa'],
  ['vite', 'vite'],
];

const SERVER_FRAMEWORKS = new Set<Framework>(['express', 'hono', 'fastify', 'koa']);
const UI_LIBS = ['svelte', 'react', 'vue', 'preact', 'solid-js', 'lit'];

export function detectFrameworks(deps: Record<string, string>): Framework[] {
  const out: Framework[] = [];
  for (const [dep, fw] of FRAMEWORK_DEPS) if (dep in deps && !out.includes(fw)) out.push(fw);
  return out.length ? out : ['unknown'];
}

function roleOf(dir: string, deps: Record<string, string>, frameworks: Framework[]): PackageRole {
  const last = dir.split('/').pop() ?? '';
  if (frameworks.some((f) => SERVER_FRAMEWORKS.has(f))) return 'server';
  if (/^(server|api|backend|worker|workers|gateway)$/i.test(last)) return 'server';
  const hasUi = UI_LIBS.some((u) => u in deps);
  if (hasUi && (frameworks.includes('vite') || /^(hud|web|ui|client|frontend|app|www|site)$/i.test(last))) return 'frontend';
  return 'library';
}

function workspaceGlobs(root: string, pkg: PackageJson | undefined): string[] {
  const globs: string[] = [];
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) globs.push(...ws);
  else if (ws && Array.isArray(ws.packages)) globs.push(...ws.packages);
  const yaml = readText(join(root, 'pnpm-workspace.yaml'));
  if (yaml) {
    let inPackages = false;
    for (const raw of yaml.split('\n')) {
      const line = raw.replace(/#.*$/, '').trimEnd();
      if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        const m = /^\s+-\s*['"]?([^'"]+?)['"]?\s*$/.exec(line);
        if (m) globs.push(m[1]!);
        else if (line.trim() && !/^\s/.test(line)) inPackages = false;
      }
    }
  }
  return globs.filter((g) => !g.startsWith('!'));
}

/** Expand `packages/*` style globs (one wildcard level supported) to directories with a package.json. */
function expandGlob(root: string, glob: string): string[] {
  const clean = glob.replace(/\/+$/, '');
  if (!clean.includes('*')) return existsSync(join(root, clean, 'package.json')) ? [clean] : [];
  const [head] = clean.split('*');
  const base = (head ?? '').replace(/\/+$/, '');
  const abs = join(root, base);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const dir = base ? `${base}/${name}` : name;
    try {
      if (statSync(join(root, dir)).isDirectory() && existsSync(join(root, dir, 'package.json'))) out.push(dir);
    } catch { /* ignore */ }
  }
  return out;
}

function tsconfigAliases(root: string, dir: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  const tsconfig = readJsonc<{ compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }>(
    join(root, dir, 'tsconfig.json'),
  );
  const paths = tsconfig?.compilerOptions?.paths ?? {};
  const baseUrl = (tsconfig?.compilerOptions?.baseUrl ?? '.').replace(/^\.\//, '').replace(/\/$/, '');
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (!target || !key.endsWith('*') || !target.endsWith('*')) continue;
    const prefix = key.slice(0, -1);
    let to = target.slice(0, -1).replace(/^\.\//, '');
    to = [dir, baseUrl, to].filter(Boolean).join('/').replace(/\/+/g, '/');
    aliases[prefix] = to;
  }
  const src = [dir, 'src/'].filter(Boolean).join('/');
  for (const conv of ['@/', '~/', '$lib/', 'src/']) {
    if (!(conv in aliases)) {
      if (conv === '$lib/') aliases[conv] = src + 'lib/';
      else aliases[conv] = src;
    }
  }
  return aliases;
}

function loadPackage(root: string, dir: string): PackageInfo | undefined {
  const pkg = readJsonc<PackageJson>(join(root, dir, 'package.json'));
  if (!pkg) return undefined;
  const deps = { ...(pkg.peerDependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  const frameworks = detectFrameworks(deps);
  return {
    dir,
    name: pkg.name ?? (dir.split('/').pop() || 'root'),
    deps,
    frameworks,
    role: roleOf(dir, deps, frameworks),
    aliases: tsconfigAliases(root, dir),
  };
}

/** Root package plus workspace packages. The root package is always first. */
export function discoverPackages(root: string): PackageInfo[] {
  const rootPkg = loadPackage(root, '') ?? {
    dir: '',
    name: root.split(/[\\/]/).filter(Boolean).pop() ?? 'repo',
    deps: {},
    frameworks: ['unknown'] as Framework[],
    role: 'library' as PackageRole,
    aliases: tsconfigAliases(root, ''),
  };
  const rootJson = readJsonc<PackageJson>(join(root, 'package.json'));
  const out: PackageInfo[] = [rootPkg];
  const seen = new Set(['']);
  for (const glob of workspaceGlobs(root, rootJson)) {
    for (const dir of expandGlob(root, glob)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      const info = loadPackage(root, dir);
      if (info) out.push(info);
    }
  }
  return out;
}

/** Longest-prefix package for a file. */
export function packageFor(rel: string, packages: PackageInfo[]): PackageInfo {
  let best = packages[0]!;
  for (const p of packages) {
    if (p.dir && (rel === p.dir || rel.startsWith(p.dir + '/')) && p.dir.length > best.dir.length) best = p;
  }
  return best;
}

export function mergedFrameworks(packages: PackageInfo[]): Set<Framework> {
  const s = new Set<Framework>();
  for (const p of packages) for (const f of p.frameworks) if (f !== 'unknown') s.add(f);
  return s;
}

// ---------------------------------------------------------------------------
// Externals: third-party systems recognised from npm package names.
// ---------------------------------------------------------------------------

export interface ExternalDef {
  id: string;
  label: string;
  /** Exact package names or scope prefixes ending in '/'. */
  match: string[];
  tags?: string[];
}

export const EXTERNALS: ExternalDef[] = [
  { id: 'stripe', label: 'Stripe', match: ['stripe', '@stripe/'], tags: ['payments'] },
  { id: 'paddle', label: 'Paddle', match: ['@paddle/'], tags: ['payments'] },
  { id: 'lemonsqueezy', label: 'Lemon Squeezy', match: ['@lemonsqueezy/'], tags: ['payments'] },
  { id: 'paypal', label: 'PayPal', match: ['@paypal/'], tags: ['payments'] },
  { id: 'plaid', label: 'Plaid', match: ['plaid'], tags: ['finance'] },
  { id: 'better-auth', label: 'Better Auth', match: ['better-auth', '@better-auth/'], tags: ['auth'] },
  { id: 'authjs', label: 'Auth.js', match: ['next-auth', '@auth/'], tags: ['auth'] },
  { id: 'clerk', label: 'Clerk', match: ['@clerk/'], tags: ['auth'] },
  { id: 'auth0', label: 'Auth0', match: ['auth0', '@auth0/'], tags: ['auth'] },
  { id: 'lucia', label: 'Lucia', match: ['lucia'], tags: ['auth'] },
  { id: 'workos', label: 'WorkOS', match: ['@workos-inc/'], tags: ['auth'] },
  { id: 'resend', label: 'Resend', match: ['resend'], tags: ['email'] },
  { id: 'postmark', label: 'Postmark', match: ['postmark'], tags: ['email'] },
  { id: 'sendgrid', label: 'SendGrid', match: ['@sendgrid/'], tags: ['email'] },
  { id: 'mailgun', label: 'Mailgun', match: ['mailgun.js', 'mailgun-js'], tags: ['email'] },
  { id: 'smtp', label: 'SMTP (nodemailer)', match: ['nodemailer'], tags: ['email'] },
  { id: 'twilio', label: 'Twilio', match: ['twilio'], tags: ['sms'] },
  { id: 'openai', label: 'OpenAI', match: ['openai', '@ai-sdk/openai'], tags: ['ai'] },
  { id: 'anthropic', label: 'Anthropic', match: ['@anthropic-ai/', '@ai-sdk/anthropic'], tags: ['ai'] },
  { id: 'google-ai', label: 'Google AI', match: ['@google/generative-ai', '@ai-sdk/google'], tags: ['ai'] },
  { id: 'aws', label: 'AWS', match: ['@aws-sdk/', 'aws-sdk'], tags: ['cloud'] },
  { id: 'gcp', label: 'Google Cloud', match: ['@google-cloud/', 'googleapis'], tags: ['cloud'] },
  { id: 'azure', label: 'Azure', match: ['@azure/'], tags: ['cloud'] },
  { id: 'cloudflare-api', label: 'Cloudflare API', match: ['cloudflare'], tags: ['cloud'] },
  { id: 'vercel', label: 'Vercel', match: ['@vercel/blob', '@vercel/kv', '@vercel/postgres', '@vercel/edge-config'], tags: ['cloud'] },
  { id: 'supabase', label: 'Supabase', match: ['@supabase/'], tags: ['baas'] },
  { id: 'firebase', label: 'Firebase', match: ['firebase', 'firebase-admin'], tags: ['baas'] },
  { id: 'convex', label: 'Convex', match: ['convex'], tags: ['baas'] },
  { id: 'upstash', label: 'Upstash', match: ['@upstash/'], tags: ['data'] },
  { id: 'docusign', label: 'DocuSign', match: ['docusign-esign'], tags: ['esign'] },
  { id: 'dropbox-sign', label: 'Dropbox Sign', match: ['hellosign-sdk', '@dropbox/sign'], tags: ['esign'] },
  { id: 'hubspot', label: 'HubSpot', match: ['@hubspot/'], tags: ['crm'] },
  { id: 'salesforce', label: 'Salesforce', match: ['jsforce'], tags: ['crm'] },
  { id: 'github', label: 'GitHub', match: ['@octokit/', 'octokit'], tags: ['devtools'] },
  { id: 'slack', label: 'Slack', match: ['@slack/'], tags: ['messaging'] },
  { id: 'discord', label: 'Discord', match: ['discord.js'], tags: ['messaging'] },
  { id: 'sentry', label: 'Sentry', match: ['@sentry/'], tags: ['observability'] },
  { id: 'posthog', label: 'PostHog', match: ['posthog-js', 'posthog-node'], tags: ['analytics'] },
  { id: 'segment', label: 'Segment', match: ['@segment/'], tags: ['analytics'] },
  { id: 'mixpanel', label: 'Mixpanel', match: ['mixpanel', 'mixpanel-browser'], tags: ['analytics'] },
  { id: 'algolia', label: 'Algolia', match: ['algoliasearch'], tags: ['search'] },
  { id: 'sanity', label: 'Sanity', match: ['@sanity/'], tags: ['cms'] },
  { id: 'contentful', label: 'Contentful', match: ['contentful'], tags: ['cms'] },
  { id: 'shopify', label: 'Shopify', match: ['@shopify/'], tags: ['commerce'] },
  { id: 'cloudinary', label: 'Cloudinary', match: ['cloudinary'], tags: ['media'] },
  { id: 'mux', label: 'Mux', match: ['@mux/'], tags: ['media'] },
  { id: 'uploadthing', label: 'UploadThing', match: ['uploadthing', '@uploadthing/'], tags: ['media'] },
  { id: 'pusher', label: 'Pusher', match: ['pusher', 'pusher-js'], tags: ['realtime'] },
  { id: 'ably', label: 'Ably', match: ['ably'], tags: ['realtime'] },
  { id: 'liveblocks', label: 'Liveblocks', match: ['@liveblocks/'], tags: ['realtime'] },
  { id: 'inngest', label: 'Inngest', match: ['inngest'], tags: ['jobs'] },
  { id: 'trigger', label: 'Trigger.dev', match: ['@trigger.dev/'], tags: ['jobs'] },
  { id: 'svix', label: 'Svix', match: ['svix'], tags: ['webhooks'] },
  { id: 'knock', label: 'Knock', match: ['@knocklabs/'], tags: ['notifications'] },
  { id: 'novu', label: 'Novu', match: ['@novu/'], tags: ['notifications'] },
  { id: 'launchdarkly', label: 'LaunchDarkly', match: ['launchdarkly-node-server-sdk', 'launchdarkly-js-client-sdk', '@launchdarkly/'], tags: ['flags'] },
  { id: 'statsig', label: 'Statsig', match: ['statsig-node', 'statsig-js', '@statsig/'], tags: ['flags'] },
  { id: 'intercom', label: 'Intercom', match: ['intercom-client', '@intercom/'], tags: ['support'] },
  { id: 'notion', label: 'Notion', match: ['@notionhq/'], tags: ['productivity'] },
  { id: 'airtable', label: 'Airtable', match: ['airtable'], tags: ['productivity'] },
  { id: 'linear', label: 'Linear', match: ['@linear/'], tags: ['productivity'] },
  { id: 'mapbox', label: 'Mapbox', match: ['mapbox-gl'], tags: ['maps'] },
  { id: 'google-maps', label: 'Google Maps', match: ['@googlemaps/'], tags: ['maps'] },
  { id: 'cal-com', label: 'Cal.com', match: ['@calcom/'], tags: ['scheduling'] },
];

/** The external definition an npm package belongs to, if any. */
export function externalFor(pkgName: string): ExternalDef | undefined {
  for (const def of EXTERNALS) {
    for (const m of def.match) {
      if (m.endsWith('/') ? pkgName.startsWith(m) : pkgName === m) return def;
    }
  }
  return undefined;
}

/** npm package name for a bare import specifier (`@scope/pkg/sub` -> `@scope/pkg`). */
export function packageNameOf(spec: string): string | undefined {
  if (spec.startsWith('.') || spec.startsWith('/')) return undefined;
  // protocol imports (node:, cloudflare:, astro:, virtual:, bun:) are runtimes, not packages
  if (/^[a-z][a-z0-9+-]*:/i.test(spec)) return undefined;
  const parts = spec.split('/');
  if (spec.startsWith('@')) return parts.length >= 2 ? parts.slice(0, 2).join('/') : undefined;
  return parts[0] || undefined;
}
