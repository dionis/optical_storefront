/**
 * Self-service password recovery (HU-03): who receives the link, what the link
 * looks like, what the mail says, and the two rate limits in front of Medusa's
 * reset routes. No container, no HTTP — every dependency is a stub.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  RESET_TOKEN_TTL_MINUTES,
  adminPanelUrl,
  buildResetLink,
  decideResetRecipient,
  handlePasswordResetEvent,
  type PasswordResetDeps,
  type ResetUser,
} from "../src/lib/password-reset";
import { renderPasswordResetEmail } from "../src/lib/email/password-reset-email";
import { AUDIT_ACTIONS } from "../src/lib/audit";
import {
  PASSWORD_RESET_REQUEST_MAX,
  PASSWORD_RESET_UPDATE_MAX,
  passwordResetRequestRateLimit,
  passwordResetUpdateRateLimit,
} from "../src/lib/security";
import middlewareConfig from "../src/api/middlewares";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.secret-token-value.sig";
const ana: ResetUser = { id: "user_ana", email: "ana@rubilens.com" };

function stubDeps(over: Partial<PasswordResetDeps> & { user?: ResetUser | null; disabled?: string | null } = {}) {
  const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
  const audited: Array<{ user: ResetUser; delivered: boolean }> = [];
  const logs: string[] = [];
  const deps: PasswordResetDeps = {
    findUserByEmail: async () => (over.user === undefined ? ana : over.user),
    disabledAt: async () => over.disabled ?? null,
    send: async (to, email) => { sent.push({ to, ...email }); },
    audit: async (user, delivered) => { audited.push({ user, delivered }); },
    log: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) } as PasswordResetDeps["log"],
    origin: "https://www.rubilens.com/",
    locale: "es",
    ...over,
  };
  return { deps, sent, audited, logs };
}

describe("buildResetLink", () => {
  it("points at the panel with the token and the email url-encoded, no double slash", () => {
    const link = buildResetLink("https://www.rubilens.com/", "a+b/c=", "ana+x@rubilens.com");
    expect(link).toBe("https://www.rubilens.com/admin?reset=a%2Bb%2Fc%3D&email=ana%2Bx%40rubilens.com");
  });
  it("keeps a panel URL that already names its path (the optician's own domain)", () => {
    expect(buildResetLink("https://opticaelrancho.com/admin/", "t", "a@b.co")).toBe("https://opticaelrancho.com/admin?reset=t&email=a%40b.co");
  });
});

describe("adminPanelUrl", () => {
  it("prefers ADMIN_PANEL_URL and otherwise the storefront's /admin", () => {
    expect(adminPanelUrl("https://www.rubilens.com/", {})).toBe("https://www.rubilens.com/admin");
    expect(adminPanelUrl("https://www.rubilens.com", { ADMIN_PANEL_URL: " https://opticaelrancho.com/admin/ " })).toBe("https://opticaelrancho.com/admin");
    expect(adminPanelUrl("https://www.rubilens.com", { ADMIN_PANEL_URL: "" })).toBe("https://www.rubilens.com/admin");
  });
});

describe("decideResetRecipient", () => {
  it("sends to an active panel user, at the login email", () => {
    expect(decideResetRecipient({ actorType: "user", user: ana, disabledAt: null })).toEqual({ send: true, to: ana.email, user: ana });
  });
  it("ignores other actor types (a customer identity never opens the panel)", () => {
    expect(decideResetRecipient({ actorType: "customer", user: ana, disabledAt: null }).send).toBe(false);
  });
  it("sends nothing when no panel user carries that email", () => {
    expect(decideResetRecipient({ actorType: "user", user: null, disabledAt: null })).toMatchObject({ send: false, reason: "no_user" });
  });
  it("sends nothing to a deactivated person", () => {
    expect(decideResetRecipient({ actorType: "user", user: ana, disabledAt: "2026-11-01T00:00:00Z" })).toMatchObject({ send: false, reason: "disabled" });
  });
});

describe("handlePasswordResetEvent", () => {
  const event = { entity_id: ana.email, actor_type: "user", token: TOKEN };

  it("mails the link to the user and audits the request without the token", async () => {
    const { deps, sent, audited, logs } = stubDeps();
    const decision = await handlePasswordResetEvent(deps, event);
    expect(decision.send).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ana.email);
    expect(sent[0].html).toContain(`/admin?reset=${encodeURIComponent(TOKEN)}&amp;email=ana%40rubilens.com`);
    expect(sent[0].text).toContain(`/admin?reset=${encodeURIComponent(TOKEN)}&email=ana%40rubilens.com`);
    expect(audited).toEqual([{ user: ana, delivered: true }]);
    expect(logs.join("\n")).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain("secret-token-value");
  });

  it("skips a deactivated user silently (info log, audit, no mail)", async () => {
    const { deps, sent, audited, logs } = stubDeps({ disabled: "2026-11-01T00:00:00Z" });
    const decision = await handlePasswordResetEvent(deps, event);
    expect(decision).toMatchObject({ send: false, reason: "disabled" });
    expect(sent).toHaveLength(0);
    expect(audited).toEqual([{ user: ana, delivered: false }]);
    expect(logs.some((l) => l.includes("deactivated"))).toBe(true);
  });

  it("does nothing for a customer reset or an unknown email", async () => {
    const a = stubDeps();
    expect((await handlePasswordResetEvent(a.deps, { ...event, actor_type: "customer" })).send).toBe(false);
    expect(a.sent).toHaveLength(0);
    expect(a.audited).toHaveLength(0);
    const b = stubDeps({ user: null });
    expect((await handlePasswordResetEvent(b.deps, event)).send).toBe(false);
    expect(b.sent).toHaveLength(0);
    expect(b.audited).toHaveLength(0);
  });

  it("fails closed when the access status cannot be read", async () => {
    const { deps, sent } = stubDeps({ disabledAt: async () => { throw new Error("db down"); } });
    expect((await handlePasswordResetEvent(deps, event)).send).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("never throws when the provider fails, and still audits", async () => {
    const { deps, audited, logs } = stubDeps({ send: async () => { throw new Error("resend 500"); } });
    await expect(handlePasswordResetEvent(deps, event)).resolves.toMatchObject({ send: true });
    expect(audited).toEqual([{ user: ana, delivered: true }]);
    expect(logs.some((l) => l.includes("resend 500"))).toBe(true);
  });

  it("is an audit action the panel can filter by", () => {
    expect(AUDIT_ACTIONS).toContain("password.reset_requested");
  });
});

describe("renderPasswordResetEmail", () => {
  const data = { email: "ana@rubilens.com", link: "https://www.rubilens.com/admin?reset=t&email=ana%40rubilens.com", minutes: RESET_TOKEN_TTL_MINUTES };

  it("says who asked, how long the link lasts and what to do if it was not you — in Spanish", () => {
    const es = renderPasswordResetEmail(data, "es");
    expect(es.subject).toContain("Restablecer");
    expect(es.html).toContain("ana@rubilens.com");
    expect(es.html).toContain("15 minutos");
    expect(es.html).toContain("Si no fuiste tú");
    expect(es.html).toContain(`href="${data.link.replace(/&/g, "&amp;")}"`);
    expect(es.text).toContain(data.link);
    expect(es.text).toContain("15 minutos");
  });

  it("and in English", () => {
    const en = renderPasswordResetEmail(data, "en");
    expect(en.subject).toContain("Reset your");
    expect(en.html).toContain("15 minutes");
    expect(en.html).toContain("If it was not you");
    expect(en.html).not.toContain("Si no fuiste");
  });
});

// ── Rate limits ───────────────────────────────────────────────────────────────
function req(over: Partial<{ ip: string; body: unknown }> = {}): MedusaRequest {
  return { ip: over.ip ?? "203.0.113.7", headers: {}, body: over.body ?? {}, socket: { remoteAddress: over.ip ?? "203.0.113.7" } } as unknown as MedusaRequest;
}
function res() {
  const out = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader() {},
    status(code: number) { out.statusCode = code; return out; },
    json(payload: unknown) { out.body = payload; return out; },
  };
  return out as unknown as MedusaResponse & { statusCode: number };
}

describe("password reset rate limits", () => {
  beforeEach(() => { passwordResetRequestRateLimit.reset(); passwordResetUpdateRateLimit.reset(); });

  it("allows 5 reset requests per IP, then 429", () => {
    let passed = 0;
    let r = res();
    for (let i = 0; i <= PASSWORD_RESET_REQUEST_MAX; i++) {
      r = res();
      passwordResetRequestRateLimit(req({ body: { identifier: `u${i}@x.com` } }), r, () => passed++);
    }
    expect(passed).toBe(PASSWORD_RESET_REQUEST_MAX);
    expect(r.statusCode).toBe(429);
  });

  it("also caps one identifier asked from many IPs (case-insensitive)", () => {
    let passed = 0;
    let r = res();
    for (let i = 0; i <= PASSWORD_RESET_REQUEST_MAX; i++) {
      r = res();
      passwordResetRequestRateLimit(req({ ip: `10.0.0.${i}`, body: { identifier: i % 2 ? "Ana@Rubilens.com" : "ana@rubilens.com" } }), r, () => passed++);
    }
    expect(passed).toBe(PASSWORD_RESET_REQUEST_MAX);
    expect(r.statusCode).toBe(429);
  });

  it("allows 10 token submissions per IP, then 429", () => {
    let passed = 0;
    let r = res();
    for (let i = 0; i <= PASSWORD_RESET_UPDATE_MAX; i++) {
      r = res();
      passwordResetUpdateRateLimit(req({ body: { email: "ana@rubilens.com", password: "x" } }), r, () => passed++);
    }
    expect(passed).toBe(PASSWORD_RESET_UPDATE_MAX);
    expect(r.statusCode).toBe(429);
  });

  it("are registered on Medusa's reset routes, and the register route stays closed", () => {
    const routes = (middlewareConfig.routes ?? []) as Array<{ matcher: string; method?: string[]; middlewares?: unknown[] }>;
    const byMatcher = (m: string) => routes.find((r) => r.matcher === m);
    expect(byMatcher("/auth/user/emailpass/reset-password")?.middlewares).toContain(passwordResetRequestRateLimit);
    expect(byMatcher("/auth/user/emailpass/update")?.middlewares).toContain(passwordResetUpdateRateLimit);
    expect(byMatcher("/auth/user/emailpass/register")?.middlewares?.length).toBeGreaterThan(0);
  });
});
