/** Shared optical prescription range arrays used in form selects. */

export const SPH_VALUES: number[] = [];
for (let v = -20; v <= 12; v += 0.25) SPH_VALUES.push(Math.round(v * 100) / 100);

export const CYL_VALUES: number[] = [];
for (let v = -6; v <= 6; v += 0.25) CYL_VALUES.push(Math.round(v * 100) / 100);

export const AXIS_VALUES = Array.from({ length: 180 }, (_, i) => i + 1);

export const ADD_VALUES: number[] = [];
for (let v = 0.75; v <= 4.0; v += 0.25) ADD_VALUES.push(Math.round(v * 100) / 100);

export const PD_SINGLE: number[] = [];
for (let v = 50; v <= 80; v += 0.5) PD_SINGLE.push(Math.round(v * 10) / 10);

export const PD_HALF: number[] = [];
for (let v = 25; v <= 40; v += 0.5) PD_HALF.push(Math.round(v * 10) / 10);

export function fmtDiop(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}
