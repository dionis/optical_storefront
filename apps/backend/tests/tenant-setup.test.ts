/**
 * Phase 3 of the multi-tenant module: the "Primeros pasos" checklist, the
 * activation mail and the bootstrap that hands a new store to its owner.
 */
const profile = { owner_user_id: null as string | null, setup_completed_at: "2026-11-01T00:00:00Z" as string | null };
const saved: Array<Record<string, unknown>> = [];
const audits: Array<Record<string, unknown>> = [];
const mails: Array<{ to: string; subject: string; text: string }> = [];

jest.mock("../src/lib/tenant-profile", () => ({
  readTenantProfile: async () => ({ ...profile }),
  saveTenantProfile: async (_c: unknown, patch: Record<string, unknown>) => {
    saved.push(patch);
    if ("owner_user_id" in patch) profile.owner_user_id = patch.owner_user_id as string;
    if ("setup_completed" in patch) profile.setup_completed_at = patch.setup_completed ? "now" : null;
    return profile;
  },
}));
jest.mock("../src/lib/audit", () => ({
  recordAudit: async (_c: unknown, input: Record<string, unknown>) => {
    audits.push(input);
  },
}));
jest.mock("../src/lib/store-settings", () => ({ resolveStoreSettings: async () => ({ support_email: "soporte@example.com" }) }));

import { buildSetupChecklist, profileComplete, tenantSecurityChecks, type SetupFacts } from "../src/lib/tenant-setup";
import { buildActivationLink, renderOwnerActivationEmail } from "../src/lib/email/owner-activation-email";
import { bootstrapTenant, TenantBootstrapError } from "../src/lib/tenant-bootstrap";
import type { TenantProfileView } from "../src/lib/tenant-profile";

const view = (over: Partial<TenantProfileView> = {}): TenantProfileView => ({
  display_name: "Óptica Demo",
  legal_name: null,
  support_phone: "+1 713 555 0100",
  whatsapp: null,
  social: {},
  pickup: { enabled: false, name: null, address: null, hours: {}, maps_url: null },
  brand: null,
  brand_previous: null,
  owner_user_id: "user_owner",
  setup_completed_at: null,
  updated_by: null,
  updated_at: null,
  ...over,
});

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  profile: view(),
  notifyEmails: 1,
  lensPrices: 40,
  establishments: 1,
  users: 2,
  ownerExplicit: true,
  securityFailing: 0,
  sales: 1,
  ...over,
});

describe("buildSetupChecklist", () => {
  it("has nothing pending for a store that is ready", () => {
    const c = buildSetupChecklist(facts());
    expect(c.pending).toBe(0);
    expect(c.steps.map((s) => s.key)).toEqual(["profile", "notifications", "pickup", "prices", "stores", "team", "owner", "security", "test_sale"]);
  });

  it("names the tab that fixes each pending step", () => {
    const c = buildSetupChecklist(facts({ users: 1, sales: 0, ownerExplicit: false }));
    const pending = c.steps.filter((s) => s.ok === false).map((s) => [s.key, s.tab]);
    expect(pending).toEqual([["team", "team"], ["owner", "team"], ["test_sale", "pos"]]);
    expect(c.pending).toBe(3);
  });

  it("shows a failed read as unknown, never as done or pending", () => {
    const c = buildSetupChecklist(facts({ lensPrices: null, profile: null }));
    expect(c.steps.find((s) => s.key === "prices")?.ok).toBeNull();
    expect(c.steps.find((s) => s.key === "profile")?.ok).toBeNull();
    expect(c.pending).toBe(0);
  });

  it("counts pickup as decided when it is explicitly off, pending while never set", () => {
    expect(buildSetupChecklist(facts()).steps.find((s) => s.key === "pickup")?.ok).toBe(true);
    expect(buildSetupChecklist(facts({ profile: view({ pickup: null }) })).steps.find((s) => s.key === "pickup")?.ok).toBe(false);
  });
});

describe("profileComplete", () => {
  it("needs a name and a phone or WhatsApp", () => {
    expect(profileComplete(view())).toBe(true);
    expect(profileComplete(view({ support_phone: null, whatsapp: "+1 713 555 0101" }))).toBe(true);
    expect(profileComplete(view({ support_phone: null }))).toBe(false);
    expect(profileComplete(view({ display_name: " " }))).toBe(false);
    expect(profileComplete(null)).toBeNull();
  });
});

describe("tenantSecurityChecks", () => {
  it("adds the three tenant items and leaves out what could not be read", () => {
    expect(tenantSecurityChecks(facts()).map((c) => [c.key, c.ok])).toEqual([
      ["tenant.profile", true],
      ["tenant.owner_explicit", true],
      ["tenant.setup_completed", false],
    ]);
    expect(tenantSecurityChecks(facts({ profile: null, ownerExplicit: null }))).toEqual([]);
  });
});

describe("activation mail", () => {
  it("links to /admin?activate=<email> on the store origin", () => {
    expect(buildActivationLink("https://opticademo.example/", "Dueño+1@x.com")).toBe("https://opticademo.example/admin?activate=Due%C3%B1o%2B1%40x.com");
  });

  it("carries the link and no password or token", () => {
    const m = renderOwnerActivationEmail({ link: "https://opticademo.example/admin?activate=a%40b.com", support: null }, "es");
    expect(m.text).toContain("https://opticademo.example/admin?activate=a%40b.com");
    expect(m.html).toContain("Activar mi cuenta");
    expect(`${m.html}${m.text}`).not.toMatch(/contraseña:|password:|token=|reset=/i);
  });
});

// ── bootstrap ────────────────────────────────────────────────────────────────
const USERS: Array<{ id: string; email: string }> = [];
const registered: string[] = [];

function container() {
  const services: Record<string, unknown> = {
    user: {
      listUsers: async (filter: { id?: string; email?: string }) =>
        USERS.filter((u) => (filter.id ? u.id === filter.id : u.email === filter.email)),
      createUsers: async (data: { email: string }) => {
        const u = { id: `user_${USERS.length + 1}`, email: data.email };
        USERS.push(u);
        return u;
      },
    },
    auth: {
      register: async (_p: string, { body }: { body: { email: string; password: string } }) => {
        registered.push(body.password);
        return { success: true, authIdentity: { id: `auth_${registered.length}` } };
      },
      updateAuthIdentities: async () => undefined,
    },
    notification: {
      createNotifications: async (n: { to: string; content: { subject: string; text: string } }) => {
        mails.push({ to: n.to, subject: n.content.subject, text: n.content.text });
      },
    },
    logger: { warn: () => undefined, error: () => undefined, info: () => undefined },
  };
  return { resolve: (key: string) => services[key] } as never;
}

beforeEach(() => {
  profile.owner_user_id = null;
  profile.setup_completed_at = "2026-11-01T00:00:00Z";
  USERS.length = saved.length = audits.length = mails.length = registered.length = 0;
  USERS.push({ id: "user_tech", email: "tecnico@plataforma.example" });
  process.env.STOREFRONT_URL = "https://opticademo.example";
});

describe("bootstrapTenant", () => {
  it("changes nothing on a dry run", async () => {
    const r = await bootstrapTenant(container(), { email: "dueno@opticademo.example", confirm: false });
    expect(r).toMatchObject({ dry_run: true, user: "would_create", user_id: null, mail: "skipped" });
    expect(USERS).toHaveLength(1);
    expect(saved).toEqual([]);
    expect(mails).toEqual([]);
  });

  it("creates the owner with an unknown password, names them owner, reopens the setup and mails the link", async () => {
    const r = await bootstrapTenant(container(), { email: " Dueno@OpticaDemo.example ", confirm: true });
    expect(r).toMatchObject({ dry_run: false, user: "created", email: "dueno@opticademo.example", mail: "sent" });
    expect(profile.owner_user_id).toBe(r.user_id);
    expect(profile.setup_completed_at).toBeNull();
    expect(registered[0].length).toBeGreaterThanOrEqual(32);
    expect(audits[0]).toMatchObject({ action: "tenant.bootstrap", entityId: r.user_id });
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("dueno@opticademo.example");
    expect(mails[0].text).toContain(r.activation_link);
    expect(mails[0].text).not.toContain(registered[0]);
  });

  it("is safe to repeat for the same owner", async () => {
    await bootstrapTenant(container(), { email: "dueno@opticademo.example", confirm: true });
    const again = await bootstrapTenant(container(), { email: "dueno@opticademo.example", confirm: true });
    expect(again.user).toBe("existing");
    expect(USERS).toHaveLength(2);
  });

  it("refuses to replace an owner who is still there", async () => {
    profile.owner_user_id = "user_tech";
    await expect(bootstrapTenant(container(), { email: "otro@opticademo.example", confirm: true })).rejects.toEqual(
      new TenantBootstrapError("owner_already_set")
    );
    expect(USERS).toHaveLength(1);
  });

  it("takes over when the named owner no longer exists", async () => {
    profile.owner_user_id = "user_gone";
    const r = await bootstrapTenant(container(), { email: "dueno@opticademo.example", confirm: true });
    expect(r.previous_owner_id).toBe("user_gone");
    expect(profile.owner_user_id).toBe(r.user_id);
  });

  it("rejects a bad email before touching anything", async () => {
    await expect(bootstrapTenant(container(), { email: "nope", confirm: true })).rejects.toEqual(new TenantBootstrapError("bad_email"));
  });
});
