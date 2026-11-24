import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** In dev, Vite proxies /api to the codehud server and injects the bearer token from ~/.codehud/server.json. */
function serverInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codehud', 'server.json'), 'utf8')); } catch { return null; }
}

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${serverInfo()?.port ?? 4777}`,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            const info = serverInfo();
            if (info?.token) proxyReq.setHeader('authorization', `Bearer ${info.token}`);
          });
        },
      },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
