/**
 * Re-export only. THE MODEL DEFINITIONS MUST NOT LIVE IN THIS FILE.
 *
 * Medusa discovers a module's models by reading every file in this directory, and
 * `loadModels` (in @medusajs/utils) explicitly SKIPS anything named `index.*`. A
 * module whose models live only here is loaded with NO models, so it gets no
 * MikroORM connection, so its container has no `manager`, and every service call
 * dies with:
 *
 *     Cannot read properties of undefined (reading 'fork')
 *         at MikroOrmBaseRepository.getFreshManager
 *
 * There is no other symptom: the module still resolves, its routes still mount,
 * and any read wrapped in a try/catch silently returns its fallback. That is what
 * made this cost a day to find, and why every module here keeps its definitions in
 * a named file and uses this one only to re-export.
 */
export * from "./product-review";
