import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built as a single page served by the app's local server at /o/:id (assets under /assets).
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true, assetsDir: 'assets' },
});
