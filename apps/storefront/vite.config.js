import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same app as apps/capri-storefront; runs on port 3000 so both storefronts can
// boot side by side under the root `pnpm dev` (capri keeps 5198).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    strictPort: true,
  },
  preview: {
    port: 3000,
    host: true,
    strictPort: true,
  },
});
