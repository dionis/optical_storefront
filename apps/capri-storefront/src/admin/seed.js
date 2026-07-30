// Demo seed data for the admin dashboard, so charts are populated from day 1.
// Clearly labelled as demo; the owner can clear it from the panel once real data flows.
// Data model matches analytics.js: daily funnel buckets + individual order records.
import { PRODUCTS } from "../data/products.js";
import { CASES } from "../data/cases.js";

// small deterministic PRNG so the demo looks stable across reloads within a day
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ymd = (d) => d.toISOString().slice(0, 10);
const NAMES = [["María", "González"], ["Juan", "Pérez"], ["Ana", "Rodríguez"], ["Luis", "Martínez"], ["Carla", "Sánchez"], ["Pedro", "Ramírez"], ["Sofía", "Torres"], ["Diego", "Flores"], ["Elena", "Díaz"], ["Jorge", "Cruz"], ["Rosa", "Morales"], ["Iván", "Reyes"]];
const CITIES = [["Katy, TX", "Fry Rd", "us", "USPS/UPS"], ["Houston, TX", "Main St", "us", "USPS/UPS"], ["Miami, FL", "Ocean Dr", "us-exp", "FedEx"], ["La Habana", "Calle 23", "cuba", "Consignataria"], ["CDMX", "Reforma", "mx", "DHL"], ["Bogotá", "Cra 7", "latam", "DHL/FedEx"]];

export function generateDemo(days = 90) {
  const rnd = mulberry32(20260722);
  const frames = PRODUCTS.slice(0, 120);
  const cases = CASES.slice(0, 20);
  const daily = {};
  const orders = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dow = d.getDay(); // 0 sun .. 6 sat
    const weekend = dow === 0 || dow === 6 ? 1.35 : 1;
    const trend = 1 + (days - i) / days * 0.6; // gentle growth over time
    const access = Math.round((10 + rnd() * 16) * weekend * trend);
    const view = Math.round(access * (3.2 + rnd() * 1.8));
    const atc = Math.round(view * (0.09 + rnd() * 0.06));
    const fav = Math.round(view * (0.05 + rnd() * 0.05));
    const key = ymd(d);
    daily[key] = { access, view, atc, fav };

    // orders: ~35% of add-to-cart convert
    const nOrders = Math.round(atc * (0.28 + rnd() * 0.16));
    for (let o = 0; o < nOrders; o++) {
      const t = new Date(d);
      t.setHours(8 + Math.floor(rnd() * 12), Math.floor(rnd() * 60), 0, 0);
      const items = [];
      const nItems = 1 + (rnd() < 0.35 ? 1 : 0) + (rnd() < 0.12 ? 1 : 0);
      for (let k = 0; k < nItems; k++) {
        if (k === 0 || rnd() < 0.7) {
          const f = frames[Math.floor(rnd() * frames.length)];
          if (f) items.push({ sku: f.sku, name: f.name, brand: f.brand, kind: "frame", total: f.price });
          // sometimes add lens to the frame
          if (rnd() < 0.45) items.push({ sku: "LENS", name: "Lentes graduados", brand: "Lentes", kind: "lens", total: 6.95 + Math.floor(rnd() * 5) * 8 });
        } else {
          const c = cases[Math.floor(rnd() * cases.length)];
          if (c) items.push({ sku: c.sku, name: c.name, brand: "Cases", kind: "case", total: c.price });
        }
      }
      const subtotal = items.reduce((s, it) => s + it.total, 0);
      const isShip = rnd() < 0.6;
      const shipCost = !isShip ? 0 : (subtotal >= 59 ? 0 : 6.95);
      const nm = NAMES[Math.floor(rnd() * NAMES.length)];
      const cust = { name: nm[0], surname: nm[1], email: (nm[0] + "." + nm[1]).toLowerCase() + "@correo.com", phone: "+1 281 555 0" + (100 + Math.floor(rnd() * 899)) };
      // status by age: old orders delivered; recent ones spread across the flow
      // (claves del modelo compartido orderStatus.js: recibida→fabricación→…→entregada)
      const status = i > 9 ? "delivered" : (["received", "manufacturing", "shipped", "in_transit", "delivered"])[Math.floor(rnd() * 5)];
      const city = CITIES[Math.floor(rnd() * CITIES.length)];
      orders.push({
        id: "OER-" + key.replace(/-/g, "") + "-" + (o + 1),
        t: t.toISOString(),
        items,
        itemsCount: items.length,
        total: Math.round((subtotal + shipCost) * 100) / 100,
        user: cust.email,
        customer: cust,
        shipping: { method: isShip ? "ship" : "pickup", cost: shipCost },
        delivery: isShip ? { recipient: nm[0] + " " + nm[1], phone: cust.phone, email: cust.email, address: (100 + Math.floor(rnd() * 8900)) + " " + city[1], city: city[0], zone: city[2], carrier: city[3] } : null,
        status,
        demo: true,
      });
    }
  }
  return { daily, orders };
}
