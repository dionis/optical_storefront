import { readFileSync } from "node:fs";
import pg from "pg";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13);
const c = new pg.Client({ connectionString: url, ssl:{rejectUnauthorized:false} });
await c.connect();
await c.query(`DELETE FROM frame_media_asset WHERE id LIKE 'probe_%'`);
await c.query(`INSERT INTO frame_media_asset
  (id, product_handle, variant_sku, colorway, kind, slot, status, created_at, updated_at)
  VALUES ('probe_1','__probe__','PROBE-1','Black','view','front','running',NOW(),NOW())`);
console.log("fila de prueba creada: probe_1");
await c.end();
