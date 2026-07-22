"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WishlistState {
  handles: string[];
  add: (handle: string) => void;
  remove: (handle: string) => void;
  toggle: (handle: string) => void;
  has: (handle: string) => boolean;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      handles: [],
      add: (handle) =>
        set((s) => (s.handles.includes(handle) ? s : { handles: [...s.handles, handle] })),
      remove: (handle) =>
        set((s) => ({ handles: s.handles.filter((h) => h !== handle) })),
      toggle: (handle) =>
        set((s) =>
          s.handles.includes(handle)
            ? { handles: s.handles.filter((h) => h !== handle) }
            : { handles: [...s.handles, handle] }
        ),
      has: (handle) => get().handles.includes(handle),
    }),
    { name: "eyewear-wishlist" }
  )
);
