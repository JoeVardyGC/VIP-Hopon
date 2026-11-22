import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:phone` serves over HTTPS on your Wi-Fi address. Phones only allow the camera
// (QR scanning) and GPS (check-in, driver location) on secure pages.
export default defineConfig(({ mode }) => ({
  root: 'web',
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    // API_PORT lets a test copy of the app talk to a test API (default 4000).
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT || 4000}`, xfwd: true },
      '/socket.io': { target: `http://localhost:${process.env.API_PORT || 4000}`, ws: true },
    },
  },
}));
