/**
 * Lens design × prescription rules at the point of sale. Pure — no I/O.
 *
 * The browser (apps/capri-storefront/src/admin/rxRules.js, `validateRx` and
 * `setEyeField`, and the LensPicker in PosSale.jsx) explains these to the
 * seller in their language; this is what cannot be skipped. Each rule returns
 * a reason code (the panel shows `adm.err.pos.<reason>`) plus the details that
 * name the design and the eye — never prose.
 *
 * Mirrored, not invented:
 *   - multifocal (the design needs an ADD) → `addRequired` on each eye without
 *     one; the ADD is typed once and mirrored to the other eye, so the two
 *     always agree;
 *   - single vision → `addSv` on any eye that carries an ADD.
 * A frame bought without lenses next to a prescription is fine, and a material
 * over its `max_abs` stays a recommendation (owner's decision): neither is here.
 */

/** What the rules need to know about the lens design of a line. */
export interface LensRxDesign {
  code: string;
  /** "sv" | "bifocal" | "prog" (lens_design.category). */
  category: string | null;
  /** lens_design.requires_add: bifocals and progressives. */
  requires_add: boolean;
}

/** The two eyes of a prescription, as the till sends them (numbers or null). */
export interface RxAddLike {
  od?: { add?: number | null } | null;
  os?: { add?: number | null } | null;
}

export type LensRxReason = "design_needs_add" | "design_no_add" | "rx_add_mismatch";

export interface LensRxProblem {
  reason: LensRxReason;
  details: {
    design_code: string;
    category: string | null;
    /** The eye the rule tripped on (absent when both are involved). */
    eye?: "od" | "os";
    od_add?: number | null;
    os_add?: number | null;
  };
}

/**
 * The client mirrors the ADD typed in one eye onto the other (`setEyeField`),
 * so a prescription it sends always carries the same ADD in both eyes. The
 * server asks for the same: equal, float noise aside.
 */
export const ADD_MISMATCH_TOLERANCE = 0.001;

/** An eye's ADD as a finite number, or null when absent or unreadable. */
export const addOf = (eye: { add?: number | null } | null | undefined): number | null => {
  const v: unknown = eye?.add;
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * Whether a lens design can be cut from a prescription, ADD-wise. Null = fine.
 * `frame-only` has no lenses and is never a problem.
 */
export function lensRxProblem(design: LensRxDesign, rx: RxAddLike): LensRxProblem | null {
  if (design.code === "frame-only") return null;
  const od = addOf(rx.od);
  const os = addOf(rx.os);
  const base = { design_code: design.code, category: design.category };

  if (design.requires_add) {
    // A bifocal or progressive is cut to the ADD: without it there is no near segment.
    if (od === null || od <= 0) return { reason: "design_needs_add", details: { ...base, eye: "od" } };
    if (os === null || os <= 0) return { reason: "design_needs_add", details: { ...base, eye: "os" } };
    if (Math.abs(od - os) > ADD_MISMATCH_TOLERANCE) {
      return { reason: "rx_add_mismatch", details: { ...base, od_add: od, os_add: os } };
    }
    return null;
  }

  if (design.category === "sv") {
    // Single vision with an ADD is a data error (the seller picked the wrong
    // type, or the ADD belongs to a multifocal): the lab would not know what to cut.
    if (od !== null && od !== 0) return { reason: "design_no_add", details: { ...base, eye: "od" } };
    if (os !== null && os !== 0) return { reason: "design_no_add", details: { ...base, eye: "os" } };
  }
  return null;
}

/** First problem across the designs of a sale (one frame, so normally one design). */
export function lensRxProblems(designs: readonly LensRxDesign[], rx: RxAddLike): LensRxProblem | null {
  for (const d of designs) {
    const p = lensRxProblem(d, rx);
    if (p) return p;
  }
  return null;
}

/**
 * A prescription read by the OCR is a proposal until a person confirms it on
 * screen (`verified_by_user`). The till sends `source: "ocr"` when the values
 * came from the photo; without the confirmation flag that prescription is not
 * stored and not sold. A manual prescription is confirmed by being typed.
 */
export function rxConfirmationProblem(rx: { source?: unknown; verified_by_user?: unknown } | null | undefined): "rx_unconfirmed" | null {
  if (!rx || rx.source !== "ocr") return null;
  return rx.verified_by_user === true ? null : "rx_unconfirmed";
}

/** `verified_by_user` as it is stored: what the client sent, never assumed for an OCR read. */
export function storedVerifiedByUser(rx: { source?: unknown; verified_by_user?: unknown }): boolean {
  if (rx.source === "ocr") return rx.verified_by_user === true;
  // Typed by hand: confirmed unless the client says otherwise.
  return rx.verified_by_user !== false;
}

// ---------------------------------------------------------------------------
// Photochromic and AR availability per design category (lib/lens-quote.ts)
// ---------------------------------------------------------------------------

/** `lens_ar_option.ar_group` → the design categories it serves. */
export function arGroupServes(group: string | null | undefined, category: string | null | undefined): boolean {
  if (group === "all") return true;
  if (group === "sv") return category === "sv";
  if (group === "bifprog") return category === "bifocal" || category === "prog";
  return false;
}
