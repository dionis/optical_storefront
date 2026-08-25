import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The measurement API runs as a separate process (apps/vision-measure). It is proxied
// rather than called directly so the browser only ever talks to its own origin: no CORS
// preflight, and an API key typed into the panel never crosses a third origin.
const VISION_API = process.env.VISION_API_URL || 'http://127.0.0.1:8008';

// In production this app is built into apps/capri-storefront/public/tryon-3d/ and
// served from the storefront's own Vercel deployment under that subpath (see root
// vercel.json). Vite needs the base path to emit correct asset URLs for that case.
const BASE = process.env.VITE_TRYON_BASE || '/';

export default defineConfig({
  base: BASE,
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: VISION_API,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // Two entry points: the try-on itself and the standalone report page. Without
      // listing report.html here it is simply absent from a production build.
      input: {
        main: resolve(__dirname, 'index.html'),
        report: resolve(__dirname, 'report.html')
      }
    }
  }
});
