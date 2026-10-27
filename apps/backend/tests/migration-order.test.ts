import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Medusa runs a module's migrations in file-name order, not in the order the
 * numeric suffixes suggest: `AddSoftDeleteToLensOption4` sorts before
 * `CreateLensOption1`. On a database that already had the tables (production,
 * where each migration was applied as it was written) that never mattered. On an
 * empty one — staging, or the next store's deployment — the `Add…` migration
 * ran first, found no table, and the rest of that module's migrations were
 * skipped. The backend then booted against a half-built schema.
 *
 * This walks every module's migrations in that same order and fails if one
 * touches a table no earlier migration (or an earlier statement in the same file)
 * creates. `ALTER TABLE IF EXISTS` is tolerant by design and not counted.
 */

const MODULES_DIR = join(__dirname, "..", "src", "modules");

type Stmt = { at: number; kind: "create" | "use"; table: string };

const CREATE = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi;
const USES: RegExp[] = [
  /alter\s+table\s+(?!if\s+exists)"?(\w+)"?/gi,
  /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?\w+"?\s+on\s+"?(\w+)"?/gi,
  /insert\s+into\s+"?(\w+)"?/gi,
  /\bupdate\s+"?(\w+)"?\s+set\b/gi,
  /delete\s+from\s+"?(\w+)"?/gi,
];

/** Only the `up()` body counts, with comments stripped. */
function upSql(source: string): string {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const down = noComments.search(/async\s+down\s*\(/);
  return down === -1 ? noComments : noComments.slice(0, down);
}

function statements(sql: string): Stmt[] {
  const out: Stmt[] = [];
  for (const m of sql.matchAll(CREATE)) out.push({ at: m.index ?? 0, kind: "create", table: m[1].toLowerCase() });
  for (const re of USES) {
    for (const m of sql.matchAll(re)) out.push({ at: m.index ?? 0, kind: "use", table: m[1].toLowerCase() });
  }
  return out.sort((a, b) => a.at - b.at || (a.kind === "create" ? -1 : 1));
}

const modules = readdirSync(MODULES_DIR).filter((m) => existsSync(join(MODULES_DIR, m, "migrations")));

describe("module migrations on an empty database", () => {
  it.each(modules)("%s: every migration only touches tables created before it", (mod) => {
    const dir = join(MODULES_DIR, mod, "migrations");
    const files = readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f)).sort();
    const created = new Set<string>();
    const problems: string[] = [];
    for (const file of files) {
      for (const s of statements(upSql(readFileSync(join(dir, file), "utf8")))) {
        if (s.kind === "create") created.add(s.table);
        else if (!created.has(s.table)) problems.push(`${file} uses "${s.table}" before it is created`);
      }
    }
    expect(problems).toEqual([]);
  });
});
