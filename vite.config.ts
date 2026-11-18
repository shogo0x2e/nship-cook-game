import { defineConfig } from 'vite';
const headers = {
  // Model/WASM loads remain same-origin; neither application nor model may connect to an external server.
  'Content-Security-Policy': "connect-src 'self' ws://127.0.0.1:5173; object-src 'none'; base-uri 'self'; form-action 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
};
export default defineConfig({
  build: { rollupOptions: { input: { app: 'index.html', poc: 'poc.html', legacy: 'legacy.html' } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, headers, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, headers },
});
