/**
 * Re-export only. THE MODEL DEFINITIONS MUST NOT LIVE IN THIS FILE.
 *
 * Medusa discovers a module's models by reading every file in this directory —
 * and `loadModels` (in @medusajs/utils) explicitly SKIPS anything named
 * `index.*`. A module whose models live only in models/index.ts is loaded with
 * no models, so it gets no MikroORM connection, so its container has no
 * `manager`, and every service call dies with:
 *
 *     Cannot read properties of undefined (reading 'fork')
 *         at MikroOrmBaseRepository.getFreshManager
 *
 * There is no other symptom: the module still resolves, routes still mount, and
 * reads wrapped in a try/catch silently return their fallback. That is what made
 * this cost a day to find.
 *
 * So each model gets its own file, and this one only re-exports so existing
 * imports keep working.
 */
export { FrameMediaAsset } from "./frame-media-asset";
export { FrameMediaBudget } from "./frame-media-budget";
