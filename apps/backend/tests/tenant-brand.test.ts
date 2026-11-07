/**
 * Phase 5 of the multi-tenant module: the brand the owner edits from the panel.
 */
import {
  checkLogoUpload,
  cleanBrandInput,
  contrastRatio,
  MAX_LOGO_BYTES,
  publicBrand,
  readBrand,
  recolorHtml,
  shade,
} from "../src/lib/tenant-brand";
import { setTenantOverlay } from "../src/lib/tenant";
import { BRAND, GOLD, emailLogoUrl, recolorEmail, shell } from "../src/lib/email/order-confirmation";

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`);

afterEach(() => setTenantOverlay({}));

describe("cleanBrandInput", () => {
  it("accepts colours that carry white text and normalises them", () => {
    const r = cleanBrandInput({ primary: "#1D4D3A", accent: "#C2410C", logo_url: "https://cdn.example.com/brand/logo.png", logo_mark_url: "" });
    expect(r).toEqual({ ok: true, brand: { primary: "#1d4d3a", accent: "#c2410c", logo_url: "https://cdn.example.com/brand/logo.png", logo_mark_url: null } });
  });

  it("refuses a colour white text cannot be read on, with the ratio", () => {
    const r = cleanBrandInput({ primary: "#f5d90a", accent: "#c2410c" });
    expect(r).toMatchObject({ ok: false, reason: "low_contrast", field: "primary" });
    expect((r as { ratio: number }).ratio).toBeLessThan(4.5);
  });

  it("refuses malformed colours and logo URLs that are not https or a site path", () => {
    expect(cleanBrandInput({ primary: "navy", accent: "#c2410c" })).toMatchObject({ ok: false, reason: "invalid_color", field: "primary" });
    expect(cleanBrandInput({ primary: "#1d4d3a", accent: "#c2410c", logo_url: "http://x.com/l.png" })).toMatchObject({ reason: "invalid_url" });
    expect(cleanBrandInput({ primary: "#1d4d3a", accent: "#c2410c", logo_url: "javascript:alert(1)" })).toMatchObject({ reason: "invalid_url" });
    expect(cleanBrandInput({ primary: "#1d4d3a", accent: "#c2410c", logo_url: "//evil.com/l.png" })).toMatchObject({ reason: "invalid_url" });
    expect(cleanBrandInput({ primary: "#1d4d3a", accent: "#c2410c", logo_url: "/logo-oficial.png" })).toMatchObject({ ok: true });
  });

  it("keeps the default palette valid", () => {
    expect(contrastRatio("#01326b", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastRatio("#d6123e", "#ffffff")).toBeGreaterThan(4.5);
  });
});

describe("readBrand / publicBrand", () => {
  it("ignores a malformed stored value and derives the dark shade", () => {
    expect(readBrand({ primary: "red" })).toBeNull();
    const b = readBrand({ primary: "#1D4D3A", accent: "#c2410c", logo_url: "javascript:x", updated_at: "2026-11-06T00:00:00Z" });
    expect(b).toEqual({ primary: "#1d4d3a", accent: "#c2410c", logo_url: null, logo_mark_url: null, updated_at: "2026-11-06T00:00:00Z" });
    expect(publicBrand(b)?.primary_dark).toBe(shade("#1d4d3a", 0.35));
    expect(publicBrand(null)).toBeNull();
  });
});

describe("checkLogoUpload", () => {
  it("accepts a real PNG", () => {
    expect(checkLogoUpload(dataUrl("image/png", PNG))).toMatchObject({ ok: true, ext: "png" });
  });

  it("refuses a file whose bytes do not match its type", () => {
    expect(checkLogoUpload(dataUrl("image/png", Buffer.from("GIF89a....")))).toEqual({ ok: false, reason: "bad_image" });
  });

  it("refuses other types and anything over 300 KB", () => {
    expect(checkLogoUpload(dataUrl("image/gif", Buffer.from("GIF89a")))).toEqual({ ok: false, reason: "unsupported_type" });
    expect(checkLogoUpload(dataUrl("image/png", Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)])))).toEqual({ ok: false, reason: "too_large" });
    expect(checkLogoUpload("not a data url")).toEqual({ ok: false, reason: "invalid_type" });
  });

  it("accepts a plain SVG and refuses one with anything active", () => {
    expect(checkLogoUpload(dataUrl("image/svg+xml", svg('<path d="M0 0h10v10z" fill="#1d4d3a"/>')))).toMatchObject({ ok: true, ext: "svg" });
    for (const bad of [
      "<script>alert(1)</script>",
      '<rect onload="alert(1)" width="1" height="1"/>',
      '<a href="https://evil.example"><rect width="1" height="1"/></a>',
      '<image xlink:href="https://evil.example/x.png"/>',
      "<foreignObject><div>x</div></foreignObject>",
      '<a href="javascript:alert(1)">x</a>',
    ]) {
      expect(checkLogoUpload(dataUrl("image/svg+xml", svg(bad)))).toEqual({ ok: false, reason: "unsafe_svg" });
    }
  });
});

describe("email colours", () => {
  const from = { primary: "#0b2f66", accent: "#b8921e", primarySoft: "#eef2f8", accentSoft: "#f6efd9" };
  const to = { primary: "#1d4d3a", accent: "#c2410c", primarySoft: "#aaaaaa", accentSoft: "#bbbbbb" };

  it("swaps every palette colour and nothing else", () => {
    const html = `<td style="background:#0b2f66;color:#5b6472;border-color:#B8921E">x</td><div style="background:#eef2f8">`;
    expect(recolorHtml(html, from, to)).toBe(`<td style="background:#1d4d3a;color:#5b6472;border-color:#c2410c">x</td><div style="background:#aaaaaa">`);
  });

  it("leaves emails untouched while no brand is saved, and repaints them once one is", () => {
    const plain = shell("Title", "Pre", "<p>x</p>", "es");
    expect(plain).toContain(BRAND);
    expect(recolorEmail(plain)).toBe(plain);

    setTenantOverlay({ brand: { primary: "#1d4d3a", accent: "#c2410c", logo_url: "https://cdn.example.com/brand/logo.png" } });
    const branded = shell("Title", "Pre", "<p>x</p>", "es");
    expect(branded).toContain("#1d4d3a");
    expect(branded).not.toContain(BRAND);
    expect(branded).not.toContain(GOLD);
    expect(emailLogoUrl()).toBe("https://cdn.example.com/brand/logo.png");
  });
});
