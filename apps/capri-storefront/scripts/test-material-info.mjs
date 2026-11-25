// «Elegir material del cristal» en la web: lo que el código sabe de un material
// (src/data/materialInfo.js) y las etiquetas que se derivan de la lista ofrecida.
// Run: node scripts/test-material-info.mjs
import assert from "node:assert/strict";
import { indexLabel, isFlatTop28, materialKind, materialTags, refractiveIndex } from "../src/data/materialInfo.js";

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };
const mats = (...ids) => ids.map((id) => ({ id }));
const prices = (table) => (id) => table[id];

check("refractive index: named materials and numeric codes", () => {
  assert.equal(refractiveIndex("cr39"), 1.5);
  assert.equal(refractiveIndex("poly"), 1.59);
  assert.equal(refractiveIndex("1.67"), 1.67);
  assert.equal(refractiveIndex("trivex-x"), null);
  assert.equal(indexLabel("cr39"), "1.50");
  assert.equal(indexLabel("1.74"), "1.74");
  assert.equal(indexLabel("glass"), null);
});

check("family of each material; an unknown code reads as standard resin", () => {
  assert.deepEqual(["cr39", "poly", "1.56", "1.61", "1.67", "1.74", "glass"].map(materialKind), ["cr39", "poly", "mid", "mid", "high", "ultra", "cr39"]);
});

check("tags of the live list: cheapest, toughest, thinnest", () => {
  assert.deepEqual(materialTags(mats("cr39", "poly", "1.67"), prices({ cr39: 30, poly: 37, "1.67": 61 })), { cr39: "cheapest", poly: "tough", "1.67": "thinnest" });
});

check("only the highest index is «thinnest»; the others are «thin»", () => {
  const tags = materialTags(mats("cr39", "poly", "1.56", "1.61", "1.67", "1.74"), prices({ cr39: 60, poly: 90, "1.56": 100, "1.61": 100, "1.67": 120, "1.74": 150 }));
  assert.deepEqual(tags, { cr39: "cheapest", poly: "tough", "1.56": "thin", "1.61": "thin", "1.67": "thin", "1.74": "thinnest" });
});

check("«cheapest» is never claimed when the prices do not say so", () => {
  // Two materials tie at the lowest price: neither is THE cheapest.
  assert.deepEqual(materialTags(mats("cr39", "poly", "1.67"), prices({ cr39: 40, poly: 40, "1.67": 61 })), { cr39: "clear", poly: "tough", "1.67": "thinnest" });
  // Polycarbonate is the cheapest: it says so, and resin does not.
  assert.deepEqual(materialTags(mats("cr39", "poly"), prices({ cr39: 50, poly: 45 })), { cr39: "clear", poly: "cheapest" });
});

check("a list without thin materials has no «thinnest»", () => {
  assert.deepEqual(materialTags(mats("cr39", "poly"), prices({ cr39: 30, poly: 37 })), { cr39: "cheapest", poly: "tough" });
});

check("FT-28: the shop's bifocal, or any design that names it", () => {
  assert.equal(isFlatTop28({ id: "bifocal", label: { es: "Bifocal FT-28" } }), true);
  assert.equal(isFlatTop28({ id: "bif-x", label: { es: "Bifocal Flat Top 28", en: "" } }), true);
  assert.equal(isFlatTop28({ id: "bif-round", label: { es: "Bifocal redondo", en: "Round bifocal" } }), false);
  assert.equal(isFlatTop28(null), false);
});

console.log(`\n${n} checks passed`);
