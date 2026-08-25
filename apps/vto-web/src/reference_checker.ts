import { t } from './i18n';

export interface GlassReferenceSpecs {
  found: boolean;
  sku: string;
  modelName?: string;
  brandName?: string;
  lensWidthNominal?: number | null;
  bridgeNominal?: number | null;
  templeLengthNominal?: number | null;
  /** Boxing-system B measurement: vertical height of the lens opening, in mm. */
  lensHeightBNominal?: number | null;
  totalFrontWidthNominal?: number | null;
  totalFrontWidthMin?: number | null;
  totalFrontWidthMax?: number | null;
  lensShape?: string;
  materials?: string[];
  /** Where the numbers come from, so the panel never presents a demo value as supplier data. */
  confidence?: string;
  /** Which catalogue the record came out of: the bundled files, or an uploaded one. */
  source?: 'bundled' | 'uploaded';
  message: string;
}

/** Outcome of ingesting a reference file the operator supplied. */
export interface ReferenceImportResult {
  ok: boolean;
  /** Records that carried a usable identifier. */
  count: number;
  /** The SKUs the file covers, so the panel can say whether the active one is among them. */
  skus: string[];
  /** Records skipped for having neither `sku` nor `model_name`. */
  skipped: number;
  persisted: boolean;
  error?: string;
}

const USER_REFERENCE_STORAGE = 'rubilens.userReference';
/** A reference catalogue is small text. Past this it is not what the panel expects. */
const MAX_REFERENCE_BYTES = 2_000_000;

export class ReferenceChecker {
  private frames: any[] = [];
  private isLoaded = false;

  // Records from a file the operator uploaded. Searched BEFORE the bundled ones, so a
  // supplier sheet for a SKU overrides whatever demo entry shipped with the app — which
  // is the whole point of being able to supply one.
  private userFrames: any[] = [];
  private userFileName: string | null = null;

  constructor() {
    this.restoreUserReference();
    this.loadReferenceFiles();
  }

  /**
   * Pulls reference records out of whatever shape the file arrived in.
   *
   * The two bundled files already disagree — glass_reference.json is a single supplier
   * record, frame_catalog.json wraps an array under `frames` — so an uploaded file is
   * accepted in either of those shapes, or as a bare array. Anything without an
   * identifier is dropped rather than stored: a record that can never match a SKU is
   * not reference data, it is noise in the count.
   */
  private static extractRecords(data: any): { records: any[]; skipped: number } {
    let candidates: any[] = [];

    if (Array.isArray(data)) candidates = data;
    else if (Array.isArray(data?.frames)) candidates = data.frames;
    else if (data && typeof data === 'object') candidates = [data];

    const records = candidates.filter(
      (item) => item && typeof item === 'object' && (item.sku || item.model_name)
    );
    return { records, skipped: candidates.length - records.length };
  }

  /**
   * Adopts a reference catalogue supplied by the operator.
   *
   * Unlike an uploaded 3D model, this is small text, so it is kept across reloads: an
   * optician who loads their supplier's sheet should not have to load it again after
   * every refresh. Over the size cap it still applies for the session but is not stored.
   */
  public loadUserReference(data: any, fileName: string): ReferenceImportResult {
    const { records, skipped } = ReferenceChecker.extractRecords(data);

    if (records.length === 0) {
      return {
        ok: false,
        count: 0,
        skus: [],
        skipped,
        persisted: false,
        error: t('ref.uploadNoRecords'),
      };
    }

    this.userFrames = records;
    this.userFileName = fileName;

    let persisted = false;
    try {
      const payload = JSON.stringify({ name: fileName, records });
      if (payload.length <= MAX_REFERENCE_BYTES) {
        localStorage.setItem(USER_REFERENCE_STORAGE, payload);
        persisted = true;
      }
    } catch {
      /* private browsing or quota: the catalogue still applies for this session */
    }

    const skus = records.map((r: any) => String(r.sku || r.model_name));
    console.log(`[ReferenceChecker] ${records.length} record(s) from "${fileName}": ${skus.join(', ')}`);
    return { ok: true, count: records.length, skus, skipped, persisted };
  }

  /** Drops the uploaded catalogue and goes back to the bundled files. */
  public clearUserReference(): void {
    this.userFrames = [];
    this.userFileName = null;
    try {
      localStorage.removeItem(USER_REFERENCE_STORAGE);
    } catch {
      /* ignore */
    }
  }

  /** Name and size of the uploaded catalogue in force, or null. */
  public getUserReference(): { name: string; count: number } | null {
    if (!this.userFileName || this.userFrames.length === 0) return null;
    return { name: this.userFileName, count: this.userFrames.length };
  }

  /** Does the uploaded catalogue cover this SKU? Answers the panel's only real question. */
  public userCovers(sku: string): boolean {
    const target = ReferenceChecker.normalize(sku);
    return this.userFrames.some(
      (item: any) => ReferenceChecker.normalize(item?.sku || item?.model_name || '') === target
    );
  }

  private restoreUserReference(): void {
    try {
      const raw = localStorage.getItem(USER_REFERENCE_STORAGE);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const { records } = ReferenceChecker.extractRecords(parsed?.records);
      if (records.length > 0) {
        this.userFrames = records;
        this.userFileName = parsed?.name || 'reference.json';
      }
    } catch {
      /* a corrupt entry is simply ignored: the bundled files still work */
    }
  }

  /**
   * Loads both reference sources: the supplier record for the catalogued model and the
   * per-SKU catalog for the frames offered in the VTO. They are kept apart so demo data
   * can never be mistaken for supplier-published measurements.
   */
  private async loadReferenceFiles(): Promise<void> {
    const stamp = Date.now();
    const collected: any[] = [];

    try {
      const res = await fetch(`./glass_reference/glass_reference.json?t=${stamp}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) collected.push(...data);
        else if (data) collected.push(data);
      } else {
        console.warn(`[ReferenceChecker] glass_reference.json HTTP ${res.status}`);
      }
    } catch (error) {
      console.warn('[ReferenceChecker] Error fetching glass_reference.json:', error);
    }

    try {
      const res = await fetch(`./glass_reference/frame_catalog.json?t=${stamp}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.frames)) collected.push(...data.frames);
      } else {
        console.warn(`[ReferenceChecker] frame_catalog.json HTTP ${res.status}`);
      }
    } catch (error) {
      console.warn('[ReferenceChecker] Error fetching frame_catalog.json:', error);
    }

    this.frames = collected;
    this.isLoaded = collected.length > 0;
    console.log(`[ReferenceChecker] Loaded ${collected.length} frame reference records.`);
  }

  private static normalize(value: string): string {
    return (value || '').toLowerCase().replace(/[-_ ]/g, '');
  }

  /**
   * Resolves the reference specs for a SKU.
   *
   * There is deliberately NO fallback to another frame: an unmatched SKU returns
   * found:false. The previous behaviour silently served the catalogued model's
   * measurements for every SKU, so the panel showed one frame's dimensions while the
   * patient was trying on a different one.
   */
  public async getSpecsForSKU(sku: string): Promise<GlassReferenceSpecs> {
    if (!this.isLoaded) {
      await this.loadReferenceFiles();
    }

    const target = ReferenceChecker.normalize(sku);
    const byId = (item: any) =>
      ReferenceChecker.normalize(item?.sku || item?.model_name || '') === target;

    // Uploaded first: an operator who supplied a sheet for this SKU means it to win.
    const fromUser = this.userFrames.find(byId);
    const match = fromUser ?? this.frames.find(byId);

    if (!match) {
      return {
        found: false,
        sku,
        message: t('ref.notFound', { sku }),
      };
    }

    const m = match.measurements_mm || {};
    const classif = match.classification || {};
    const pick = (field: any) => (field && field.nominal !== undefined ? field.nominal : null);

    return {
      found: true,
      sku: match.sku || sku,
      modelName: match.model_name || match.sku,
      brandName: match.brand?.name || '—',
      lensWidthNominal: pick(m.lens_width_a),
      bridgeNominal: pick(m.bridge_dbl),
      templeLengthNominal: pick(m.temple_length),
      lensHeightBNominal: pick(m.lens_height_b),
      totalFrontWidthNominal: pick(m.derived_total_front_width),
      totalFrontWidthMin: m.derived_total_front_width?.min ?? null,
      totalFrontWidthMax: m.derived_total_front_width?.max ?? null,
      lensShape: classif.lens_shape_raw || classif.lens_shape || '—',
      materials: classif.materials
        ? classif.materials.map((mat: any) => mat.en || mat.raw)
        : [],
      confidence: m.confidence || 'unknown',
      source: fromUser ? 'uploaded' : 'bundled',
      message: fromUser
        ? t('ref.loadedFromFile', {
            model: match.model_name || match.sku,
            file: this.userFileName ?? '',
          })
        : t('ref.loaded', { model: match.model_name || match.sku }),
    };
  }
}
