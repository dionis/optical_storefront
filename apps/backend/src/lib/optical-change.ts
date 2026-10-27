/**
 * "Daño óptico": how far the prescription a patient arrives wearing is from
 * the new one, and how long they have worn it (owner's requirement: when a
 * patient with glasses comes in, record the prescription they wear and the new
 * one). Pure — no I/O. Health data: the result lives with the sale's
 * prescriptions, never on receipts, emails, alerts or Google Sheets.
 *
 * Per eye it compares sphere, cylinder, axis (circular: 175° and 5° are 10°
 * apart) and addition, plus the spherical equivalent (sph + cyl/2), the usual
 * single number for "how much did the correction move". A change is
 * significant when any of these reaches the threshold; the owner can tune them
 * (HU-123), these are the defaults opticians commonly use.
 */

export interface EyeRx {
  sph?: number | null;
  cyl?: number | null;
  axis?: number | null;
  add?: number | null;
}

export interface Thresholds {
  /** Diopters of spherical-equivalent change. */
  se: number;
  /** Diopters of cylinder change. */
  cyl: number;
  /** Degrees of axis change, only counted when the cylinder is at least `axisMinCyl`. */
  axis: number;
  axisMinCyl: number;
  /** Diopters of addition change. */
  add: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { se: 0.5, cyl: 0.5, axis: 10, axisMinCyl: 0.75, add: 0.5 };

export interface EyeChange {
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  add: number | null;
  /** Spherical equivalent: new − worn. */
  se: number | null;
  significant: boolean;
}

export interface OpticalChange {
  od: EyeChange;
  os: EyeChange;
  /** Largest absolute spherical-equivalent change of the two eyes. */
  max_se: number | null;
  significant: boolean;
  /** Whole months between the worn prescription's date and the sale; null if unknown. */
  months_since_worn: number | null;
}

const num = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : round2(b - a));

export function axisDelta(a: number | null | undefined, b: number | null | undefined): number | null {
  const x = num(a);
  const y = num(b);
  if (x == null || y == null) return null;
  const d = Math.abs(((y % 180) + 180) % 180 - (((x % 180) + 180) % 180));
  return Math.min(d, 180 - d);
}

export function sphericalEquivalent(eye: EyeRx): number | null {
  const sph = num(eye.sph);
  if (sph == null) return null;
  return round2(sph + (num(eye.cyl) ?? 0) / 2);
}

function eyeChange(worn: EyeRx, next: EyeRx, t: Thresholds): EyeChange {
  const cylWorn = num(worn.cyl) ?? 0;
  const cylNext = num(next.cyl) ?? 0;
  const change: EyeChange = {
    sph: diff(num(worn.sph), num(next.sph)),
    cyl: diff(cylWorn, cylNext),
    axis: axisDelta(worn.axis, next.axis),
    add: diff(num(worn.add), num(next.add)),
    se: diff(sphericalEquivalent(worn), sphericalEquivalent(next)),
    significant: false,
  };
  const axisCounts = Math.max(Math.abs(cylWorn), Math.abs(cylNext)) >= t.axisMinCyl;
  change.significant =
    (change.se != null && Math.abs(change.se) >= t.se) ||
    (change.cyl != null && Math.abs(change.cyl) >= t.cyl) ||
    (axisCounts && change.axis != null && change.axis >= t.axis) ||
    (change.add != null && Math.abs(change.add) >= t.add);
  return change;
}

/**
 * Whole months between a prescription date and `to`. In UTC on purpose: a
 * prescription date is a calendar day ("2026-09-28"), which JavaScript parses
 * as UTC midnight — reading it back in local time would shift it a day west of
 * Greenwich and miscount the month boundary.
 */
export function monthsBetween(from: string | Date | null | undefined, to: Date): number | null {
  if (!from) return null;
  const d = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(d.getTime()) || d > to) return null;
  let months = (to.getUTCFullYear() - d.getUTCFullYear()) * 12 + (to.getUTCMonth() - d.getUTCMonth());
  if (to.getUTCDate() < d.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function opticalChange(
  worn: { od: EyeRx; os: EyeRx; rx_date?: string | Date | null },
  next: { od: EyeRx; os: EyeRx },
  opts: { now?: Date; thresholds?: Partial<Thresholds> } = {}
): OpticalChange {
  const t = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const od = eyeChange(worn.od, next.od, t);
  const os = eyeChange(worn.os, next.os, t);
  const ses = [od.se, os.se].filter((v): v is number => v != null).map(Math.abs);
  return {
    od,
    os,
    max_se: ses.length ? Math.max(...ses) : null,
    significant: od.significant || os.significant,
    months_since_worn: monthsBetween(worn.rx_date ?? null, opts.now ?? new Date()),
  };
}
