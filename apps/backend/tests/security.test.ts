import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { createRateLimit } from "../src/lib/rate-limit";
import {
  ADMIN_LOGIN_MAX,
  SECURITY_HEADERS,
  adminLoginRateLimit,
  blockAdminSelfRegister,
  securityAudit,
  securityHeaders,
} from "../src/lib/security";
import middlewareConfig from "../src/api/middlewares";

/** Minimal req/res doubles — enough for the middlewares under test. */
function req(over: Partial<{ ip: string; body: unknown; headers: Record<string, string> }> = {}): MedusaRequest {
  return {
    ip: over.ip ?? "203.0.113.7",
    headers: over.headers ?? {},
    body: over.body ?? {},
    socket: { remoteAddress: over.ip ?? "203.0.113.7" },
  } as unknown as MedusaRequest;
}

function res() {
  const headers: Record<string, string> = {};
  const out = {
    statusCode: 200,
    body: undefined as unknown,
    headers,
    setHeader(k: string, v: string) { headers[k] = v; },
    getHeader(k: string) { return headers[k]; },
    status(code: number) { out.statusCode = code; return out; },
    json(payload: unknown) { out.body = payload; return out; },
  };
  return out as unknown as MedusaResponse & { statusCode: number; body: unknown; headers: Record<string, string> };
}

describe("createRateLimit", () => {
  it("lets `max` hits through per key and window, then answers 429 with Retry-After", () => {
    let t = 1_000_000;
    const limit = createRateLimit({ name: "t", windowMs: 60_000, max: 3, now: () => t });
    const calls: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = res();
      limit(req(), r, () => calls.push(i));
      if (i < 3) expect(r.statusCode).toBe(200);
      else {
        expect(r.statusCode).toBe(429);
        expect(Number(r.headers["Retry-After"])).toBeGreaterThan(0);
        expect((r.body as { reason: string }).reason).toBe("too_many_requests");
      }
    }
    expect(calls).toEqual([0, 1, 2]);
    expect(limit.count("ip:203.0.113.7")).toBe(3);

    // The window slides: a minute later the same client is welcome again.
    t += 60_001;
    const r = res();
    let passed = false;
    limit(req(), r, () => { passed = true; });
    expect(passed).toBe(true);
  });

  it("meters the LAST X-Forwarded-For entry (the one the proxy vouches for)", () => {
    const limit = createRateLimit({ name: "xff", windowMs: 60_000, max: 1 });
    const spoof = (fake: string) => req({ headers: { "x-forwarded-for": `${fake}, 198.51.100.9` } });
    let passed = 0;
    limit(spoof("1.1.1.1"), res(), () => passed++);
    limit(spoof("2.2.2.2"), res(), () => passed++); // rotating the first entry must not help
    expect(passed).toBe(1);
  });

  it("honours an env override for the ceiling", () => {
    process.env.T_LIMIT = "1";
    const limit = createRateLimit({ name: "env", windowMs: 60_000, max: 50, maxEnv: "T_LIMIT" });
    let passed = 0;
    limit(req(), res(), () => passed++);
    const r = res();
    limit(req(), r, () => passed++);
    delete process.env.T_LIMIT;
    expect(passed).toBe(1);
    expect(r.statusCode).toBe(429);
  });
});

describe("adminLoginRateLimit", () => {
  beforeEach(() => adminLoginRateLimit.reset());

  it("blocks the 11th password attempt from one IP within the window", () => {
    let passed = 0;
    let r = res();
    for (let i = 0; i < ADMIN_LOGIN_MAX + 1; i++) {
      r = res();
      adminLoginRateLimit(req({ body: { email: `u${i}@x.com`, password: "p" } }), r, () => passed++);
    }
    expect(passed).toBe(ADMIN_LOGIN_MAX);
    expect(r.statusCode).toBe(429);
  });

  it("also blocks one email attacked from many IPs", () => {
    let passed = 0;
    let r = res();
    for (let i = 0; i < ADMIN_LOGIN_MAX + 1; i++) {
      r = res();
      adminLoginRateLimit(req({ ip: `10.0.0.${i}`, body: { email: "owner@rubilens.com", password: "p" } }), r, () => passed++);
    }
    expect(passed).toBe(ADMIN_LOGIN_MAX);
    expect(r.statusCode).toBe(429);
  });
});

describe("blockAdminSelfRegister", () => {
  afterEach(() => { delete process.env.ADMIN_SELF_REGISTER; });

  it("answers 404 by default and never calls next", () => {
    const r = res();
    let passed = false;
    blockAdminSelfRegister(req(), r, () => { passed = true; });
    expect(passed).toBe(false);
    expect(r.statusCode).toBe(404);
  });

  it("opens the route only with ADMIN_SELF_REGISTER=1", () => {
    process.env.ADMIN_SELF_REGISTER = "1";
    let passed = false;
    blockAdminSelfRegister(req(), res(), () => { passed = true; });
    expect(passed).toBe(true);
  });
});

describe("securityHeaders", () => {
  it("sets every header once and keeps a header a route already set", () => {
    const r = res();
    r.setHeader("X-Frame-Options", "SAMEORIGIN");
    let passed = false;
    securityHeaders(req(), r, () => { passed = true; });
    expect(passed).toBe(true);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (k === "X-Frame-Options") expect(r.headers[k]).toBe("SAMEORIGIN");
      else expect(r.headers[k]).toBe(v);
    }
    expect(r.headers["Strict-Transport-Security"]).toMatch(/max-age=31536000/);
  });

  it("is registered for every route, before anything else", () => {
    const first = (middlewareConfig.routes ?? [])[0] as { matcher: string; middlewares?: unknown[] };
    expect(first.matcher).toBe("/*");
    expect(first.middlewares?.[0]).toBe(securityHeaders);
  });
});

describe("securityAudit", () => {
  const strong = "x".repeat(32);
  const good: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    JWT_SECRET: strong, COOKIE_SECRET: strong, ORDER_ACCESS_SECRET: strong, VISION_INTERNAL_SECRET: strong,
    R2_PRESCRIPTION_BUCKET: "rx", SECURITY_STRICT: "1",
    STORE_CORS: "https://www.rubilens.com,https://rubilens.com",
    STOREFRONT_URL: "https://www.rubilens.com", BACKEND_URL: "https://api.rubilens.com",
    STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc",
    RESEND_API_KEY: "re_x", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1",
    GSHEET_FILE_URL: "u", GSHEET_SERVICE_ACCOUNT_EMAIL: "e", GSHEET_SERVICE_ACCOUNT_KEY: "k", ANTHROPIC_API_KEY: "a",
  };

  it("passes a fully hardened environment", () => {
    const audit = securityAudit(good, () => new Date("2026-10-22T00:00:00Z"));
    expect(audit.failing).toBe(0);
    expect(audit.checks.find((c) => c.key === "payments.stripe_mode")?.detail).toBe("live");
  });

  it("flags default secrets, test Stripe, http origins and missing providers — without leaking values", () => {
    const audit = securityAudit({
      ...good,
      JWT_SECRET: "change-me-in-production",
      STRIPE_SECRET_KEY: "sk_test_123",
      STORE_CORS: "https://www.rubilens.com,http://localhost:5198",
      TWILIO_ACCOUNT_SID: "",
      ADMIN_SELF_REGISTER: "1",
    });
    const failing = audit.checks.filter((c) => !c.ok).map((c) => c.key);
    expect(failing).toEqual(expect.arrayContaining([
      "secret.JWT_SECRET", "payments.stripe_mode", "cors.store_https_only", "notifications.sms_provider", "auth.self_register_blocked",
    ]));
    expect(JSON.stringify(audit)).not.toContain("sk_test_123");
    expect(JSON.stringify(audit)).not.toContain(strong);
  });
});
