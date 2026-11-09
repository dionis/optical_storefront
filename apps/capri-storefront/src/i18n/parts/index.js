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
import saleDetail from "./sale-detail.js";
import help from "./help.js";
import fit from "./fit.js";
import roles from "./roles.js";
import report from "./report.js";
import pricing from "./pricing.js";
import sellers from "./sellers.js";
import costs from "./costs.js";
import catalogSync from "./catalog-sync.js";
import aiUsage from "./ai-usage.js";
import period from "./period.js";
import backlog from "./backlog.js";
import search from "./search.js";
import catalog from "./catalog.js";
import team from "./team.js";
import storeOrders from "./store-orders.js";
import lensFinish from "./lens-finish.js";
import posFlow from "./pos-flow.js";
import posRules from "./pos-rules.js";
import posOps from "./pos-ops.js";
import pricingAcross from "./pricing-across.js";
import auth from "./auth.js";
import tenant from "./tenant.js";
import sessions from "./sessions.js";
import securityExtra from "./security-extra.js";
import priceMatrix from "./price-matrix.js";
import finance from "./finance.js";
import posTablet from "./pos-tablet.js";
import patients from "./patients.js";
import password from "./password.js";
import saleAdmin from "./sale-admin.js";

export const PARTS = [posRx, posFrame, posDocs, adminTheme, salesBoard, cashReport, statement, exec, screens, saleDetail, help, fit, roles, report, sellers, costs, pricing, catalogSync, aiUsage, period, backlog, search, catalog, team, storeOrders, lensFinish, posFlow, posRules, auth, pricingAcross, posOps, sessions, securityExtra, priceMatrix, posTablet, finance, patients, tenant, saleAdmin, password];
