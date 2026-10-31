// Feature dictionaries merged into T (translations.js) at load time.
// One file per feature so parallel work never touches the same lines of
// translations.js. Each part exports { es: {...}, en: {...} } with the same keys.
import posRx from "./pos-rx.js";
import posFrame from "./pos-frame.js";
import posDocs from "./pos-docs.js";
import adminTheme from "./admin-theme.js";
import salesBoard from "./sales-board.js";
import cashReport from "./cash-report.js";
import statement from "./statement.js";
import exec from "./exec.js";
import screens from "./screens.js";

export const PARTS = [posRx, posFrame, posDocs, adminTheme, salesBoard, cashReport, statement, exec, screens];
