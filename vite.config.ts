import { defineConfig } from 'vite';
const headers = {
  // Model/WASM remain same-origin. Only allowlisted diagnostics reach the self-hosted Sentry.
  'Content-Security-Policy': "connect-src 'self' ws://127.0.0.1:5173 https://sentry.x2e.me; object-src 'none'; base-uri 'self'; form-action 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
};
export default defineConfig({
  build: { rollupOptions: { preserveEntrySignatures:'strict', output:{entryFileNames:chunk=>chunk.name==='cameraRuntime'?'camera-runtime.js':'assets/[name]-[hash].js'}, input: { app: 'index.html', poc: 'poc.html', legacy: 'legacy.html', cameraRuntime:'src/camera-runtime.ts' } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, headers, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, headers },
});
