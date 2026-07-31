/**
 * Vite injects these at build time. Declared locally rather than pulling in
 * `vite/client`, which is not a direct dependency of this workspace — the admin
 * bundler ships its own copy of Vite.
 */
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
