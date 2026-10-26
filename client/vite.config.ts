import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    fs: { allow: [path.resolve(here, '..')] },
    allowedHosts: true, // Replit preview hosts
  },
  build: {
    outDir: path.resolve(here, '../dist/client'),
    emptyOutDir: true,
  },
});
