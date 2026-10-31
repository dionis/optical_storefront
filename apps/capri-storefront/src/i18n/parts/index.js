// Feature dictionaries merged into T (translations.js) at load time.
// One file per feature so parallel work never touches the same lines of
// translations.js. Each part exports { es: {...}, en: {...} } with the same keys.
import posRx from "./pos-rx.js";

export const PARTS = [posRx];
