import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    // O SDK do Firebase sozinho ronda os 500 kB (≈120 kB comprimido); é normal.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
