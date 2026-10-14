// Gestión REAL del catálogo desde el panel: descontinuar/reactivar espejuelos
// (y marcas completas), cambiar el precio de venta de una montura y exportar
// el catálogo a Excel/CSV. Todo contra la Admin API de Medusa con la sesión
// JWT del panel (adminFetch) — nada queda solo en el navegador.
//
// Regla del módulo: sin hook de idioma. Lo que llegue a la pantalla viaja como
// CLAVE de diccionario y lo traduce quien pinta.
import { adminFetch } from "./adminApi.js";

/**
 * Descontinuar / reactivar una montura.
 * En Medusa "descontinuado" = status `draft`: el producto desaparece del
 * catálogo público (la Store API solo lista `published`) pero conserva su
 * historial de pedidos. `published` lo reactiva.
 */
export async function setProductStatus(productId, discontinued) {
  if (!productId) throw new Error("missing_product_id");
  const status = discontinued ? "draft" : "published";
  const data = await adminFetch(`/admin/products/${encodeURIComponent(productId)}`, {
    method: "POST",
    body: { status },
  });
  return data?.product?.status === status;
}

/**
 * Descontinuar / reactivar TODA una marca (todas sus monturas cargadas en el
 * catálogo). Secuencial en lotes pequeños para no saturar la API; devuelve
 * { done, failed: [names] } y avisa por onProgress(i, total).
 */
export async function setBrandStatus(products, brandSlug, discontinued, onProgress) {
  const targets = products.filter((p) => p.brand_slug === brandSlug && p.medusaId);
  const failed = [];
  let done = 0;
  for (const p of targets) {
    try {
      await setProductStatus(p.medusaId, discontinued);
      done += 1;
    } catch {
      failed.push(p.name);
    }
    if (onProgress) onProgress(done + failed.length, targets.length);
  }
  return { done, failed, total: targets.length };
}

/**
 * Cambiar el precio de venta (USD) de una montura: escribe el MISMO precio en
 * todas sus variantes (colores) vía la Admin API. Medusa v2 espera los
 * importes en unidades decimales.
 */
export async function setFramePrice(product, amount) {
  const price = Number(amount);
  if (!product?.medusaId || !Number.isFinite(price) || price <= 0) {
    throw new Error("bad_price");
  }
  const variantIds = (product.colors || []).map((c) => c.variantId).filter(Boolean);
  if (!variantIds.length) throw new Error("no_variants");
  // Lee las variantes para conservar su moneda/estructura mínima de precios.
  for (const vid of variantIds) {
    await adminFetch(
      `/admin/products/${encodeURIComponent(product.medusaId)}/variants/${encodeURIComponent(vid)}`,
      { method: "POST", body: { prices: [{ amount: price, currency_code: "usd" }] } }
    );
  }
  return { updated: variantIds.length, price };
}

/**
 * Monturas DESCONTINUADAS (status draft). El catálogo del panel se alimenta de
 * la Store API, que solo lista `published`, así que sin esta lista un producto
 * descontinuado se volvería invisible e imposible de reactivar.
 */
export async function fetchDiscontinued() {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 10; page++) {
    const data = await adminFetch(`/admin/products`, {
      query: { status: "draft", limit: 100, offset, fields: "id,title,handle,thumbnail,status" },
    });
    const items = data?.products || [];
    out.push(...items.map((p) => ({ medusaId: p.id, name: p.title, slug: p.handle, image: p.thumbnail })));
    if (items.length < 100) break;
    offset += 100;
  }
  return out;
}

// ── Exportación del catálogo ─────────────────────────────────────────────────

const EXPORT_COLUMNS = [
  ["sku", (p) => p.sku || p.name],
  ["nombre", (p) => p.name],
  ["marca", (p) => p.brand || ""],
  ["tipo", (p) => (p.isCase ? "estuche" : "montura")],
  ["precio_usd", (p) => (typeof p.price === "number" ? p.price.toFixed(2) : "")],
  ["precio_anterior_usd", (p) => (typeof p.originalPrice === "number" ? p.originalPrice.toFixed(2) : "")],
  ["colores", (p) => (p.colors || []).map((c) => c.name).join(" | ")],
  ["forma", (p) => p.attributes?.shape || ""],
  ["material", (p) => [].concat(p.attributes?.material || []).join(" | ")],
  ["genero", (p) => p.attributes?.gender || ""],
  ["calibre", (p) => p.attributes?.eye_size || ""],
  ["puente", (p) => p.attributes?.bridge_size || ""],
  ["varilla", (p) => p.attributes?.temple_length || ""],
  ["slug", (p) => p.slug],
  ["imagen", (p) => p.colors?.[0]?.image || ""],
];

function rows(products, cases) {
  const all = [...(products || []), ...(cases || [])];
  return all.map((p) => EXPORT_COLUMNS.map(([, fn]) => String(fn(p) ?? "")));
}

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** CSV UTF-8 con BOM: Excel lo abre con acentos correctos y una columna por campo. */
export function exportCatalogCsv(products, cases) {
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const head = EXPORT_COLUMNS.map(([k]) => esc(k)).join(";");
  const body = rows(products, cases).map((r) => r.map(esc).join(";")).join("\r\n");
  downloadBlob("\uFEFF" + head + "\r\n" + body, "text/csv;charset=utf-8", `catalogo-rubilens-${stamp()}.csv`);
  return (products?.length || 0) + (cases?.length || 0);
}

/** .xls (HTML con formato): Excel lo abre como hoja con cabecera estilizada. */
export function exportCatalogExcel(products, cases) {
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const head = EXPORT_COLUMNS.map(([k]) => `<th style="background:#01326b;color:#fff;padding:6px 10px;border:1px solid #223;white-space:nowrap">${esc(k)}</th>`).join("");
  const body = rows(products, cases)
    .map((r) => "<tr>" + r.map((v) => `<td style="padding:4px 8px;border:1px solid #ccd;mso-number-format:'\\@'">${esc(v)}</td>`).join("") + "</tr>")
    .join("");
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Catalogo</x:Name><x:WorksheetOptions/></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table>${"<thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody>"}</table></body></html>`;
  downloadBlob(html, "application/vnd.ms-excel", `catalogo-rubilens-${stamp()}.xls`);
  return (products?.length || 0) + (cases?.length || 0);
}
