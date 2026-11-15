/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Writes precache-manifest.json listing every emitted asset so the hand-written service worker
 * (public/sw.js) can cache the complete application shell for offline use.
 */
function precacheManifest(): Plugin {
  return {
    name: 'sms-precache-manifest',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => '/' + f);
      const version = Date.now().toString(36);
      this.emitFile({ type: 'asset', fileName: 'precache-manifest.json', source: JSON.stringify({ version, files: ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', ...files] }) });
    }
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080', '/uploads': 'http://localhost:8080' }
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
});
