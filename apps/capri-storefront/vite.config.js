import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Storefront runs on a non-standard port (5198) as requested.
// Dev proxy: same-origin `/medusa/*` → Medusa backend, para evitar CORS del navegador.
// (En producción lo hace Vercel con un rewrite equivalente, ver vercel.json.)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const MEDUSA = (env.VITE_MEDUSA_URL || "").replace(/\/$/, "");
  return {
    plugins: [react()],
    server: {
      port: 5198,
      host: true,
      strictPort: true,
      proxy: MEDUSA
        ? {
            "/medusa": {
              target: MEDUSA,
              changeOrigin: true,
              secure: true,
              rewrite: (p) => p.replace(/^\/medusa/, ""),
            },
          }
        : undefined,
    },
    preview: {
      port: 5198,
      host: true,
      strictPort: true,
    },
  };
});
