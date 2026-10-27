/**
 * Re-export only. THE MODEL DEFINITIONS MUST NOT LIVE IN THIS FILE.
 *
 * Medusa's `loadModels` skips any `index.*` file in a module's models folder, so
 * a module whose models live only here boots with NO models. See
 * src/modules/store-settings/models/index.ts.
 */
export * from "./establishment";
