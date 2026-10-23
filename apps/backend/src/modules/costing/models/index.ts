/**
 * Re-export only. THE MODEL DEFINITIONS MUST NOT LIVE IN THIS FILE.
 *
 * Medusa's `loadModels` skips any `index.*` file in a module's models folder, so
 * a module whose models live only here boots with NO models, no MikroORM manager
 * and fails on the first query with "Cannot read properties of undefined
 * (reading 'fork')". See src/modules/store-settings/models/index.ts.
 */
export * from "./cost-rule";
