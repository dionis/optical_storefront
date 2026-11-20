import { addressLink, resolveAddressSave } from "../src/lib/seller-address";

const save = (own: string | null, other: string | null, next: string | null | undefined, extra: { separate?: boolean; choice?: "this" | "other" | "separate" } = {}) =>
  resolveAddressSave({ own, other, next, separate: extra.separate ?? false, choice: extra.choice ?? null });

/** One address in two places: the system syncs what it can and never picks between two different ones. */
describe("one address for a person who sells", () => {
  it("fills the empty place", () => {
    expect(save(null, null, "A")).toMatchObject({ own: "A", other: "A", conflict: false });
    expect(save(null, "A", "B")).toMatchObject({ own: "B", other: "B", conflict: false });
    expect(save("A", null, "B")).toMatchObject({ own: "B", other: "B", conflict: false });
  });

  it("keeps them together when they were the same", () => {
    expect(save("A", "a ", "B")).toMatchObject({ own: "B", other: "B", conflict: false });
  });

  it("clearing one clears the address, not half of it", () => {
    expect(save("A", "A", "")).toMatchObject({ own: null, other: null, conflict: false });
    expect(save(null, "A", "")).toMatchObject({ own: null, other: null, conflict: false });
  });

  it("never chooses between two different addresses", () => {
    const r = save("A", "B", "C");
    expect(r.conflict).toBe(true);
    expect(r).toMatchObject({ own: "A", other: "B" });
  });

  it("a new value equal to the other one settles it", () => {
    expect(save("A", "B", "b")).toMatchObject({ own: "b", other: "b", conflict: false });
  });

  it("saving something else in the form does not ask, even if they differ", () => {
    expect(save("A", "B", "A")).toMatchObject({ own: "A", other: "B", conflict: false, separate: false });
    expect(save("A", "B", undefined)).toMatchObject({ own: "A", other: "B", conflict: false });
  });

  it("does what the person chose", () => {
    expect(save("A", "B", "C", { choice: "this" })).toEqual({ own: "C", other: "C", separate: false, conflict: false });
    expect(save("A", "B", "C", { choice: "other" })).toEqual({ own: "B", other: "B", separate: false, conflict: false });
    expect(save("A", "B", "C", { choice: "separate" })).toEqual({ own: "C", other: "B", separate: true, conflict: false });
  });

  it("two kept on purpose: never asks again, and never touches the other", () => {
    expect(save("A", "B", "C", { separate: true })).toEqual({ own: "C", other: "B", separate: true, conflict: false });
    expect(save(null, "B", "C", { separate: true })).toEqual({ own: "C", other: "B", separate: true, conflict: false });
    expect(save("A", "B", "A", { separate: true, choice: "this" })).toEqual({ own: "A", other: "A", separate: false, conflict: false });
  });
});

describe("how the two places stand", () => {
  it("shows one address while it is one", () => {
    expect(addressLink(null, "A", false)).toEqual({ state: "single", address: "A", other: null });
    expect(addressLink("A", null, false)).toEqual({ state: "single", address: "A", other: null });
    expect(addressLink("A", " a", false)).toEqual({ state: "single", address: "A", other: null });
    expect(addressLink(null, null, false)).toEqual({ state: "single", address: null, other: null });
  });

  it("flags two different ones", () => {
    expect(addressLink("A", "B", false)).toEqual({ state: "conflict", address: "A", other: "B" });
  });

  it("does not borrow an address across when kept separate", () => {
    expect(addressLink(null, "B", true)).toEqual({ state: "separate", address: null, other: "B" });
  });
});
