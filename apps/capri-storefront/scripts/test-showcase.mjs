// «Vitrina de la tienda web»: el orden que ve el cliente (src/data/showcase.js).
// La validación del lado del servidor está en backend tests/web-showcase.test.ts.
// Run: node scripts/test-showcase.mjs
import assert from "node:assert/strict";
import { normalizeShowcase, showcaseOrder } from "../src/data/showcase.js";

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

// Catálogo como llega de la base: Di Caprio primero.
const P = (brand, i) => ({ slug: `${brand}-${i}`, brand_slug: brand });
const CATALOG = [
  ...[1, 2, 3, 4].map((i) => P("di-caprio", i)),
  ...[1, 2].map((i) => P("flexure", i)),
  ...[1, 2, 3].map((i) => P("trendy", i)),
  P("peachtree", 1),
];
const slugs = (l) => l.map((p) => p.slug);
const sameSet = (a, b) => assert.deepEqual([...slugs(a)].sort(), [...slugs(b)].sort());

check("catalog mode keeps the catalogue order", () => {
  assert.deepEqual(slugs(showcaseOrder(CATALOG, { mode: "catalog", brands: [] })), slugs(CATALOG));
  assert.deepEqual(slugs(showcaseOrder(CATALOG, null)), slugs(CATALOG));
});

check("one chosen brand goes first, the rest keeps its order", () => {
  assert.deepEqual(slugs(showcaseOrder(CATALOG, { mode: "brands", brands: ["trendy"] })), [
    "trendy-1", "trendy-2", "trendy-3", "di-caprio-1", "di-caprio-2", "di-caprio-3", "di-caprio-4", "flexure-1", "flexure-2", "peachtree-1",
  ]);
});

check("several chosen brands take turns, in the owner's order", () => {
  assert.deepEqual(slugs(showcaseOrder(CATALOG, { mode: "brands", brands: ["flexure", "trendy"] })).slice(0, 5), [
    "flexure-1", "trendy-1", "flexure-2", "trendy-2", "trendy-3",
  ]);
});

check("a chosen brand with no models is ignored", () => {
  assert.deepEqual(slugs(showcaseOrder(CATALOG, { mode: "brands", brands: ["gone"] })), slugs(CATALOG));
});

check("random mixes every brand: the first round has one of each", () => {
  const out = showcaseOrder(CATALOG, { mode: "random", brands: [] }, 42);
  sameSet(out, CATALOG);
  assert.deepEqual([...new Set(out.slice(0, 4).map((p) => p.brand_slug))].length, 4);
});

check("random is the same for the same visit and changes between visits", () => {
  const a = slugs(showcaseOrder(CATALOG, { mode: "random", brands: [] }, 7));
  assert.deepEqual(slugs(showcaseOrder(CATALOG, { mode: "random", brands: [] }, 7)), a);
  const others = [1, 2, 3, 4, 5, 6, 8, 9].map((s) => slugs(showcaseOrder(CATALOG, { mode: "random", brands: [] }, s)).join());
  assert.ok(others.some((o) => o !== a.join()), "different seeds should give a different mix");
});

check("random among chosen brands only puts those first", () => {
  const out = showcaseOrder(CATALOG, { mode: "random", brands: ["flexure", "peachtree"] }, 3);
  sameSet(out, CATALOG);
  assert.deepEqual([...new Set(out.slice(0, 3).map((p) => p.brand_slug))].sort(), ["flexure", "peachtree"]);
  assert.deepEqual(slugs(out.slice(3)), slugs(CATALOG.filter((p) => !["flexure", "peachtree"].includes(p.brand_slug))));
});

check("never adds or drops a frame", () => {
  for (const s of [{ mode: "brands", brands: ["trendy", "di-caprio"] }, { mode: "random", brands: [] }, { mode: "random", brands: ["trendy"] }]) {
    const out = showcaseOrder(CATALOG, s, 11);
    assert.equal(out.length, CATALOG.length);
    sameSet(out, CATALOG);
  }
});

check("an unreadable showcase is the catalogue order", () => {
  assert.deepEqual(normalizeShowcase({ mode: "weird" }), { mode: "catalog", brands: [] });
  assert.deepEqual(normalizeShowcase({ mode: "brands", brands: [] }), { mode: "catalog", brands: [] });
  assert.deepEqual(normalizeShowcase({ mode: "random", brands: ["a", "a", 3] }), { mode: "random", brands: ["a"] });
});

console.log(`\n${n} checks passed`);
