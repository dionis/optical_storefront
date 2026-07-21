"use client";

import { create } from "zustand";
import type {
  Prescription,
  LensConfig,
  UsageType,
  LensIndex,
  CoatingType,
} from "@eyewear/shared";

export type FunnelStep = 1 | 2 | 3 | 4;

interface FunnelState {
  step: FunnelStep;
  frameId: string | null;
  variantId: string | null;
  framePriceCents: number;
  usageType: UsageType | null;
  prescription: Prescription | null;
  lensIndex: LensIndex | null;
  coatings: CoatingType[];
  totalCents: number;

  setStep: (step: FunnelStep) => void;
  setFrame: (frameId: string, variantId: string, priceCents: number) => void;
  setUsageType: (usageType: UsageType) => void;
  setPrescription: (prescription: Prescription) => void;
  setLensIndex: (index: LensIndex) => void;
  toggleCoating: (coating: CoatingType) => void;
  setTotal: (cents: number) => void;
  reset: () => void;

  getLensConfig: () => LensConfig | null;
}

const initialState = {
  step: 1 as FunnelStep,
  frameId: null,
  variantId: null,
  framePriceCents: 0,
  usageType: null,
  prescription: null,
  lensIndex: null,
  coatings: [] as CoatingType[],
  totalCents: 0,
};

export const useFunnelStore = create<FunnelState>((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),
  setFrame: (frameId, variantId, priceCents) =>
    set({ frameId, variantId, framePriceCents: priceCents }),
  setUsageType: (usageType) => set({ usageType }),
  setPrescription: (prescription) => set({ prescription }),
  setLensIndex: (lensIndex) => set({ lensIndex }),
  toggleCoating: (coating) =>
    set((state) => ({
      coatings: state.coatings.includes(coating)
        ? state.coatings.filter((c) => c !== coating)
        : [...state.coatings, coating],
    })),
  setTotal: (totalCents) => set({ totalCents }),
  reset: () => set(initialState),

  getLensConfig: (): LensConfig | null => {
    const { usageType, lensIndex, coatings } = get();
    if (!usageType || !lensIndex) return null;
    return {
      usage_type: usageType,
      index: lensIndex,
      coatings,
      price_modifier_cents: 0, // will be populated after server-side compute
    };
  },
}));
