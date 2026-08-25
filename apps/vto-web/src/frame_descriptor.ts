/**
 * Parser for the frame descriptor JSON (the `datasets/3d-samples/frames/*.json` shape).
 *
 * The descriptor is a SPEC SHEET, not a measurement: it is what the supplier and the
 * photo survey declare about a frame. Its whole value depends on one discipline, which
 * this module exists to enforce — every figure carries the confidence level it was
 * published under, and that level travels with the number all the way to the report:
 *
 *   supplier_published  copied from the supplier catalogue
 *   observed_in_photos  read off the reference photos by eye
 *   estimated           computed from supplier data by a stated formula
 *   heuristic           typical value for that construction. NOT measured.
 *
 * Without that, a `heuristic` 8 deg pantoscopic tilt reaches an optician looking exactly
 * like a measured one. Everything here is built so that cannot happen.
 *
 * Nothing in this module throws: a malformed file must degrade into a report of what is
 * wrong with it, never into a broken panel.
 */

/** Confidence levels declared by the dataset, plus the storefront's own and a fallback. */
export type Confidence =
  | 'supplier_published'
  | 'observed_in_photos'
  | 'estimated'
  | 'heuristic'
  | 'declared_in_ui'
  | 'unknown';

const KNOWN_CONFIDENCE: readonly string[] = [
  'supplier_published',
  'observed_in_photos',
  'estimated',
  'heuristic',
  'declared_in_ui',
];

/**
 * Schema versions this parser was written against. A file outside the list is still
 * parsed — rejecting a good descriptor over a version bump is worse than flagging it —
 * but the mismatch is reported so nobody trusts a silent partial read.
 */
const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = ['1.0', '1.1'];

/**
 * The supplier publishes a size RANGE per model because one model number covers several
 * sizes, and the photographed unit is one of them. `nominal` is the modelling target and
 * the range is the tolerance — the evaluation compares against the range, never against
 * the nominal alone.
 */
export interface MeasurementRange {
  raw: string | null;
  min: number | null;
  max: number | null;
  nominal: number | null;
  /** True when the published range has no upper bound (e.g. "50+ mm"). */
  openEnded: boolean;
  confidence: Confidence;
  note: string | null;
}

/**
 * `derived_total_front_width` is computed as `2 * lens_width_a + bridge_dbl`, which
 * leaves out the end-piece overhang. The dataset states the real total runs 2-6 mm
 * larger, so a measured width is only out of spec once it clears the upper bound by
 * more than this.
 */
export const END_PIECE_OVERHANG_MM = { min: 2, max: 6 } as const;

export interface FrameGeometryHints {
  /** Declared axis and datum conventions — these make the metrology deterministic. */
  upAxis: string | null;
  forwardAxis: string | null;
  symmetryPlane: string | null;
  recommendedOrigin: string | null;
  /**
   * Rim thickness. The key differs by construction (`rim_thickness_mm` on acetate,
   * `upper_rim_thickness_mm` on semi-rimless, `rim_wire_diameter_mm` on wire frames),
   * and a fully rimless frame legitimately has none — hence null rather than a default.
   */
  rimThicknessMM: number | null;
  /** Which key the rim thickness actually came from, for the provenance line. */
  rimThicknessKey: string | null;
  frontThicknessMM: number | null;
  baseCurve: number | null;
  pantoscopicTiltDeg: number | null;
  faceFormWrapDeg: number | null;
  confidence: Confidence;
  basis: string | null;
}

export interface FrameConstruction {
  rim: string | null;
  bridge: string | null;
  nosePads: string | null;
  hardware: string | null;
  markings: string | null;
  confidence: Confidence;
}

export interface FrameDescriptor {
  schemaVersion: string | null;
  id: string | null;
  sku: string | null;
  modelName: string | null;
  brandName: string | null;
  lensShape: string | null;
  rimType: string | null;
  materials: string[];
  measurements: {
    lensWidthA: MeasurementRange;
    bridgeDBL: MeasurementRange;
    templeLength: MeasurementRange;
    lensHeightB: MeasurementRange;
    totalFrontWidth: MeasurementRange;
  };
  geometry: FrameGeometryHints;
  construction: FrameConstruction;
  /** The dataset's own statement of what it cannot give you. Shown, not hidden. */
  limitations: string[];
}

export interface ParseResult {
  ok: boolean;
  value: FrameDescriptor | null;
  /** Conditions that made the file unusable. */
  errors: string[];
  /** Conditions worth showing the operator that did not stop the parse. */
  warnings: string[];
}

/** Accepts 49, "49", "49.0 mm", "8 deg". Rejects anything else. Mirrors schema.py. */
function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/mm/gi, '')
      .replace(/°/g, '')
      .replace(/deg/gi, '')
      .replace(/,/g, '.')
      .trim();
    const parsed = parseFloat(cleaned);
    return isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function coerceConfidence(value: unknown, warnings: string[], where: string): Confidence {
  const text = coerceText(value);
  if (!text) return 'unknown';
  if (KNOWN_CONFIDENCE.includes(text)) return text as Confidence;
  // An unrecognised level is preserved as 'unknown' rather than assumed to be strong.
  warnings.push(`Nivel de confianza no reconocido en ${where}: «${text}».`);
  return 'unknown';
}

const EMPTY_RANGE: MeasurementRange = {
  raw: null,
  min: null,
  max: null,
  nominal: null,
  openEnded: false,
  confidence: 'unknown',
  note: null,
};

/**
 * Reads one `{raw, min, max, nominal, open_ended, note}` block.
 *
 * `blockConfidence` is the confidence of the enclosing `measurements_mm` section; a
 * field carrying its own (as `derived_total_front_width` does) overrides it, because a
 * value computed by formula is not as strong as one the supplier published.
 */
function parseRange(
  raw: unknown,
  blockConfidence: Confidence,
  warnings: string[],
  where: string
): MeasurementRange {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RANGE, confidence: blockConfidence };

  const obj = raw as Record<string, unknown>;
  const min = coerceNumber(obj.min);
  const max = coerceNumber(obj.max);
  const nominal = coerceNumber(obj.nominal);
  const own =
    obj.confidence !== undefined
      ? coerceConfidence(obj.confidence, warnings, where)
      : blockConfidence;

  if (min !== null && max !== null && min > max) {
    warnings.push(`${where}: el rango publicado está invertido (${min} > ${max}).`);
  }
  if (nominal !== null && min !== null && max !== null && (nominal < min || nominal > max)) {
    warnings.push(`${where}: el nominal (${nominal}) cae fuera de su propio rango ${min}-${max}.`);
  }

  return {
    raw: coerceText(obj.raw),
    min,
    max,
    nominal,
    openEnded: obj.open_ended === true,
    confidence: own,
    note: coerceText(obj.note),
  };
}

/**
 * Rim thickness lives under a different key depending on how the frame is built. Ordered
 * most specific first; a fully rimless frame matches none of them and correctly yields
 * null — there is no rim to measure.
 */
const RIM_THICKNESS_KEYS: readonly string[] = [
  'rim_thickness_mm',
  'upper_rim_thickness_mm',
  'rim_wire_diameter_mm',
];

function parseGeometry(raw: unknown, warnings: string[]): FrameGeometryHints {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  let rimThicknessMM: number | null = null;
  let rimThicknessKey: string | null = null;
  for (const key of RIM_THICKNESS_KEYS) {
    const candidate = coerceNumber(obj[key]);
    if (candidate !== null) {
      rimThicknessMM = candidate;
      rimThicknessKey = key;
      break;
    }
  }

  return {
    upAxis: coerceText(obj.up_axis),
    forwardAxis: coerceText(obj.forward_axis),
    symmetryPlane: coerceText(obj.symmetry_plane),
    recommendedOrigin: coerceText(obj.recommended_origin),
    rimThicknessMM,
    rimThicknessKey,
    frontThicknessMM: coerceNumber(obj.front_thickness_mm),
    baseCurve: coerceNumber(obj.base_curve),
    pantoscopicTiltDeg: coerceNumber(obj.pantoscopic_tilt_deg),
    faceFormWrapDeg: coerceNumber(obj.face_form_wrap_deg),
    confidence: coerceConfidence(obj.confidence, warnings, 'geometry_hints_3d'),
    basis: coerceText(obj.basis),
  };
}

function parseConstruction(raw: unknown, warnings: string[]): FrameConstruction {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    rim: coerceText(obj.rim),
    bridge: coerceText(obj.bridge),
    nosePads: coerceText(obj.nose_pads),
    hardware: coerceText(obj.hardware),
    markings: coerceText(obj.markings),
    confidence: coerceConfidence(obj.confidence, warnings, 'observed_construction'),
  };
}

function coerceStringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.map((v) => coerceText(v)).filter((v): v is string => v !== null);
}

/** Materials arrive as `[{raw, en}]`; the English form is what the panel shows. */
function parseMaterials(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return coerceText(entry);
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        return coerceText(obj.en) ?? coerceText(obj.raw);
      }
      return null;
    })
    .filter((v): v is string => v !== null);
}

/**
 * Turns arbitrary parsed JSON into a descriptor.
 *
 * A file is rejected only when it cannot identify a frame or declares no dimension at
 * all — those two make every downstream comparison meaningless. Everything else is a
 * warning, because a partial descriptor still evaluates the fields it does carry.
 */
export function parseFrameDescriptor(input: unknown): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, value: null, errors: ['El archivo no contiene un objeto JSON.'], warnings };
  }

  const root = input as Record<string, unknown>;

  const schemaVersion = coerceText(root.schema_version);
  if (!schemaVersion) {
    warnings.push('El archivo no declara «schema_version».');
  } else if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    warnings.push(
      `Versión de esquema «${schemaVersion}» no verificada ` +
        `(probadas: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}). Se interpreta igualmente.`
    );
  }

  const sku = coerceText(root.sku);
  const id = coerceText(root.id);
  const modelName = coerceText(root.model_name);
  if (!sku && !id && !modelName) {
    errors.push('El archivo no identifica ninguna montura: faltan «sku», «id» y «model_name».');
  }

  const brand = (root.brand && typeof root.brand === 'object' ? root.brand : {}) as Record<
    string,
    unknown
  >;
  const classification = (
    root.classification && typeof root.classification === 'object' ? root.classification : {}
  ) as Record<string, unknown>;

  const rawMeasurements = (
    root.measurements_mm && typeof root.measurements_mm === 'object' ? root.measurements_mm : {}
  ) as Record<string, unknown>;
  const blockConfidence = coerceConfidence(rawMeasurements.confidence, warnings, 'measurements_mm');

  const measurements = {
    lensWidthA: parseRange(rawMeasurements.lens_width_a, blockConfidence, warnings, 'lens_width_a'),
    bridgeDBL: parseRange(rawMeasurements.bridge_dbl, blockConfidence, warnings, 'bridge_dbl'),
    templeLength: parseRange(
      rawMeasurements.temple_length,
      blockConfidence,
      warnings,
      'temple_length'
    ),
    lensHeightB: parseRange(
      rawMeasurements.lens_height_b,
      blockConfidence,
      warnings,
      'lens_height_b'
    ),
    totalFrontWidth: parseRange(
      rawMeasurements.derived_total_front_width,
      blockConfidence,
      warnings,
      'derived_total_front_width'
    ),
  };

  const declared = Object.values(measurements).filter(
    (m) => m.nominal !== null || m.min !== null || m.max !== null
  ).length;
  if (declared === 0) {
    errors.push('El archivo no declara ninguna medida en «measurements_mm».');
  }

  if (errors.length > 0) {
    return { ok: false, value: null, errors, warnings };
  }

  const geometry = parseGeometry(root.geometry_hints_3d, warnings);
  if (geometry.confidence === 'heuristic') {
    warnings.push(
      'Las pistas de «geometry_hints_3d» son heurísticas: valores típicos de esa ' +
        'construcción, no medidos sobre este ejemplar. No son especificación.'
    );
  }

  const value: FrameDescriptor = {
    schemaVersion,
    id,
    sku,
    modelName,
    brandName: coerceText(brand.name),
    lensShape: coerceText(classification.lens_shape),
    rimType: coerceText(classification.rim_type),
    materials: parseMaterials(classification.materials),
    measurements,
    geometry,
    construction: parseConstruction(root.observed_construction, warnings),
    limitations: coerceStringList(root.limitations),
  };

  return { ok: true, value, errors, warnings };
}

/** Parses raw file text. Keeps JSON syntax errors inside the same result shape. */
export function parseFrameDescriptorText(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, value: null, errors: [`JSON no válido: ${detail}`], warnings: [] };
  }
  return parseFrameDescriptor(data);
}

/** Identity shown in the panel, so an operator always sees which frame is loaded. */
export function descriptorIdentity(d: FrameDescriptor): string {
  const name = d.modelName || d.sku || d.id || 'sin nombre';
  return d.brandName ? `${d.brandName} ${name}` : name;
}

/** How many of the five dimensions the file actually declares. Used by the load summary. */
export function declaredMeasurementCount(d: FrameDescriptor): number {
  return Object.values(d.measurements).filter(
    (m) => m.nominal !== null || m.min !== null || m.max !== null
  ).length;
}
