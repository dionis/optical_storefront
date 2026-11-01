// Banco de pruebas del Ejecutivo: el AdminShell real con ExecutiveHub dentro y
// un backend simulado (fetch interceptado) para mirar la barra de filtros, el
// selector de tienda y la tira de KPI con sus variaciones, en claro y oscuro.
//   /harness/exec.html?mode=light|dark&tab=exec|salesboard|audit|sellers|storecosts|mysales|products|pos&store=all|web|<id>&role=owner|manager|seller&lang=es|en&period=month|range…
// La barra de filtros global (GlobalFilterBar.jsx) sale en todas las pestañas
// de BAR_TABS: tienda · período · rango · PDF/Excel/CSV, pegada bajo la cabecera.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "/src/i18n/LanguageContext.jsx";
import { FeedbackProvider } from "/src/components/Feedback.jsx";
import "/src/admin/admin.css";
import AdminShell, { navGroupsFor } from "/src/admin/AdminShell.jsx";
import ExecutiveHub from "/src/admin/ExecutiveHub.jsx";
import SalesBoard from "/src/admin/SalesBoard.jsx";
import AuditLog from "/src/admin/AuditLog.jsx";
import Sellers from "/src/admin/Sellers.jsx";
import StoreCosts from "/src/admin/StoreCosts.jsx";
import StoreStatement from "/src/admin/StoreStatement.jsx";
import Stores from "/src/admin/Stores.jsx";
import MySales from "/src/admin/MySales.jsx";
import { setPeriodState } from "/src/admin/periodStore.js";
import PricingPanel from "../src/admin/PricingPanel.jsx";
import EmptyPeriod from "/src/admin/EmptyPeriod.jsx";
import CatalogManager from "/src/admin/CatalogManager.jsx";
import { loadLive } from "/src/data/catalogStore.js";

const Q = new URLSearchParams(location.search);
const MODE = Q.get("mode") || "light";
const TAB0 = Q.get("tab") || "exec";
const STORE = Q.get("store") || "all";
const ROLE = Q.get("role") || "owner";
try { localStorage.setItem("adm_color_mode", MODE); } catch {}
try { localStorage.setItem("oer_lang", Q.get("lang") || "es"); } catch {}
try { if (STORE === "all") localStorage.removeItem("adm_active_store"); else localStorage.setItem("adm_active_store", STORE); } catch {}
if (Q.get("period")) setPeriodState({ period: Q.get("period"), from: Q.get("from") || "2026-10-01", to: Q.get("to") || "2026-10-31" });
try { sessionStorage.setItem("oer_admin_session", JSON.stringify({ user: "dueno@optica.com", token: "harness", exp: Date.now() + 3600e3 })); } catch {}

const STORES = [
  { id: "est_01", code: "Op1", name: "Fry Family Clinic", color: "#1B7F4C", is_active: true, kind: "partner", settlement_pct: 35, address: "1240 Fry Rd, Katy TX 77449", phone: "(281) 555-0110", created_at: "2025-02-14T10:00:00Z" },
  { id: "est_02", code: "Op2", name: "El Rancho 39", color: "#B5651D", is_active: true, kind: "own", address: "3920 W Flagler St, Miami FL 33134", phone: "(305) 555-0139", created_at: "2025-05-02T10:00:00Z" },
  { id: "est_03", code: "Op3", name: "El Rancho 41", color: "#C2185B", is_active: true, kind: "family", settlement_pct: 40, address: "4100 NW 7th St, Miami FL 33126", phone: "(305) 555-0141", created_at: "2026-01-19T10:00:00Z" },
  { id: "est_04", code: "Op4", name: "Hialeah Gardens", color: "#2563EB", is_active: true, kind: "consignment", settlement_pct: 25, address: "9200 NW 122nd St, Hialeah FL", phone: "(305) 555-0144", created_at: "2026-03-08T10:00:00Z" },
  { id: "est_05", code: "Op5", name: "Kendall Lakes", color: "#7C3AED", is_active: false, kind: "own", address: "13750 SW 88th St, Miami FL", phone: "(305) 555-0155", created_at: "2026-06-21T10:00:00Z" },
  { id: "est_06", code: "Op6", name: "Doral Plaza", color: "#0891B2", is_active: true, kind: "own", address: "8300 NW 53rd St, Doral FL", phone: "(305) 555-0166", created_at: "2026-09-02T10:00:00Z" },
];

// Cifras deterministas a partir del rango: el período anterior sale distinto.
const seed = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 1000) / 1000; };
const figures = (from, to, stores) => {
  const k = 0.6 + seed(`${from}${to}${stores}`) * 0.8;
  const sales = Math.round(18450 * k * 100) / 100;
  const net = sales / 1.07;
  const cost = Math.round(net * 0.42 * 100) / 100;
  const fee = Math.round(sales * 0.021 * 100) / 100;
  const commission = Math.round(net * 0.05 * 100) / 100;
  const profit = Math.round((net - cost - fee - commission) * 100) / 100;
  const count = Math.round(64 * k);
  return { sales, net, tax: sales - net, cost, fee, commission, profit, margin_pct: Math.round((profit / net) * 1000) / 10, count, units: Math.round(count * 1.8), avg_ticket: Math.round((sales / count) * 100) / 100 };
};
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/* ── Permisos simulados, como los calcula el servidor ──────────────────────
   lib/sales-insights.ts insightAccess: `profit` para el administrador y para
   quien tenga costs.view / costs.manage; `commission` para esos y, además,
   para el vendedor (ve la suya). El banco los aplica y REDACTA las cifras
   igual que redactInsights / attachSaleEconomics, que es la única manera de
   ver de verdad qué le queda en pantalla a un vendedor. */
const ROLE_PRIVS = { owner: [], manager: ["costs.view"], seller: [] };
const IS_ADMIN = ROLE === "owner";
const ACCESS = {
  profit: IS_ADMIN || (ROLE_PRIVS[ROLE] || []).some((x) => x === "costs.view" || x === "costs.manage"),
  commission: IS_ADMIN || (ROLE_PRIVS[ROLE] || []).some((x) => x === "costs.view" || x === "costs.manage") || ROLE === "seller",
};
/** Totales de insights redactados: cost/fee/profit a 0 y margen a null (redactInsights). */
const redactTotals = (f) => (ACCESS.profit ? f : { ...f, cost: 0, fee: 0, profit: 0, margin_pct: null });
/** Economía de una venta redactada: a null, como attachSaleEconomics. */
const redactSale = (r) => ({
  ...r,
  cost: ACCESS.profit ? r.cost : null,
  fee: ACCESS.profit ? r.fee : null,
  profit: ACCESS.profit ? r.profit : null,
  margin_pct: ACCESS.profit ? r.margin_pct : null,
  missing_cost: ACCESS.profit ? r.missing_cost ?? false : null,
  commission: ACCESS.commission ? r.commission : null,
});

/* ── Catálogo simulado (pestaña «products» = CatalogManager.jsx) ───────────
   Las monturas reales del repo no traen `medusaId` ni medidas exactas, así que
   el banco sirve su propio catálogo por /catalog.json: ocho marcas con modelos,
   colores, medidas en milímetros y los costos de proveedor reales de la lista
   de Capri, para mirar el acordeón por marca con cifras creíbles. */
const CM_BRANDS = [
  ["di-caprio", "Di Caprio", "DC", ["Black Gold", "Tortoise", "Gunmetal", "Navy", "Burgundy", "Crystal", "Matt Gold"], 7],
  ["peachtree", "Peachtree", "PT", ["Black", "Pink", "Purple", "Light Blue", "Rose"], 6],
  ["flexure", "Flexure", "FX", ["Black", "Silver", "Blue", "Brown"], 5],
  ["4u", "Four You", "U", ["Black", "Grey", "Tortoise", "Red"], 6],
  ["trendy", "Trendy", "TY", ["Pink", "Aqua", "Violet", "Green"], 4],
  ["millennial", "Millennial", "ML", ["Black", "Crystal", "Demi"], 4],
  ["grande", "Grande", "GR", ["Black", "Brown", "Gold"], 3],
  ["prorx", "ProRx", "PRX", ["Gunmetal", "Silver"], 3],
];
const SHAPES = ["Cuadrado", "Redondo", "Ovalado", "Rectangular", "Mariposa"];
const HEX = { "black gold": "#1a1a1a", tortoise: "#6b4423", gunmetal: "#4b4f56", navy: "#1f2a44", burgundy: "#6d1f2e", crystal: "#e8ecf1", "matt gold": "#c9a44a", black: "#1a1a1a", pink: "#e79cc2", purple: "#7b4aa0", "light blue": "#8fbde8", rose: "#d98695", silver: "#c0c0c0", blue: "#2f5fa8", brown: "#6b4423", grey: "#8a8a8a", red: "#c0392b", aqua: "#4bb8c4", violet: "#7b4aa0", green: "#3f8f5f", demi: "#8b5a2b", gold: "#c9a44a", multi: "#9aa3b0" };
// Foto de la montura: una silueta en el color del modelo, suficiente para ver
// la miniatura de cada fila sin depender de la red.
const photo = (name) => {
  const c = HEX[String(name).toLowerCase()] || "#b8bec8";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" fill="#f4f5f7"/><g fill="none" stroke="${c}" stroke-width="5"><circle cx="36" cy="30" r="18"/><circle cx="84" cy="30" r="18"/><path d="M54 28h12M18 22 6 18M102 22l12-4"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
const CM_FRAMES = CM_BRANDS.flatMap(([slug, name, prefix, colors, n], bi) =>
  Array.from({ length: n }, (_, i) => {
    const sku = `${prefix}${200 + bi * 40 + i * 3}`;
    const eye = 48 + ((bi + i) % 7);
    const bridge = 16 + ((bi * 2 + i) % 5);
    const temple = 135 + ((i % 3) * 5);
    const cols = colors.slice(0, 2 + ((bi + i) % (colors.length - 1)));
    return {
      sku, name: sku, brand: name, brand_slug: slug, medusaId: `prod_${sku}`,
      colors: cols.map((c) => ({ name: c, image: photo(c) })),
      attributes: {
        shape: SHAPES[(bi + i) % SHAPES.length], material: ["Acetato"], gender: i % 2 ? "Mujeres" : "Hombres", age: slug === "trendy" ? "Niños" : "Adulto",
        eye, bridge, temple,
        eye_size: `${eye}-${eye + 2} mm`, bridge_size: `${bridge}-${bridge + 1} mm`, temple_length: `${temple}-${temple + 5} mm`,
      },
    };
  })
);
const CM_CASES = ["CASEC-1", "CASEC-15", "CASESC-4", "DICAPRIOCASE", "GRANDECASE"].map((sku) => ({
  sku, name: sku.replace(/-/g, " "), medusaId: `prod_${sku}`, colors: [{ name: "Multi", image: photo("multi") }],
}));
const CM_HISTORY = [
  { date: "2026-10-28", added: ["DC203", "PT283"], removed: [] },
  { date: "2026-10-21", added: ["FX323"], removed: ["U366"] },
  { date: "2026-09-30", added: ["TY440"], removed: [] },
];
// Surtido de la tienda EN MEMORIA: al mover un interruptor el banco lo recuerda,
// así se puede ver el estado «oculta» y la precedencia modelo > marca.
const CM_RULES = new Map([["brand:trendy", false], ["product:prod_DC203", false]]);

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.origin);
  if (url.pathname === "/catalog.json") return json(CM_FRAMES);
  if (url.pathname === "/cases.json") return json(CM_CASES);
  if (url.pathname === "/catalog-meta.json") return json({ lastSync: "2026-10-28T06:00:00Z", added: [], removed: [] });
  if (url.pathname === "/catalog-history.json") return json(CM_HISTORY);
  if (!url.pathname.startsWith("/medusa/admin/")) return realFetch(input, init);
  const p = url.pathname.replace("/medusa", "");
  const g = (k) => url.searchParams.get(k) || "";
  await new Promise((r) => setTimeout(r, 120));
  if (p === "/admin/establishments") return json({ establishments: STORES });
  // Surtido por tienda (/admin/store-assortment/:id[/products|/rule]): lo que
  // lee y escribe el acordeón por marca de «Productos».
  if (p.startsWith("/admin/store-assortment/")) {
    if (p.endsWith("/rule")) {
      const body = JSON.parse(init?.body || "{}");
      const k = `${body.scope}:${body.target}`;
      if (body.exposed === null) CM_RULES.delete(k); else CM_RULES.set(k, body.exposed);
      return json({ ok: true });
    }
    const exposedOf = (f) => {
      const own = CM_RULES.get(`product:${f.medusaId}`);
      if (own !== undefined) return own;
      return CM_RULES.get(`brand:${f.brand_slug}`) !== false;
    };
    if (p.endsWith("/products")) {
      const brand = g("brand");
      return json({ products: CM_FRAMES.filter((f) => !brand || f.brand_slug === brand).map((f) => ({ id: f.medusaId, title: f.name, brand: f.brand_slug, is_case: false, thumbnail: f.colors[0].image, exposed: exposedOf(f) })) });
    }
    const brands = CM_BRANDS.map(([slug, name]) => {
      const list = CM_FRAMES.filter((f) => f.brand_slug === slug);
      return { slug, name, products: list.length, exposed_products: list.filter(exposedOf).length, rule: CM_RULES.has(`brand:${slug}`) ? CM_RULES.get(`brand:${slug}`) : null };
    });
    return json({
      establishment: STORES.find((x) => p.includes(x.id)) || STORES[1],
      brands,
      exceptions: [...CM_RULES.entries()].filter(([k]) => k.startsWith("product:")).map(([k, v]) => {
        const id = k.slice(8);
        const f = CM_FRAMES.find((x) => x.medusaId === id);
        return { product_id: id, title: f?.name || id, brand: f?.brand_slug || null, exposed: v };
      }),
      total_products: CM_FRAMES.length,
      exposed_products: CM_FRAMES.filter(exposedOf).length,
    });
  }
  // Monturas descontinuadas (status draft) que lista fetchDiscontinued().
  if (p === "/admin/products") {
    return json({ products: [
      { id: "prod_DC999", title: "DC999", handle: "dc999-di-caprio", thumbnail: photo("navy"), status: "draft" },
      { id: "prod_U701", title: "U701", handle: "u701-4u", thumbnail: photo("red"), status: "draft" },
    ] });
  }
  // Buscador global de la barra (OmniSearch.jsx): el contrato de
  // GET /admin/search?q=&limit= — grupos por tipo, los vacíos NO se mandan.
  if (p === "/admin/search") {
    const k = g("q").trim().toLowerCase();
    const limit = Number(g("limit")) || 6;
    const pool = [
      { kind: "sale", items: [
        { id: "s_1041", label: "Op2-000141 · Marilin García", sub: "El Rancho 39 · 28 oct · DAN", amount: 284.5, store_id: "est_02", extra: { order_id: "order_01J9X7" } },
        { id: "s_1038", label: "Op3-000118 · Ana Ruiz", sub: "El Rancho 41 · 24 oct · JOS", amount: 412, store_id: "est_03", extra: { order_id: "order_01J9W2" } },
      ] },
      { kind: "order", items: [
        { id: "order_01J9X7", label: "#1041 · En laboratorio", sub: "Marilin García · DiCaprio DC241 · progresivo", amount: 284.5, store_id: "est_02", extra: { order_id: "order_01J9X7" } },
      ] },
      { kind: "patient", items: [
        { id: "cus_7", label: "Ana Ruiz", sub: "3 pedidos · último 24 oct · El Rancho 41", extra: { phone: "(305) 555-0188" } },
        { id: "cus_9", label: "Daniel Ruiz Soto", sub: "1 pedido · 12 sep · Doral Plaza", extra: { phone: "(305) 555-0244" } },
      ] },
      { kind: "seller", items: [
        { id: "s1", label: "Daniela Ruiz", sub: "DAN · El Rancho 39 · comisión 6 %", extra: { code: "DAN" } },
      ] },
      { kind: "store", items: [
        { id: "est_03", label: "Op3 · El Rancho 41", sub: "Miami FL · familiar 40 %" },
      ] },
      { kind: "frame", items: [
        { id: "p1", label: "DiCaprio DC241", sub: "Black Gold · acetato · 52-18-140", amount: 90, extra: { sku: "DC241-BG" } },
        { id: "p2", label: "Flexure FL 118", sub: "Silver · titanio flexible", amount: 65, extra: { sku: "FL118-SV" } },
      ] },
    ];
    const hit = (it) => `${it.label} ${it.sub || ""} ${Object.values(it.extra || {}).join(" ")}`.toLowerCase().includes(k);
    const groups = pool
      .map((grp) => ({ kind: grp.kind, items: grp.items.filter(hit).slice(0, limit) }))
      .filter((grp) => grp.items.length);
    return json({ q: g("q"), groups });
  }
  // Panel de precios y costos: maestro (todas las tiendas) o la variación de una.
  // El payload imita CAMPO A CAMPO a `loadPricingOverview` (apps/backend/src/lib/
  // pricing-overview.ts): los diseños y materiales tal como salen de la tabla
  // (con `category` y `tier`, que es de donde la pantalla saca el tipo de
  // lente), la matriz en `base` con los precios en CENTAVOS, y los
  // tratamientos y costos con los nombres de campo del servidor. Va la lista
  // 2026 COMPLETA (13 diseños, 6 materiales) a propósito: la vista de lentes
  // está hecha justo para que esas 13 filas no obliguen a bajar.
  if (p === "/admin/pricing/overview") {
    const store = g("store");
    const perStore = store && store !== "all";
    const MATS = [
      ["cr39", "CR-39 (Resina)", "CR-39 (Resin)"],
      ["poly", "Policarbonato", "Polycarbonate"],
      ["1.56", "Índice 1.56", "Index 1.56"],
      ["1.61", "Índice 1.61", "Index 1.61"],
      ["1.67", "Índice 1.67", "Index 1.67"],
      ["1.74", "Índice 1.74", "Index 1.74"],
    ];
    // Progresivo con nombre: precio «desde» para CR-39/Poly/1.56/1.61 y el
    // escalón de la gama en 1.67 y 1.74 (igual que `progressive()` del backend).
    const prog = (from, hi) => [from, from, from, from, from + (hi ? 40 : 20), from + (hi ? 90 : 50)];
    const DESIGNS = [
      ["sv", "sv", "Visión Sencilla", "Single Vision", null, null, null, [60, 90, 100, 100, 120, 150]],
      ["bifocal", "bifocal", "Bifocal FT-28", "Bifocal FT-28", null, null, null, [130, 140, 140, 140, 160, 160]],
      ["prog-mid", "prog", "Progresivo Gama Media", "Progressive · Mid", null, null, null, [180, 180, 180, 180, 200, 230]],
      ["prog-high", "prog", "Progresivo Gama Alta", "Progressive · Premium", null, null, null, [240, 240, 240, 240, 280, 300]],
      ["purity-basic", "prog", "Purity Basic", "Purity Basic", "Básico", "Nuevos usuarios / uso diario", "New wearers / everyday use", prog(160, false)],
      ["purity-plus", "prog", "Purity Plus", "Purity Plus", "Intermedio", "Uso diario, más campo visual", "Everyday use, wider field", prog(180, false)],
      ["dvg-distinct", "prog", "DVG Distinct", "DVG Distinct", "Avanzado", "Uso general equilibrado", "Balanced general use", prog(240, true)],
      ["dvg-drive", "prog", "DVG Drive", "DVG Drive", "Avanzado", "Conducción frecuente", "Frequent driving", prog(250, true)],
      ["purity-office", "prog", "Purity Office", "Purity Office", "Premium", "Oficina y computadora", "Office and computer", prog(200, true)],
      ["dvg-cubicle", "prog", "DVG Cubicle", "DVG Cubicle", "Premium", "Oficina y computadora (campo cercano amplio)", "Office and computer (wide near field)", prog(210, true)],
      ["dvg-aqueous", "prog", "DVG Aqueous", "DVG Aqueous", "Premium superior", "Profesionales y ejecutivos", "Professionals and executives", prog(260, true)],
      ["dvg-maverick", "prog", "DVG Maverick (Pilot)", "DVG Maverick (Pilot)", "Premium superior", "Alto desempeño y viajeros", "High performance and travellers", prog(280, true)],
      ["dvg-camber", "prog", "DVG Camber", "DVG Camber", "Elite", "Máxima tecnología", "Top technology", prog(300, true)],
    ];
    const PHOTO = [
      ["photo-grey", "Fotocromático Grey", "Photochromic Grey", 85, 110, 90],
      ["photo-brown", "Fotocromático Brown", "Photochromic Brown", null, 110, 90],
      ["trans-s-grey", "Transitions Gen S Grey", "Transitions Gen S Grey", 105, 105, 105],
      ["trans-s-brown", "Transitions Gen S Brown", "Transitions Gen S Brown", 105, 105, 105],
      ["trans-s-green", "Transitions Gen S Graphite Green", "Transitions Gen S Graphite Green", 105, 105, 105],
      ["trans-x-grey", "Transitions XTRActive Grey", "Transitions XTRActive Grey", 130, 130, 130],
      ["trans-x-brown", "Transitions XTRActive Brown (RAM)", "Transitions XTRActive Brown (RAM)", 130, 130, 130],
    ];
    const AR = [
      ["ar-green-basic", "AR Green Básico", "AR Green Basic", "sv", 60],
      ["ar-green-plus", "AR Green Plus", "AR Green Plus", "sv", 90],
      ["ar-blue-protect", "AR Blue Protect", "AR Blue Protect", "sv", 90],
      ["adequate", "Adequate", "Adequate", "bifprog", 50],
      ["crystal", "Crystal", "Crystal", "bifprog", 80],
      ["flawless", "Flawless", "Flawless", "bifprog", 120],
      ["blue-uv-445", "Blue UV 445", "Blue UV 445", "bifprog", 120],
    ];
    const ADJUST = 5; // % de la tienda sobre el maestro
    // Una sola casilla con precio PROPIO de la tienda, para ver la pastilla
    // «con precio propio» y la celda resaltada.
    const OWN = { "base:sv:poly": 9500 };
    const cents = (usd) => (usd == null ? null : Math.round(usd * 100));
    const withStore = (master, key) => {
      if (!perStore || master == null) return null;
      if (OWN[key] != null) return OWN[key];
      return Math.round(master * (1 + ADJUST / 100));
    };
    const base = [];
    for (const [code, , , , , , , prices] of DESIGNS) {
      MATS.forEach((m, i) => {
        const c = cents(prices[i]);
        const key = `base:${code}:${m[0]}`;
        base.push({ design_code: code, material_code: m[0], cents: c, store_cents: withStore(c, key) });
      });
    }
    return json({
      store: perStore ? STORES.find((x) => x.id === store) || null : null,
      frames: {
        rule: { scope: "frame", mode: "percent", value: 35, since: "2026-09-01T00:00:00Z", inherited: false },
        case_rule: { scope: "case", mode: "percent", value: 20, since: "2026-09-01T00:00:00Z", inherited: perStore },
        overrides: [
          { product_id: "prod_DC206", variant_id: null, title: "DC241", brand: "DiCaprio", sku: "DC241-BG", kind: "frame", base: 66.67, price: 90, since: "2026-10-12T00:00:00Z", by: "Rubí", inherited: false },
          { product_id: "prod_FX286", variant_id: null, title: "FL 118", brand: "Flexure", sku: "FL118-SV", kind: "frame", base: 51.85, price: 65, since: "2026-10-20T00:00:00Z", by: "Rubí", inherited: perStore },
          { product_id: "prod_CASEC-1", variant_id: null, title: "Estuche rígido", brand: "Cases", sku: "CS-RIG", kind: "case", base: 8.33, price: 12, since: "2026-10-02T00:00:00Z", by: "Rubí", inherited: false },
        ],
        counts: { frames: CM_FRAMES.length, cases: CM_CASES.length },
      },
      lenses: {
        designs: DESIGNS.map(([code, category, label_es, label_en, tier, use_es, use_en], i) => ({
          code, category, label_es, label_en, tier, use_es, use_en, sort: i, requires_rx: true, requires_add: category !== "sv",
        })),
        materials: MATS.map(([code, label_es, label_en], i) => ({ code, label_es, label_en, sort: i })),
        base,
        photo: PHOTO.map(([code, label_es, label_en, sv, bifocal, prog_]) => {
          const perCat = { sv: cents(sv), bifocal: cents(bifocal), prog: cents(prog_) };
          const st = {};
          if (perStore) for (const c of ["sv", "bifocal", "prog"]) if (perCat[c] != null) st[c] = withStore(perCat[c], `photo:${code}:${c}`);
          return { code, label_es, label_en, colors: [], ...perCat, store: st };
        }),
        ar: AR.map(([code, label_es, label_en, ar_group, price]) => ({
          code, label_es, label_en, ar_group, cents: cents(price), store_cents: withStore(cents(price), `ar:${code}`),
        })),
        store: perStore ? { adjust_pct: ADJUST, cells: [{ kind: "base", key: "sv:poly", value: OWN["base:sv:poly"] }] } : null,
      },
      commissions: {
        default_pct: 5,
        sellers: [
          { id: "s1", code: "DAN", name: "Daniela Ruiz", pct: 6, active: true },
          { id: "s2", code: "JOS", name: "José Pérez", pct: 5, active: true },
          { id: "s3", code: "MAR", name: "María Soto", pct: 4, active: false },
        ],
      },
      costs: {
        rules: [
          { id: "r1", kind: "frame_brand", match_key: "dicaprio", label: "Montura DiCaprio", value: 24, unit: "usd", enabled: true, group: "frames" },
          { id: "r5", kind: "frame_sku", match_key: "FL118-SV", label: "Flexure FL 118", value: 19, unit: "usd", enabled: true, group: "frames" },
          { id: "r2", kind: "lens_design", match_key: "prog-high", label: "Lente progresivo gama alta", value: 101, unit: "usd", enabled: true, group: "lenses" },
          { id: "r6", kind: "lens_material", match_key: "1.67", label: "Índice 1.67", value: 34, unit: "usd", enabled: true, group: "lenses" },
          { id: "r4", kind: "order_fixed", match_key: "empaque", label: "Empaque", value: 2.5, unit: "usd", enabled: true, group: "order" },
          { id: "r3", kind: "order_percent", match_key: "laboratorio", label: "Laboratorio", value: 8, unit: "percent", enabled: !perStore, group: "percent" },
        ],
        fixed: [
          { id: "f1", description: "Renta del local", category: "rent", amount: 213, frequency: "monthly", shared: false, enabled: true },
          { id: "f2", description: "Sueldos", category: "payroll", amount: 484, frequency: "monthly", shared: false, enabled: true },
          { id: "f3", description: "Internet y teléfono", category: "utilities", amount: 60, frequency: "monthly", shared: true, enabled: !perStore },
        ],
        variable: [{ id: "v1", description: "Mensajería", category: "shipping", amount: 30, frequency: "monthly", shared: false, enabled: true }],
        taxes: { rate_pct: 8.25, source: "database" },
        profit_target_pct: 30,
      },
    });
  }
  if (p === "/admin/pos/context") return json({ role: ROLE, is_admin: IS_ADMIN, stores: IS_ADMIN ? STORES : STORES.slice(1, 2), assigned: { establishment_id: "est_02" }, privileges: ROLE_PRIVS[ROLE] || [], payment_methods: [{ code: "cash", builtin: true }, { code: "debit", builtin: true }, { code: "credit", builtin: true }] });
  if (p === "/admin/sales-analytics/summary") { const f = figures(g("from"), g("to"), g("stores")); return json({ current: { discount: Math.round(f.sales * 0.03) }, previous: { discount: 100 }, balance_due: 1240.5, insurance_due: 380 }); }
  if (p === "/admin/sales-analytics/me") { const f = figures("2026-10-01", "2026-10-31", ""); return json({ today: { total: 820, count: 4, avg_ticket: 205 }, week: { total: 3900, count: 19, avg_ticket: 205 }, month: f, seller_code: "DAN", workplace: { store: STORES[1], terminal: { code: "T1", name: "Mostrador" }, cash_open: true }, commission: { pct: 5, amount: 412 }, goal: { amount: 12000, done: f.sales, left: Math.max(0, 12000 - f.sales) }, balance_due: 310, recent: [], ready: [] }); }
  if (p === "/admin/audit") { const mk = (i, action) => ({ id: `ev${i}`, actor_user_id: "u1", establishment_id: i % 2 ? "est_02" : null, action, entity: "seller", entity_id: null, before: { pct: 5 }, after: { pct: 6 }, created_at: new Date(Date.now() - i * 36e5 * 7).toISOString() }); return json({ events: [mk(1, "seller.update"), mk(2, "seller.update"), mk(3, "price.update"), mk(40, "price.update")], actions: ["seller.update", "price.update"] }); }
  if (p === "/admin/team") return json({ team: [{ id: "u1", email: "dueno@optica.com", first_name: "Rubí", last_name: "Dacosta" }] });
  if (p === "/admin/sellers") return json({ sellers: [{ id: "s1", code: "DAN", name: "Daniela Ruiz", email: "dan@optica.com", commission_pct: 5, active: true, establishment_id: "est_02", terminal_id: "t1", referral_url: "https://rubilens.com/?ref=DAN", dashboard_url: "https://rubilens.com/vendedor?t=x", social: {} }, { id: "s2", code: "JOS", name: "José Pérez", commission_pct: 5, active: true, establishment_id: "est_03", terminal_id: "t2", referral_url: "https://rubilens.com/?ref=JOS", dashboard_url: "https://rubilens.com/vendedor?t=y", social: {} }] });
  if (p === "/admin/pos/terminals") return json({ terminals: [{ id: "t1", code: "T1", establishment_id: "est_02", is_active: true }, { id: "t2", code: "T1", establishment_id: "est_03", is_active: true }] });
  if (p === "/admin/store-costs/pnl") return json({ stores: STORES.slice(1, 3).map((s, i) => ({ establishment_id: s.id, code: s.code, kind: "own", net_sales: 12000 - i * 3000, cogs: 4000, payment_fees: 250, commissions: 600, variable_manual: 300, contribution: 6850, fixed: 3200, shared: 400, result: 3250, contribution_pct: 57, break_even: 6300 })), total: { net_sales: 21000, cogs: 8000, payment_fees: 500, commissions: 1200, variable_manual: 600, contribution: 10700, fixed: 6400, shared: 800, result: 3500, contribution_pct: 51, break_even: 12600 }, sellers: [{ seller_code: "DAN", net_sales: 9000, pct: 5, commission: 450 }], cost_rules_missing: false });
  // Estado de cuenta: el servidor manda `business` con los valores por defecto
  // del backend (RUBI LENS) — el documento debe enseñar la óptica, no eso.
  if (p === "/admin/pos/statement") {
    const id = g("establishment_id");
    const all = id === "all";
    const store = STORES.find((x) => x.id === id) || STORES[1];
    const from = g("from") || "2026-10-01";
    const to = g("to") || "2026-10-31";
    const mkSale = (i) => {
      const total = 18000 + i * 4300;
      const paid = i % 3 === 0 ? Math.round(total / 2) : total;
      return {
        id: `s${i}`, number: `${store.code}-0001${10 + i}`, store_code: all ? STORES[1 + (i % 3)].code : store.code,
        date: `${from}T1${i}:05:00Z`, day: `${from.slice(0, 8)}${String(3 + i).padStart(2, "0")}`,
        seller_code: i % 2 ? "DAN" : "JOS", customer_name: ["Marilin García", "Ana Ruiz", "Luis Soto", null][i % 4],
        delivery: i === 2 ? "ship" : "pickup", status: i === 4 ? "voided" : "completed",
        items: [{ title: "DC241", brand: "DiCaprio", variant: "Black Gold", kind: "frame", qty: 1, frame_cents: 9000, lens_cents: 9000, list_cents: total, lens: { design: "prog-mid", material: "poly", photo: null, ar: "ar-green" } }],
        list_cents: total, discount_cents: i % 2 ? 1500 : 0, tax_cents: 0, total_cents: total, paid_cents: paid, insurance_cents: i === 1 ? 4000 : 0, balance_cents: total - paid,
        payments: [{ method_code: i % 2 ? "cash" : "credit", method: null, kind: "deposit", amount_cents: paid, reference: null, at: `${from}T1${i}:10:00Z` }],
      };
    };
    const sales = [0, 1, 2, 3, 4, 5].map(mkSale);
    const live = sales.filter((x) => x.status !== "voided");
    const sum = (k) => live.reduce((a, x) => a + x[k], 0);
    const by = (key) => [...live.reduce((map, x) => map.set(x[key], (map.get(x[key]) || 0) + x.total_cents), new Map())].map(([k, v]) => [k, v]);
    return json({
      number: `EST-${all ? "ALL" : store.code}-${from.slice(0, 4)}${from.slice(5, 7)}`,
      store: all ? { code: "ALL", name: "RUBI LENS", address: null, phone: null, kind: "all", settlement_pct: null, receipt_note: null }
        : { code: store.code, name: store.name, address: "3920 W Flagler St, Miami FL", phone: "(305) 555-0139", kind: store.id === "est_03" ? "family" : "own", settlement_pct: store.id === "est_03" ? 40 : null, receipt_note: "Garantía de 30 días en monturas." },
      business: { name: "RUBI LENS", legal_name: "RUBI LENS LLC", address: "8300 NW 53rd St, Doral FL", url: "https://www.rubilens.com" },
      period: { from, to },
      generated_at: new Date().toISOString(),
      sales,
      totals: {
        count: live.length, voided_count: sales.length - live.length,
        list_cents: sum("list_cents"), discount_cents: sum("discount_cents"), tax_cents: 0, total_cents: sum("total_cents"),
        paid_cents: sum("paid_cents"), insurance_cents: sum("insurance_cents"), balance_cents: sum("balance_cents"),
        by_method: [{ code: "cash", label: null, cents: Math.round(sum("paid_cents") * 0.4) }, { code: "credit", label: null, cents: sum("paid_cents") - Math.round(sum("paid_cents") * 0.4) }],
        by_seller: by("seller_code").map(([k, v]) => ({ seller_code: k, count: live.filter((x) => x.seller_code === k).length, total_cents: v })),
        by_day: by("day").map(([k, v]) => ({ date: k, count: live.filter((x) => x.day === k).length, total_cents: v })),
      },
      settlement: !all && store.id === "est_03" ? { pct: 40, base_cents: sum("total_cents"), amount_cents: Math.round(sum("total_cents") * 0.4) } : null,
      truncated: false,
    });
  }
  if (p === "/admin/store-costs") return json({ items: [{ id: "c1", establishment_id: "est_02", kind: "fixed", category: "rent", description: "Local", amount: 2400, frequency: "monthly", starts_on: "2026-01-01" }] });
  if (p === "/admin/sales-analytics/insights") {
    const f = figures(g("from"), g("to"), g("stores"));
    const rows = [["DAN", "Daniela Ruiz", 0.46], ["JOS", "José Pérez", 0.34], [null, null, 0.2]].map(([key, label, sh]) => ({ key, label, sales: Math.round(f.sales * sh * 100) / 100, count: Math.round(f.count * sh), units: Math.round(f.units * sh), profit: Math.round(f.profit * sh * 100) / 100, commission: Math.round(f.commission * sh * 100) / 100, margin_pct: f.margin_pct, share: sh * 100 }));
    const rr = rows.map((r) => ({ ...r, profit: ACCESS.profit ? r.profit : 0, margin_pct: ACCESS.profit ? r.margin_pct : null, commission: ACCESS.commission ? r.commission : 0 }));
    return json({ totals: redactTotals(f), previous: redactTotals(f), rows: rr, access: ACCESS, series: [], compare: [] });
  }
  if (p === "/admin/sales-analytics/sales") {
    const f = figures(g("from"), g("to"), g("stores"));
    const n = Math.min(f.count, 12);
    const sales = Array.from({ length: n }, (_, i) => {
      const total = Math.round((f.sales / f.count) * (0.6 + ((i * 37) % 10) / 12) * 100) / 100;
      const paid = i % 4 === 0 ? Math.round(total * 0.5 * 100) / 100 : total;
      return {
        order_id: `order_${i}`, sale_id: `sale_${i}`, number: `R39-0001${10 + i}`, channel: "pos",
        establishment_id: "est_02", seller_code: i % 2 ? "DAN" : "JOS",
        customer: ["Marilin García", "Ana Ruiz", "Luis Soto"][i % 3], customer_phone: "(305) 555-0100",
        sold_at: `${g("from") || "2026-10-01"}T${String(8 + i).padStart(2, "0")}:${String(10 + i).padStart(2, "0")}:00Z`,
        units: 2, total, discount: i % 3 === 1 ? 15 : 0, net: total / 1.07,
        cost: Math.round(total * 0.4 * 100) / 100, fee: Math.round(total * 0.02 * 100) / 100,
        commission: Math.round(total * 0.05 * 100) / 100, profit: Math.round(total * 0.45 * 100) / 100,
        margin_pct: 45, missing_cost: i === 3, paid, balance: Math.round((total - paid) * 100) / 100,
        status: i === 7 ? "voided" : "completed", items: "Di Caprio DC241 · lentes",
        frame_brand: "Di Caprio", frame_model: "DC241", frame_color: "Black Gold", frame_sku: "DC241",
        has_rx: i % 3 !== 0, own_frame: i === 5,
        lens_summary: { es: "Monofocal · CR-39 · AR Premium", en: "Single vision · CR-39 · Premium AR" },
      };
    });
    return json({ sales: sales.map(redactSale), access: ACCESS, has_more: false });
  }
  if (p === "/admin/pos/cash-report") {
    const f = figures(g("from"), g("to"), g("establishment_id"));
    const c = Math.round(f.sales * 100);
    return json({ totals: { payments_cents: c, cash_net_cents: Math.round(c * 0.31), movements_in_cents: 20000, movements_out_cents: 45000 }, by_method: [{ code: "cash", builtin: true, kind: "cash", counts_as_cash: true, in_count: 20, in_cents: Math.round(c * 0.33), refund_cents: 0, fee_cents: 0, net_cents: Math.round(c * 0.33) }, { code: "credit", builtin: true, kind: "card", in_count: 30, in_cents: Math.round(c * 0.5), refund_cents: 2000, fee_cents: 4000, net_cents: Math.round(c * 0.5) - 6000 }, { code: "zelle", builtin: true, kind: "transfer", in_count: 6, in_cents: Math.round(c * 0.17), refund_cents: 0, fee_cents: 0, net_cents: Math.round(c * 0.17) }], movements: [] });
  }
  // Mapa de inicio: lo que hay VIVO ahora mismo. Lo leen WelcomeBriefing.jsx y
  // la franja de pendientes del Ejecutivo (BacklogStrip.jsx), que es
  // independiente del período. Con ?backlog=clear sale todo en cero (la franja
  // se reduce a su línea tranquila) y con ?backlog=fail la lectura falla.
  if (p === "/admin/pos/start-map") {
    if (Q.get("backlog") === "fail") return new Response("boom", { status: 500 });
    const clear = Q.get("backlog") === "clear";
    const per = (from, to, sales, count) => ({ from, to, sales_cents: Math.round(sales * 100), count, units: count * 2, ...(ACCESS.profit ? { cost_cents: Math.round(sales * 42), fee_cents: Math.round(sales * 2), profit_cents: Math.round(sales * 45) } : { cost_cents: null, fee_cents: null, profit_cents: null }), commission_cents: ACCESS.commission ? Math.round(sales * 5) : null, avg_ticket_cents: count ? Math.round((sales / count) * 100) : 0, avg_profit_per_sale_cents: null, prev: null });
    const bucket = (count, cents, balance) => ({ count, cents: Math.round(cents * 100), balance_cents: Math.round(balance * 100) });
    return json({
      today: "2026-11-01",
      periods: {
        // El día 1 del mes: hoy casi en cero y ayer con las ventas de verdad.
        today: per("2026-11-01", "2026-11-01", clear ? 0 : 310.5, clear ? 0 : 2),
        yesterday: per("2026-10-31", "2026-10-31", 1840.75, 9),
        this_week: per("2026-10-26", "2026-11-01", 2151.25, 11),
        last_week: per("2026-10-19", "2026-10-25", 4920.4, 24),
        this_month: per("2026-11-01", "2026-11-01", clear ? 0 : 310.5, clear ? 0 : 2),
        last_month: per("2026-10-01", "2026-10-31", 21480.9, 104),
      },
      pending: clear
        ? { in_lab: bucket(0, 0, 0), to_deliver: bucket(0, 0, 0), on_street: { count: 0, cents: 0 }, overdue_balances: { count: 0, cents: 0 }, approvals: 0, open_tills: 0 }
        : {
            in_lab: bucket(23, 7420.5, 3180),
            to_deliver: bucket(8, 2360, 940.25),
            on_street: { count: 31, cents: 486075 },
            overdue_balances: { count: 6, cents: 128040 },
            approvals: 2,
            open_tills: 1,
          },
      stores: STORES.slice(1, 4).map((s, i) => ({ id: s.id, code: s.code, name: s.name, color: s.color, today_cents: i ? 0 : 31050, week_cents: 90000 - i * 20000, month_cents: 31050, on_street_cents: 180000 - i * 40000, in_lab: 9 - i * 3, to_deliver: 3 - i })),
      me: { role: ROLE, seller_code: ROLE === "seller" ? "DAN" : null, store_code: null, store_name: null, store_color: null, commission_month_cents: null },
      subject: null,
      access: ACCESS,
      truncated: false,
      pending_truncated: false,
    });
  }
  if (p === "/admin/order-board") {
    const STG = ["confirmed", "in_lab", "shipped", "in_transit", "delivered"];
    const orders = Array.from({ length: 12 }, (_, i) => ({
      id: `order_${i}`, stage: STG[(i * 2 + i % 3) % 5],
      next_stages: STG.slice(Math.min(4, ((i * 2 + i % 3) % 5) + 1)),
      terminal: i === 7 ? "canceled" : null, history: [], pos_delivered_at: null,
    }));
    return json({ orders, total: orders.length, truncated: false, scan_limit: 300 });
  }
  if (p === "/admin/sellers/stats") return json({ sellers: [{ id: "s1", code: "DAN", name: "Daniela Ruiz", orders: 23, revenue: 8420, commission_pct: 5, commission: 421, share_pct: 61, last_order_at: "2026-10-30T10:00:00Z", by_source: [] }, { id: "s2", code: "JOS", name: "José Pérez", orders: 14, revenue: 5300, commission_pct: 5, commission: 265, share_pct: 39, last_order_at: "2026-10-29T10:00:00Z", by_source: [] }], unattributed: { orders: 3, revenue: 600 }, sources: [] });
  return json({});
};

const OWNER = { id: "u1", role: "owner", is_admin: true, display_name: "Rubí Dacosta", privileges: [] };
const MANAGER = { id: "u2", role: "manager", is_admin: false, display_name: "Daniela Ruiz", privileges: ["costs.view"], store_ids: ["est_02"] };
const SELLER = { id: "u3", role: "seller", is_admin: false, display_name: "Daniela Ruiz", privileges: [], seller_code: "DAN", store_ids: ["est_02"] };
const me = ROLE === "owner" ? OWNER : ROLE === "seller" ? SELLER : MANAGER;
const SCREENS = { pricing: (go) => <PricingPanel me={me} go={go} sellers={[]} />, exec: (go) => <ExecutiveHub me={me} go={go} />, salesboard: (go) => <SalesBoard me={me} go={go} tabs={["costs"]} />, audit: () => <AuditLog me={me} />, sellers: (go, params) => <Sellers me={me} go={go} params={params} />, storecosts: () => <StoreCosts me={me} />, statement: (go) => <StoreStatement me={me} go={go} />, stores: () => <Stores />, mysales: (go) => <MySales me={me} go={go} />,
  // «Productos» del grupo Comercial: el acordeón por marca con el catálogo
  // simulado de arriba (CM_FRAMES/CM_CASES). `loadLive` lo mete en el store del
  // catálogo, que en el banco no lo carga nadie al arrancar.
  products: (go, params) => <CatalogScreen params={params} />,
  // Estado «el período elegido no tiene nada»: las tres variantes juntas para
  // revisarlas de un vistazo en claro y en oscuro (ver harness/README).
  empty: () => (
    <div className="adm-section" style={{ display: "grid", gap: 16 }}>
      <EmptyPeriod kind="sales" />
      <EmptyPeriod kind="cash" />
      <EmptyPeriod kind="orders" />
      <EmptyPeriod kind="cash" compact />
    </div>
  ) };

function CatalogScreen({ params = null }) {
  useEffect(() => { loadLive({ force: true }).catch(() => {}); }, []);
  return <CatalogManager me={me} params={params} />;
}

function App() {
  const [tab, setTab] = useState(TAB0);
  // Los parámetros del salto se guardan y se pasan a la pantalla, como hace
  // AdminDashboard: sin esto no se puede probar que el buscador global abre
  // el catálogo por un modelo o la ficha de un vendedor.
  const [navParams, setNavParams] = useState(() => Object.fromEntries(new URLSearchParams(location.search)));
  const go = (t, params) => { setTab(t); setNavParams(params || {}); console.log("go", t, params); };
  return (
    <MemoryRouter>
      <AdminShell tab={tab} onTab={setTab} user="dueno@optica.com" onLogout={() => {}} find={null} me={me} groups={navGroupsFor(me)}>
        {SCREENS[tab] ? SCREENS[tab](go, navParams) : (
          <div className="adm-section"><h2>{tab}</h2><p className="adm-sub">Pestaña «{tab}»: aquí el cromo sigue la política de color (operativa = color de la tienda; informativa = neutro).</p></div>
        )}
      </AdminShell>
    </MemoryRouter>
  );
}
document.body.style.background = MODE === "dark" ? "#0f1218" : "#f3f4f6";
createRoot(document.getElementById("root")).render(<LanguageProvider><FeedbackProvider><App /></FeedbackProvider></LanguageProvider>);
