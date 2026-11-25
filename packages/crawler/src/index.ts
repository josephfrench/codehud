/**
 * @codehud/crawler — public surface.
 *
 *   import { crawl } from '@codehud/crawler';
 *   const map = await crawl('/path/to/repo', { name: 'My app' });
 *
 * The crawler only reads files. It never imports, requires, builds or runs anything from the
 * repository it crawls (see guard.ts), and it has one runtime dependency: `typescript`, used
 * parse-only for the import graph.
 */
export { crawl, crawlDetailed, GENERATOR, type CrawlResult } from './crawl.ts';
export type { CrawlOptions, Adapter, CrawlContext, Draft, ScanOutput } from './types.ts';
export { ADAPTERS } from './adapters/index.ts';
export { applyOverlay, overlayTemplate, readOverlay, OVERLAY_PATH, type Overlay } from './overlay.ts';
export { laneHintFromPath } from './lanes.ts';
export { parseYaml } from './yaml.ts';
export { withGuard, installExecGuard, RepoExecutionError } from './guard.ts';
