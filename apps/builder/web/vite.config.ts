import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The builder backend binds 127.0.0.1:BUILDER_PORT (default 4123, spec §F).
// In dev, proxy /api + /health to it; lat4-ui wires the live endpoints.
const PORT = process.env.BUILDER_PORT ?? '4123';
const target = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  root: 'src',
  plugins: [preact()],
  build: {
    // Served by apps/builder/server at "/" (lat4-ui task 1).
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Regex, not the '/api' prefix: a bare prefix also swallows the SOURCE MODULE `/api.ts`
      // (root is src/, so modules are served at "/"), handing vite's module request to the
      // backend — which answers with index.html and the whole dev page dies on a MIME error.
      '^/api(/|$)': { target, changeOrigin: true },
      '^/health$': { target, changeOrigin: true },
    },
  },
});
