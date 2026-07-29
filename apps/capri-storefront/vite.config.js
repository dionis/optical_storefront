import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Mismo criterio de parseo que src/config/features.js, para que el flag no
// signifique una cosa en el bundler y otra en tiempo de ejecución.
function flagEnabled(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(v)) return true;
  if (["false", "0", "off", "no"].includes(v)) return false;
  return fallback;
}

// Con el probador desactivado, redirige el import dinámico de TryOn.jsx a un
// stub vacío. `TRY_ON_ENABLED` ya impide renderizarlo, pero por sí solo no
// evita que Rollup construya el chunk: el import dinámico sigue en el grafo y
// arrastra three.js (~560 kB), que se emite y se despliega aunque nadie lo
// descargue. Cortando la resolución del módulo, el chunk no llega a existir.
function disableTryOn() {
  const stub = resolve(HERE, "src/components/TryOn.disabled.jsx");
  return {
    name: "disable-try-on",
    enforce: "pre",
    resolveId(source) {
      if (/(^|[\\/])TryOn\.jsx$/.test(source)) return stub;
      return null;
    },
  };
}

// Storefront runs on a non-standard port (5198) as requested.
export default defineConfig(({ mode }) => {
  // loadEnv lee los .env; process.env cubre las variables del CI.
  const env = { ...loadEnv(mode, HERE, ""), ...process.env };
  const tryOnEnabled = flagEnabled(env.VITE_ENABLE_TRY_ON);

  return {
    plugins: [react(), ...(tryOnEnabled ? [] : [disableTryOn()])],
    server: {
      port: 5198,
      host: true,
      strictPort: true,
    },
    preview: {
      port: 5198,
      host: true,
      strictPort: true,
    },
  };
});
