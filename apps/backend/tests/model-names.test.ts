import { readdirSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";

/**
 * A custom model must not reuse the name of one of Medusa's own. The store
 * pricing module once defined `price_rule`: entity `PriceRule`, table
 * `price_rule` — both already Medusa Pricing's. The migration's
 * `CREATE TABLE IF NOT EXISTS` silently skipped (the table was Medusa's), its
 * index on `valid_to` failed, and the backend then died at boot with
 * "Price.price_rules has unknown 'mappedBy' reference: PriceRule.price"
 * because our entity replaced Medusa's in the ORM metadata. Nothing in the
 * build or typecheck notices; only a deploy against a real database does.
 */

const MODULES_DIR = join(__dirname, "..", "src", "modules");

const pascal = (snake: string) => snake.replace(/(^|_)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Every `model.define("table", …)` under src/modules. */
function ourTables(): { table: string; file: string }[] {
  const out: { table: string; file: string }[] = [];
  for (const mod of readdirSync(MODULES_DIR)) {
    const dir = join(MODULES_DIR, mod, "models");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/model\.define\(\s*"(\w+)"/g)) out.push({ table: m[1], file: `${mod}/models/${f}` });
    }
  }
  return out;
}

/** Entity and table names of every model shipped by Medusa's core modules. */
function medusaModels(): { entities: Set<string>; tables: Set<string> } {
  const entities = new Set<string>();
  const tables = new Set<string>();
  const medusaDir = dirname(require.resolve("@medusajs/medusa/package.json"));
  const deps = Object.keys(require(join(medusaDir, "package.json")).dependencies ?? {});
  for (const dep of deps.filter((d) => d.startsWith("@medusajs/"))) {
    let pkgDir: string;
    try {
      pkgDir = dirname(require.resolve(`${dep}/package.json`, { paths: [medusaDir] }));
    } catch {
      continue;
    }
    const dir = join(pkgDir, "dist", "models");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/\.define\(\s*"(\w+)"/g)) {
        entities.add(m[1]);
        tables.add(snake(m[1]));
      }
      for (const m of src.matchAll(/\.define\(\s*\{([^}]*)\}/g)) {
        const name = /name:\s*"(\w+)"/.exec(m[1])?.[1];
        const table = /tableName:\s*"(\w+)"/.exec(m[1])?.[1];
        if (name) entities.add(name);
        if (table ?? name) tables.add(table ?? snake(name!));
      }
    }
  }
  return { entities, tables };
}

describe("custom model names", () => {
  const core = medusaModels();
  const ours = ourTables();

  it("sees Medusa's models (otherwise the check below proves nothing)", () => {
    expect(core.entities.has("PriceRule")).toBe(true);
    expect(core.tables.has("price_rule")).toBe(true);
    expect(ours.length).toBeGreaterThan(10);
  });

  it("never reuses a Medusa entity or table name", () => {
    const clashes = ours
      .filter(({ table }) => core.tables.has(table) || core.entities.has(pascal(table)))
      .map(({ table, file }) => `${table} (${file})`);
    expect(clashes).toEqual([]);
  });
});
