/**
 * Dictionary lint: every t() key resolves, in every language.
 *
 * `t()` falls back silently — an unknown key renders as the key itself, and a
 * key missing only from `en` renders in Spanish. Both failures look fine in dev
 * (where the default language is `es`) and only surface to whoever switched
 * language, which is exactly the person least likely to report it. So this runs
 * in CI instead.
 *
 * Two checks:
 *   1. `es` and `en` hold the same key set.
 *   2. Every literal key passed to t() in the source exists in the dictionary.
 *
 * Keys built at runtime (`t(\`adm.range.${k}\`)`) cannot be resolved statically;
 * their prefixes are listed in DYNAMIC_PREFIXES so the check stays honest about
 * what it does and does not cover.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "capri-storefront");
const SRC = join(ROOT, "src");

/**
 * Families whose keys are assembled from a variable at render time. Each entry
 * is checked for "at least one key exists with this prefix" rather than exact
 * matches — enough to catch a whole family being deleted or renamed.
 */
const DYNAMIC_PREFIXES = ["adm.range.", "adm.tab.", "adm.lens.cat.", "adm.err.stage.", "adm.dow."];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(js|jsx)$/.test(name) ? [full] : [];
  });
}

const { T } = await import(pathToFileURL(join(SRC, "i18n", "translations.js")).href);
const locales = Object.keys(T);
const errors = [];

// 1 — the locales must agree on which keys exist.
for (const a of locales) {
  for (const b of locales) {
    if (a === b) continue;
    for (const key of Object.keys(T[a])) {
      if (!(key in T[b])) errors.push(`missing in "${b}": ${key}  (present in "${a}")`);
    }
  }
}

// 2 — every literal t("…") in the source must resolve.
const LITERAL = /\bt\(\s*"([a-zA-Z0-9_.]+)"/g;
const seenPrefixes = new Set(DYNAMIC_PREFIXES);
for (const file of walk(SRC)) {
  const source = readFileSync(file, "utf8");
  for (const [, key] of source.matchAll(LITERAL)) {
    // Dotless strings are almost always something else passed to a function
    // named t; dictionary keys always carry a namespace.
    if (!key.includes(".")) continue;
    // A literal ending in "." is the left half of `t("track." + value)` — a
    // family, not a key. Check the family has members instead.
    if (key.endsWith(".")) {
      seenPrefixes.add(key);
      continue;
    }
    if (!(key in T.es)) errors.push(`${relative(ROOT, file)}: unknown key ${key}`);
  }
}

// 3 — every dynamic family must still have members.
for (const prefix of seenPrefixes) {
  if (!Object.keys(T.es).some((k) => k.startsWith(prefix))) {
    errors.push(`dynamic key family "${prefix}*" has no entries left`);
  }
}

if (errors.length) {
  console.error(`i18n check failed (${errors.length}):`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

console.log(
  `i18n ok — ${Object.keys(T.es).length} keys × ${locales.length} locales (${locales.join(", ")})`
);
