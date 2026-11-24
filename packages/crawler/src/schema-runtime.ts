/**
 * Runtime access to `validateSystemMap` and `WELL_KNOWN_LAYERS` from @codehud/schema.
 *
 * TODO(schema): packages/schema/src/index.ts currently uses a constructor parameter property in
 * `MapIndex` (`constructor(public readonly map: SystemMap)`), which Node's strip-only TypeScript
 * loader rejects (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). Until that is changed to an explicit field
 * assignment, importing the schema module at runtime throws. We therefore import it dynamically and
 * fall back to a faithful local mirror of the validator so the CLI keeps working. Delete the mirror
 * once the schema package loads under plain `node` and is installed into node_modules.
 */
import type { Layer, SysNode, SystemMap } from '../../schema/src/index.ts';

type Validate = (input: unknown) => { ok: true; map: SystemMap } | { ok: false; errors: string[] };

export const FALLBACK_LAYERS: Layer[] = [
  { id: 'client', label: 'Client', description: 'Pages, components, browser state' },
  { id: 'edge', label: 'Edge', description: 'Middleware, auth guards, routing, CDN' },
  { id: 'api', label: 'API', description: 'HTTP / RPC endpoints, server actions' },
  { id: 'domain', label: 'Domain', description: 'Business logic, services, jobs' },
  { id: 'persistence', label: 'Persistence', description: 'Databases, tables, caches, buckets' },
  { id: 'external', label: 'External', description: 'Third-party systems' },
];

/** Mirror of `validateSystemMap` in packages/schema/src/index.ts. Keep in sync. */
export const fallbackValidate: Validate = (input) => {
  const errors: string[] = [];
  const m = input as Partial<SystemMap>;
  if (!m || typeof m !== 'object') return { ok: false, errors: ['map must be an object'] };
  if (m.version !== 1) errors.push('version must be 1');
  if (typeof m.name !== 'string' || !m.name) errors.push('name is required');
  for (const k of ['layers', 'lanes', 'nodes', 'edges'] as const) {
    if (!Array.isArray(m[k])) errors.push(`${k} must be an array`);
  }
  if (errors.length) return { ok: false, errors };
  const layerIds = new Set(m.layers!.map((l) => l.id));
  const laneIds = new Set(m.lanes!.map((l) => l.id));
  const nodeIds = new Set<string>();
  for (const n of m.nodes!) {
    if (!n.id) errors.push('node without id');
    else if (nodeIds.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    nodeIds.add(n.id);
    if (!n.label) errors.push(`node ${n.id} missing label`);
    if (!n.layer) errors.push(`node ${n.id} missing layer`);
    else if (!layerIds.has(n.layer)) errors.push(`node ${n.id} references unknown layer ${n.layer}`);
    if (n.lane && !laneIds.has(n.lane)) errors.push(`node ${n.id} references unknown lane ${n.lane}`);
  }
  for (const n of m.nodes!) {
    if (n.parent && !nodeIds.has(n.parent)) errors.push(`node ${n.id} references unknown parent ${n.parent}`);
    if (n.parent === n.id) errors.push(`node ${n.id} is its own parent`);
  }
  m.edges!.forEach((e, i) => {
    if (!nodeIds.has(e.from)) errors.push(`edge[${i}] from unknown node ${e.from}`);
    if (!nodeIds.has(e.to)) errors.push(`edge[${i}] to unknown node ${e.to}`);
  });
  for (const n of m.nodes!) {
    const seen = new Set<string>();
    let cur: SysNode | undefined = n;
    while (cur?.parent) {
      if (seen.has(cur.parent)) { errors.push(`parent cycle at ${n.id}`); break; }
      seen.add(cur.parent);
      const pid: string = cur.parent;
      cur = m.nodes!.find((x) => x.id === pid);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, map: m as SystemMap };
};

export interface SchemaRuntime {
  validateSystemMap: Validate;
  WELL_KNOWN_LAYERS: Layer[];
  /** true when the real @codehud/schema module was loaded. */
  real: boolean;
}

export async function loadSchemaRuntime(): Promise<SchemaRuntime> {
  try {
    // TODO: '@codehud/schema' once the workspace is installed.
    const mod = (await import('../../schema/src/index.ts')) as { validateSystemMap: Validate; WELL_KNOWN_LAYERS: Layer[] };
    return { validateSystemMap: mod.validateSystemMap, WELL_KNOWN_LAYERS: mod.WELL_KNOWN_LAYERS, real: true };
  } catch {
    return { validateSystemMap: fallbackValidate, WELL_KNOWN_LAYERS: FALLBACK_LAYERS, real: false };
  }
}
