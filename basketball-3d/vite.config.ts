import { defineConfig } from 'vite';
import path from 'node:path';

// The GitHub Pages project site is served from https://<owner>.github.io/git/,
// so production builds need that subpath as `base`. Dev/preview stay at "/".
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/git/' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  server: {
    host: true,
  },
}));
