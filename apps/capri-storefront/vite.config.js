import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Identidad de este build, para que una pestaña abierta desde antes de un deploy
// pueda darse cuenta sola de que está corriendo JS viejo (src/lib/buildVersion.js).
// En Vercel viene el SHA del commit; si no, la hora del build sirve igual: lo
// único que importa es que cambie en cada despliegue.
function buildId(env) {
  return String(env.VERCEL_GIT_COMMIT_SHA || Date.now());
}

// Publica el id en un JSON que el bundle puede pedir en caliente. Se emite desde
// el bundle (no desde public/) para que no exista una copia versionada en el
// repo que se olvide de actualizarse.
function emitBuildId(id) {
  return {
    name: "emit-build-id",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-id.json",
        source: JSON.stringify({ build_id: id }),
      });
    },
  };
}

// Storefront runs on a non-standard port (5198) as requested.
export default defineConfig(({ mode }) => {
  // loadEnv lee los .env; process.env cubre las variables del CI.
  const env = { ...loadEnv(mode, HERE, ""), ...process.env };
  const id = buildId(env);

  return {
    define: {
      // En dev queda "dev" y el chequeo de versión no hace nada.
      __BUILD_ID__: JSON.stringify(mode === "production" ? id : "dev"),
    },
    plugins: [react(), emitBuildId(id)],
    server: {
      port: 5198,
      host: true,
      strictPort: true,
      // Same-origin proxy for local dev, mirroring the Vercel rewrite:
      // `/medusa/store/...` → `${backend}/store/...`. Keeps the browser talking
      // only to localhost (no CORS) exactly like production.
      proxy: {
        "/medusa": {
          target: env.VITE_MEDUSA_PROXY_TARGET || "https://api.161-153-9-98.sslip.io",
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/medusa/, ""),
        },
      },
    },
    preview: {
      port: 5198,
      host: true,
      strictPort: true,
    },
  };
});
