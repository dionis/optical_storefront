import type { Prescription } from "@eyewear/shared";

/**
 * The Rx values of a prescription as `prescription` table columns. Shared by
 * the web (POST /store/prescriptions) and the point of sale, so both store a
 * prescription the same way.
 */
export function prescriptionColumns(rx: Pick<Prescription, "od" | "os"> & Partial<Prescription>) {
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
  return {
    od_sph: num(rx.od.sph), od_cyl: num(rx.od.cyl), od_axis: num(rx.od.axis),
    od_add: num(rx.od.add), od_prism: num(rx.od.prism), od_base: rx.od.base ?? null,
    os_sph: num(rx.os.sph), os_cyl: num(rx.os.cyl), os_axis: num(rx.os.axis),
    os_add: num(rx.os.add), os_prism: num(rx.os.prism), os_base: rx.os.base ?? null,
    pd: num(rx.pd), pd_od: num(rx.pd_od), pd_os: num(rx.pd_os),
    // Fitting height: mandatory for multifocals (the lab cuts the corridor to
    // it) and used by the try-on to place the segment.
    seg_height: num(rx.seg_height),
  };
}
