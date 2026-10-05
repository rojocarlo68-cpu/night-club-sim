import { defineConfig } from 'vite';

// Cache-busting id: GitHub Pages serves every file with max-age=600, so a new deploy could mix new JS with stale art.
// BootScene appends ?v=<id> to every loader URL; the id changes on every build.
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
