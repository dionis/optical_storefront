/**
 * Resolves a GLB + descriptor JSON pair from whatever the operator hands over.
 *
 * The contract is one rule: SAME BASENAME, different extension. `dc384.glb` pairs with
 * `dc384.json` and with nothing else. Three ways to supply it, because "the address
 * where both files are" means different things in a browser:
 *
 *   - two loose files       two file pickers; nothing is inferred
 *   - a folder              `webkitdirectory`; the browser hands over the listing and
 *                           pairing is done here. This is the closest thing to a path
 *                           on disk — a browser cannot open one from typed text.
 *   - a served URL base     `base/name.glb` + `base/name.json`, which is how the
 *                           existing `./models/{sku}.glb` convention already works
 *
 * This module never parses the GLB and never touches Three.js: it delivers bytes plus a
 * validated descriptor. That keeps the pairing logic verifiable without a single 3D
 * model, and keeps the metrology (F2) free to own all of the geometry.
 *
 * IDENTITY IS CHECKED, NEVER ASSUMED. Nothing stops an operator pairing `dc384.json`
 * with an aviator GLB, and the result would be a confident, wrong evaluation. Matching
 * filenames is a convention, not proof, so the descriptor's own `sku`/`id` is compared
 * against the basename and any disagreement is reported rather than resolved.
 */

import {
  parseFrameDescriptorText,
  descriptorIdentity,
  type FrameDescriptor,
  type ParseResult,
} from './frame_descriptor';

const MODEL_EXTENSIONS = ['.glb', '.gltf'] as const;
const DESCRIPTOR_EXTENSION = '.json';

/** Result of comparing the descriptor's declared identity against the file basename. */
export interface IdentityCheck {
  matches: boolean;
  basename: string;
  declaredSku: string | null;
  declaredId: string | null;
  /** Operator-facing sentence. Always populated, including on a match. */
  message: string;
}

export interface LoadedModelFile {
  fileName: string;
  bytes: ArrayBuffer;
  sizeBytes: number;
}

/** A complete, usable pair. Only ever produced when both halves resolved. */
export interface FramePair {
  /** The shared basename that joined the two files. */
  name: string;
  model: LoadedModelFile;
  descriptor: FrameDescriptor;
  descriptorFileName: string;
  /** Parse warnings worth showing; the pair is usable regardless. */
  warnings: string[];
  identity: IdentityCheck;
}

export interface PairLoadResult {
  ok: boolean;
  pair: FramePair | null;
  errors: string[];
  warnings: string[];
}

/** One basename found while scanning a folder, complete or not. */
export interface PairCandidate {
  name: string;
  modelFile: File | null;
  descriptorFile: File | null;
  status: 'complete' | 'missing-model' | 'missing-descriptor';
}

/**
 * Same normalisation the reference checker already uses, so a SKU written `PT 98` in the
 * descriptor and `pt98` in the filename are recognised as one frame.
 */
function normalizeIdentifier(value: string): string {
  return (value || '').toLowerCase().replace(/[-_ ]/g, '');
}

/** Strips the last extension. `dc384.glb` -> `dc384`; a dotless name is left alone. */
export function basenameOf(fileName: string): string {
  const withoutPath = fileName.split(/[\\/]/).pop() || fileName;
  const dot = withoutPath.lastIndexOf('.');
  return dot > 0 ? withoutPath.slice(0, dot) : withoutPath;
}

function extensionOf(fileName: string): string {
  const withoutPath = fileName.split(/[\\/]/).pop() || fileName;
  const dot = withoutPath.lastIndexOf('.');
  return dot > 0 ? withoutPath.slice(dot).toLowerCase() : '';
}

export function isModelFileName(fileName: string): boolean {
  return (MODEL_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

export function isDescriptorFileName(fileName: string): boolean {
  return extensionOf(fileName) === DESCRIPTOR_EXTENSION;
}

/**
 * Compares the descriptor's declared identity against the basename that paired the files.
 *
 * A mismatch does NOT block the pair — the operator may have renamed the files for good
 * reason — but it is reported loudly, because it is also exactly what a mis-pairing
 * looks like.
 */
export function checkIdentity(basename: string, descriptor: FrameDescriptor): IdentityCheck {
  const target = normalizeIdentifier(basename);
  const sku = descriptor.sku;
  const id = descriptor.id;
  const candidates = [sku, id].filter((v): v is string => !!v);

  if (candidates.length === 0) {
    return {
      matches: false,
      basename,
      declaredSku: sku,
      declaredId: id,
      message:
        `La ficha no declara «sku» ni «id», así que no se puede comprobar que ` +
        `describa a «${basename}». Verifícalo a mano.`,
    };
  }

  const matches = candidates.some((c) => normalizeIdentifier(c) === target);
  if (matches) {
    return {
      matches: true,
      basename,
      declaredSku: sku,
      declaredId: id,
      message: `Identidad confirmada: la ficha declara «${sku ?? id}» y el archivo es «${basename}».`,
    };
  }

  return {
    matches: false,
    basename,
    declaredSku: sku,
    declaredId: id,
    message:
      `ATENCIÓN: la ficha describe «${candidates.join('» / «')}» pero los archivos se ` +
      `llaman «${basename}». Si no son la misma montura, la evaluación será falsa.`,
  };
}

/**
 * Builds the pair once both halves are in hand. Shared by all three sources.
 *
 * `extraWarnings` is taken up front rather than pushed onto the result afterwards: the
 * pair and the result would otherwise have to share one array, and appending through
 * both handles duplicates every message.
 */
function assemblePair(
  name: string,
  modelFileName: string,
  modelBytes: ArrayBuffer,
  descriptorFileName: string,
  descriptorText: string,
  extraWarnings: string[] = []
): PairLoadResult {
  if (modelBytes.byteLength === 0) {
    return {
      ok: false,
      pair: null,
      errors: [`El modelo «${modelFileName}» está vacío.`],
      warnings: [...extraWarnings],
    };
  }

  const parsed: ParseResult = parseFrameDescriptorText(descriptorText);
  if (!parsed.ok || !parsed.value) {
    return {
      ok: false,
      pair: null,
      errors: parsed.errors.map((e) => `«${descriptorFileName}»: ${e}`),
      warnings: [...parsed.warnings, ...extraWarnings],
    };
  }

  const identity = checkIdentity(name, parsed.value);
  const warnings = [...parsed.warnings];
  if (!identity.matches) warnings.push(identity.message);
  warnings.push(...extraWarnings);

  return {
    ok: true,
    pair: {
      name,
      model: {
        fileName: modelFileName,
        bytes: modelBytes,
        sizeBytes: modelBytes.byteLength,
      },
      descriptor: parsed.value,
      descriptorFileName,
      warnings: [...warnings],
      identity,
    },
    errors: [],
    warnings,
  };
}

/**
 * Source 1 — two loose files chosen by the operator.
 *
 * The basenames are allowed to differ here: the operator picked each file explicitly, so
 * overriding that choice would be presumptuous. The disagreement is reported instead,
 * and the model's basename is the one that names the pair.
 */
export async function pairFromFiles(modelFile: File, descriptorFile: File): Promise<PairLoadResult> {
  if (!isModelFileName(modelFile.name)) {
    return {
      ok: false,
      pair: null,
      errors: [`«${modelFile.name}» no es un .glb ni un .gltf.`],
      warnings: [],
    };
  }
  if (!isDescriptorFileName(descriptorFile.name)) {
    return {
      ok: false,
      pair: null,
      errors: [`«${descriptorFile.name}» no es un .json.`],
      warnings: [],
    };
  }

  const modelBase = basenameOf(modelFile.name);
  const descriptorBase = basenameOf(descriptorFile.name);

  let bytes: ArrayBuffer;
  let text: string;
  try {
    [bytes, text] = await Promise.all([modelFile.arrayBuffer(), descriptorFile.text()]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, pair: null, errors: [`No se pudieron leer los archivos: ${detail}`], warnings: [] };
  }

  const extra =
    normalizeIdentifier(modelBase) === normalizeIdentifier(descriptorBase)
      ? []
      : [
          `Los nombres no coinciden: «${modelFile.name}» y «${descriptorFile.name}». ` +
            `Se emparejan porque los elegiste tú, no por convención.`,
        ];

  return assemblePair(modelBase, modelFile.name, bytes, descriptorFile.name, text, extra);
}

/**
 * Source 2a — scans a folder listing and reports every basename it found.
 *
 * Returns candidates rather than pairs so the caller can show orphans as orphans. A
 * folder holding six frames and one stray JSON should say so, not silently load one
 * pair and drop the rest on the floor.
 */
export function discoverPairs(files: ArrayLike<File>): PairCandidate[] {
  const byName = new Map<string, PairCandidate>();

  const slot = (name: string): PairCandidate => {
    const key = normalizeIdentifier(name);
    let entry = byName.get(key);
    if (!entry) {
      entry = { name, modelFile: null, descriptorFile: null, status: 'missing-model' };
      byName.set(key, entry);
    }
    return entry;
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const base = basenameOf(file.name);
    if (isModelFileName(file.name)) {
      // A folder holding both .glb and .gltf for one frame keeps the .glb: it is what
      // the pipeline emits and what the loader is configured for.
      const entry = slot(base);
      if (!entry.modelFile || extensionOf(file.name) === '.glb') entry.modelFile = file;
    } else if (isDescriptorFileName(file.name)) {
      slot(base).descriptorFile = file;
    }
  }

  const candidates = [...byName.values()];
  for (const candidate of candidates) {
    candidate.status = candidate.modelFile
      ? candidate.descriptorFile
        ? 'complete'
        : 'missing-descriptor'
      : 'missing-model';
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}

/** Source 2b — loads one candidate discovered by {@link discoverPairs}. */
export async function pairFromCandidate(candidate: PairCandidate): Promise<PairLoadResult> {
  if (!candidate.modelFile || !candidate.descriptorFile) {
    const missing = candidate.modelFile ? 'el .json' : 'el .glb';
    return {
      ok: false,
      pair: null,
      errors: [`A «${candidate.name}» le falta ${missing}.`],
      warnings: [],
    };
  }
  return pairFromFiles(candidate.modelFile, candidate.descriptorFile);
}

/**
 * Source 3 — a served URL base plus a shared name.
 *
 * Both halves are fetched with a cache-busting stamp, the same way the reference files
 * are, so a regenerated model is never served from a stale cache while the panel claims
 * to have evaluated the new one.
 */
export async function pairFromUrlBase(base: string, name: string): Promise<PairLoadResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, pair: null, errors: ['Indica el nombre del par (sin extensión).'], warnings: [] };
  }

  const root = base.trim().replace(/\/+$/, '');
  const stamp = Date.now();
  const descriptorUrl = `${root}/${trimmedName}${DESCRIPTOR_EXTENSION}?t=${stamp}`;

  // .glb first: it is what the pipeline emits, and .gltf is the documented alternative.
  const errors: string[] = [];
  let modelUrl: string | null = null;
  let bytes: ArrayBuffer | null = null;

  for (const ext of MODEL_EXTENSIONS) {
    const url = `${root}/${trimmedName}${ext}?t=${stamp}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        modelUrl = url;
        bytes = await res.arrayBuffer();
        break;
      }
      if (res.status !== 404) errors.push(`${trimmedName}${ext}: HTTP ${res.status}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`${trimmedName}${ext}: ${detail}`);
    }
  }

  if (!bytes || !modelUrl) {
    errors.unshift(`No se encontró «${trimmedName}.glb» ni «${trimmedName}.gltf» en «${root}».`);
    return { ok: false, pair: null, errors, warnings: [] };
  }

  let text: string;
  try {
    const res = await fetch(descriptorUrl);
    if (!res.ok) {
      return {
        ok: false,
        pair: null,
        errors: [
          `El modelo está en «${root}» pero la ficha «${trimmedName}.json» ` +
            `no (HTTP ${res.status}). Sin ficha no hay nada contra lo que evaluar.`,
        ],
        warnings: [],
      };
    }
    text = await res.text();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      pair: null,
      errors: [`No se pudo descargar «${trimmedName}.json»: ${detail}`],
      warnings: [],
    };
  }

  const modelFileName = (modelUrl.split('?')[0].split('/').pop() || `${trimmedName}.glb`);
  return assemblePair(trimmedName, modelFileName, bytes, `${trimmedName}.json`, text);
}

/** One-line summary of a loaded pair, for the status area. */
export function describePair(pair: FramePair): string {
  const kb = Math.round(pair.model.sizeBytes / 1024);
  return `${pair.model.fileName} (${kb} kB) + ${pair.descriptorFileName} — ${descriptorIdentity(pair.descriptor)}`;
}
