/**
 * Adapter registry. Classification runs by descending `priority`; scans and edges run in the order
 * below (externals first so env-externals can fold into catalogued ones; infra before code-level
 * persistence so env references resolve to declared resources).
 */
import type { Adapter } from '../types.ts';
import { angular } from './angular.ts';
import { astro } from './astro.ts';
import { cdk } from './cdk.ts';
import { compose } from './compose.ts';
import { drizzle } from './drizzle.ts';
import { dynamodb } from './dynamodb.ts';
import { envExternals, npmExternals } from './externals.ts';
import { generic } from './generic.ts';
import { nest } from './nest.ts';
import { next } from './next.ts';
import { mongoose, sequelize, typeorm } from './orms.ts';
import { prisma } from './prisma.ts';
import { python } from './python.ts';
import { reactRouter } from './react-router.ts';
import { remix } from './remix.ts';
import { serverless } from './serverless.ts';
import { supabase } from './supabase.ts';
import { sveltekit } from './sveltekit.ts';
import { terraform } from './terraform.ts';
import { vercel } from './vercel.ts';
import { vue } from './vue.ts';
import { wrangler } from './wrangler.ts';

export const ADAPTERS: Adapter[] = [
  // externals
  npmExternals,
  // infrastructure (declares resources + env refs)
  wrangler,
  terraform,
  cdk,
  serverless,
  compose,
  vercel,
  // frameworks
  python,
  nest,
  angular,
  vue,
  next,
  sveltekit,
  remix,
  reactRouter,
  astro,
  // persistence from code
  drizzle,
  prisma,
  mongoose,
  typeorm,
  sequelize,
  dynamodb,
  supabase,
  // last
  envExternals,
  generic,
];

export function adapterById(id: string): Adapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
