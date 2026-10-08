import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    rollupOptions: { input: { main: resolve('index.html'), lab: resolve('lab.html') } },
  },
});
