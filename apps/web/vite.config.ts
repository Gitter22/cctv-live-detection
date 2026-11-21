import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API is same-origin: in dev Vite proxies /api to the server, in Docker nginx does.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false } },
  },
  // @cctv/shared is a linked CommonJS workspace package: pre-bundle it for the browser.
  optimizeDeps: { include: ['@cctv/shared'] },
  build: { commonjsOptions: { include: [/packages\/shared/, /node_modules/] } },
});
