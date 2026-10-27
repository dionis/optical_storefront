import { cleanText, nextEstablishmentCode } from "../src/lib/establishments";

describe("nextEstablishmentCode", () => {
  it("starts at Op1", () => {
    expect(nextEstablishmentCode([])).toBe("Op1");
  });

  it("is one past the highest code ever used, so codes are never reused", () => {
    // Op2 was deactivated/deleted: a new store must not inherit its receipts.
    expect(nextEstablishmentCode(["Op1", "Op3"])).toBe("Op4");
  });

  it("orders numerically, not as text", () => {
    expect(nextEstablishmentCode(["Op9", "Op10"])).toBe("Op11");
  });

  it("ignores codes that are not Op<number>", () => {
    expect(nextEstablishmentCode(["WEB", "op7", "Op1x"])).toBe("Op1");
  });
});

describe("cleanText", () => {
  it("trims, caps and turns empty into null", () => {
    expect(cleanText("  Tienda  ", 80)).toBe("Tienda");
    expect(cleanText("   ", 80)).toBeNull();
    expect(cleanText(42, 80)).toBeNull();
    expect(cleanText("abcdef", 3)).toBe("abc");
  });
});
