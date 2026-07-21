import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// `@whiteboard/shared` is consumed as source: alias it to the .ts entry so
// Vite transpiles it like first-party code (no separate build step in dev).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@whiteboard/shared': fileURLToPath(
        new URL('../shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    // Listen on 0.0.0.0 so a real iPad/phone on the LAN can load the dev app.
    host: true,
    proxy: {
      // Proxy auth/API to the collab server (avoids CORS; keeps cookies first-party).
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      // Proxy WebSocket to the collab server.
      '/collab': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/collab/, ''),
      },
    },
  },
});
