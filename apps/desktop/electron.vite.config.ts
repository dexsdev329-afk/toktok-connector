import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages are TypeScript sources: bundle them instead of externalizing.
const workspace = ['@toktok/core', '@toktok/integrations', '@toktok/shared'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspace },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads must be CommonJS and self-contained.
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react(), tailwindcss()],
  },
});
