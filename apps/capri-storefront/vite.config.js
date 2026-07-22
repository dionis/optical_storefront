import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Storefront runs on a non-standard port (5198) as requested.
export default defineConfig({
  plugins: [react()],
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
});
