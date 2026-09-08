import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api/worlds': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
    },
  },
  esbuild: { jsx: 'automatic' },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: { manualChunks: { three: ['three'], react: ['react', 'react-dom/client'] } },
    },
  },
});
