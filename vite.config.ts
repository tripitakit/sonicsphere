import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
