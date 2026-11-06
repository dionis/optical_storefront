/**
 * Who the owner is and how ownership changes hands. Every dependency is a stub:
 * the user module, the auth check and the profile row.
 */
const profile = { owner_user_id: null as string | null };
const saved: Array<Record<string, unknown>> = [];
const assignments: Array<Record<string, unknown>> = [];
const audits: Array<Record<string, unknown>> = [];
const mails: Array<{ to: string; subject: string }> = [];

jest.mock("../src/lib/tenant-profile", () => ({
  explicitOwnerId: async () => profile.owner_user_id,
  saveTenantProfile: async (_c: unknown, patch: Record<string, unknown>) => {
    saved.push(patch);
    if ("owner_user_id" in patch) profile.owner_user_id = patch.owner_user_id as string;
    return profile;
  },
}));
jest.mock("../src/lib/audit", () => ({
  recordAudit: async (_c: unknown, input: Record<string, unknown>) => {
    audits.push(input);
  },
}));
jest.mock("../src/lib/staff-profile-data", () => ({
  accessStatusByUser: async (_c: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { disabled_at: id === "user_off" ? "2026-11-01T00:00:00Z" : null }])),
  profilesByUser: async () => new Map(),
}));
jest.mock("../src/lib/store-settings", () => ({ resolveStoreSettings: async () => ({ support_email: "soporte@example.com" }) }));

import { ownerUserId, invalidateStaffScope } from "../src/lib/staff-scope";
import * as staffScope from "../src/lib/staff-scope";
import { OwnerTransferError, transferOwnership } from "../src/lib/tenant-owner";

// Oldest first, as listUsers({}, { order: { created_at: "ASC" } }) returns them.
const USERS = [
  { id: "user_tech", email: "soporte@plataforma.example" },
  { id: "user_owner", email: "dueno@opticaelrancho.example" },
  { id: "user_off", email: "baja@opticaelrancho.example" },
];
const PASSWORDS: Record<string, string> = { "soporte@plataforma.example": "tech-pass", "dueno@opticaelrancho.example": "owner-pass" };

function container() {
  const services: Record<string, unknown> = {
    user: {
      listUsers: async (filter: { id?: string }) => (filter.id ? USERS.filter((u) => u.id === filter.id) : USERS),
      retrieveUser: async (id: string) => {
        const u = USERS.find((x) => x.id === id);
        if (!u) throw new Error("not found");
        return u;
      },
    },
    auth: {
      authenticate: async (_p: string, { body }: { body: { email: string; password: string } }) => ({
        success: PASSWORDS[body.email] === body.password,
      }),
    },
    notification: {
      createNotifications: async (n: { to: string; content: { subject: string } }) => {
        mails.push({ to: n.to, subject: n.content.subject });
      },
    },
    logger: { warn: () => undefined, error: () => undefined, info: () => undefined },
  };
  return { resolve: (key: string) => services[key] } as never;
}

beforeEach(() => {
  profile.owner_user_id = null;
  saved.length = assignments.length = audits.length = mails.length = 0;
  invalidateStaffScope();
  jest.spyOn(staffScope, "writeStaffAssignment").mockImplementation(async (_c, input) => {
    assignments.push(input as unknown as Record<string, unknown>);
  });
});
afterEach(() => jest.restoreAllMocks());

describe("ownerUserId", () => {
  it("is the oldest user while the profile names nobody", async () => {
    expect(await ownerUserId(container())).toBe("user_tech");
  });

  it("is the user the profile names", async () => {
    profile.owner_user_id = "user_owner";
    expect(await ownerUserId(container())).toBe("user_owner");
  });

  it("falls back to the oldest user when the named one no longer exists", async () => {
    profile.owner_user_id = "user_deleted";
    expect(await ownerUserId(container())).toBe("user_tech");
  });
});

describe("transferOwnership", () => {
  const refuse = async (input: Parameters<typeof transferOwnership>[1]) => {
    try {
      await transferOwnership(container(), input);
    } catch (e) {
      expect(e).toBeInstanceOf(OwnerTransferError);
      return { reason: (e as OwnerTransferError).reason, status: (e as OwnerTransferError).status };
    }
    throw new Error("expected a refusal");
  };

  it("only the current owner can give it away", async () => {
    expect(await refuse({ actorId: "user_owner", targetUserId: "user_owner", password: "owner-pass" })).toEqual({ reason: "not_owner", status: 403 });
  });

  it("refuses the same user, a disabled user and a wrong password", async () => {
    expect((await refuse({ actorId: "user_tech", targetUserId: "user_tech", password: "tech-pass" })).reason).toBe("same_user");
    expect((await refuse({ actorId: "user_tech", targetUserId: "user_off", password: "tech-pass" })).reason).toBe("target_disabled");
    expect(await refuse({ actorId: "user_tech", targetUserId: "user_owner", password: "nope" })).toEqual({ reason: "bad_password", status: 401 });
    expect(saved).toEqual([]);
  });

  it("hands the store to the new owner, keeps the old one as superadmin, audits and mails both", async () => {
    const result = await transferOwnership(container(), { actorId: "user_tech", targetUserId: "user_owner", password: "tech-pass" });
    expect(result).toEqual({ owner_user_id: "user_owner" });
    expect(saved).toEqual([{ owner_user_id: "user_owner" }]);
    expect(assignments).toEqual([{ userId: "user_tech", role: "superadmin", establishmentIds: null, actorId: "user_tech" }]);
    expect(audits[0]).toMatchObject({ action: "owner.transfer", entityId: "user_owner" });
    expect(mails.map((m) => m.to).sort()).toEqual(["dueno@opticaelrancho.example", "soporte@plataforma.example"]);
    expect(await ownerUserId(container())).toBe("user_owner");
  });
});
