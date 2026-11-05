import { adminPanelUrl, passwordResetLink, renderPasswordResetEmail } from "../src/lib/email/password-reset";

describe("the password-recovery link", () => {
  const prev = process.env.ADMIN_PANEL_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_PANEL_URL;
    else process.env.ADMIN_PANEL_URL = prev;
  });

  it("points at the panel with the token and the address", () => {
    const link = passwordResetLink("ana@tienda.com", "tok.en", "https://opticaelrancho.com/admin");
    const u = new URL(link);
    expect(u.origin + u.pathname).toBe("https://opticaelrancho.com/admin");
    expect(u.searchParams.get("reset_token")).toBe("tok.en");
    expect(u.searchParams.get("email")).toBe("ana@tienda.com");
  });

  it("ADMIN_PANEL_URL wins over the storefront's /admin", () => {
    process.env.ADMIN_PANEL_URL = "https://opticaelrancho.com/admin/";
    expect(adminPanelUrl()).toBe("https://opticaelrancho.com/admin");
    delete process.env.ADMIN_PANEL_URL;
    expect(adminPanelUrl()).toMatch(/\/admin$/);
  });
});

describe("the password-recovery e-mail", () => {
  it("carries the link in both bodies and speaks the chosen language", () => {
    const es = renderPasswordResetEmail({ email: "ana@tienda.com", token: "abc", locale: "es", base: "https://x/admin" });
    expect(es.subject).toBe("Restablecer tu contraseña del panel");
    expect(es.html).toContain("reset_token=abc");
    expect(es.text).toContain("reset_token=abc");
    expect(es.html).toContain("Si no fuiste tú");
    const en = renderPasswordResetEmail({ email: "ana@tienda.com", token: "abc", locale: "en", base: "https://x/admin" });
    expect(en.subject).toBe("Reset your panel password");
    expect(en.html).not.toContain("Si no fuiste tú");
  });

  it("escapes the address (it is attacker-controlled input)", () => {
    const r = renderPasswordResetEmail({ email: "<b>x</b>@y.z", token: "abc", locale: "es", base: "https://x/admin" });
    expect(r.html).not.toContain("<b>x</b>");
  });
});
