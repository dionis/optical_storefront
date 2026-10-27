/**
 * POST /admin/pos/prescriptions/ocr — the counter's "photo of the prescription
 * with automatic reading" (E4, step 3). The same reader as the web's
 * /store/prescriptions/ocr (same models, file limits and confirmation rule:
 * the clerk reviews the values before the sale stores them), reached with the
 * panel session instead of the publishable key. Upload and rate limit are the
 * same middlewares (src/api/middlewares.ts).
 */
export { POST } from "../../../../store/prescriptions/ocr/route";
