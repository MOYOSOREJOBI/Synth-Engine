import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' http://localhost:8787; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self';"
    }
  },
  build: { target: 'es2022', sourcemap: false }
});
