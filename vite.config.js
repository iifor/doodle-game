import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0' },
  esbuild: { jsx: 'automatic' },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: { manualChunks: { three: ['three'], react: ['react', 'react-dom/client'] } },
    },
  },
});
