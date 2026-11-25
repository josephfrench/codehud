# Releasing `codehud` to npm

The publishable package is `packages/cli` (npm name `codehud`). It bundles the server, MCP bridge and
crawler to plain JS and ships the built HUD; the other workspace packages stay private.

1. Bump `version` in `packages/cli/package.json` (the MCP bridge reports its own version from
   `packages/mcp/src/index.ts`; bump that too so `serverInfo.version` matches).
2. `pnpm install && pnpm typecheck && pnpm test && pnpm pack` → `out/codehud-<version>.tgz`.
3. Smoke it outside the repo: `npm i -g --prefix <tmp> out/codehud-<version>.tgz`, then
   `<tmp>/codehud demo --port 4790`, `codehud crawl <some repo>`, `codehud install claude --project <tmp project>`.
4. Tag and push: `git tag v<version> && git push --tags`.
5. Publish with provenance (requires `npm login` with 2FA, or a trusted publisher set up for this repo):

   ```sh
   cd packages/cli
   pnpm build
   npm publish --access public --provenance
   ```

   `--provenance` needs to run inside GitHub Actions (OIDC) to attest; locally it is a no-op warning.
   When this is automated, add a `publish` job to `.github/workflows/ci.yml` gated on `v*` tags with
   `permissions: id-token: write` and `NODE_AUTH_TOKEN` from a granular automation token, and keep the
   existing `pack` artifact as the thing that job publishes so the published bits are the tested bits.
6. Verify: `npx -y codehud@<version> --help` from a clean directory.

Do not publish from a dirty tree, and never from a tree where `packages/hud/dist` was built with
`pnpm dev` assets; `packages/cli/scripts/build.mjs` rebuilds the HUD first for exactly this reason.
