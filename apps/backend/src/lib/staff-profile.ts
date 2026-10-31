/**
 * Seller profile rules (HU-98 to HU-100). Pure — no I/O.
 *
 * Field groups and who sees them (functional document, "Perfil del vendedor"):
 *
 *   identity     display name, seller code           — the whole team
 *   contact      phones, alternate email, address    — admins, managers of their stores, the person
 *   preferences  alert email, language               — admins and the person
 *   work         hire date, commission, goal, privileges — admins and the person
 *   emergency    name, relation, phone               — admins only
 *   notes        internal notes                      — admins only
 *
 * "Admins" = the owner and superadmins (the owner's own permissions). The
 * person edits their contact and preferences; everything else only admins.
 */

/**
 * Privileges granted person by person, independent of the role. Approving
 * discounts is deliberately NOT one: it belongs to the owner and superadmins
 * and is not delegated (owner's decision).
 */
export const PRIVILEGES = ["costs.manage", "costs.view", "payments.manage", "sale.void", "catalog.edit"] as const;
export type Privilege = (typeof PRIVILEGES)[number];

export const CONTACT_FIELDS = ["phone_mobile", "phone_whatsapp", "phone_landline", "email_alt", "address"] as const;
export const PREFERENCE_FIELDS = ["alert_email", "locale"] as const;
export const WORK_FIELDS = ["hire_date", "commission_pct", "monthly_goal", "privileges"] as const;
export const EMERGENCY_FIELDS = ["emergency_name", "emergency_relation", "emergency_phone"] as const;
export const IDENTITY_FIELDS = ["display_name", "seller_code", "photo_url"] as const;

const SELF_EDITABLE = new Set<string>([...CONTACT_FIELDS, ...PREFERENCE_FIELDS, "photo_url"]);
const ADMIN_EDITABLE = new Set<string>([
  ...IDENTITY_FIELDS,
  ...CONTACT_FIELDS,
  ...PREFERENCE_FIELDS,
  ...WORK_FIELDS,
  ...EMERGENCY_FIELDS,
  "internal_notes",
]);

export interface StaffProfileData {
  display_name: string | null;
  seller_code: string | null;
  photo_url: string | null;
  phone_mobile: string | null;
  phone_whatsapp: string | null;
  phone_landline: string | null;
  email_alt: string | null;
  address: string | null;
  alert_email: string | null;
  locale: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
  hire_date: string | null;
  commission_pct: number | null;
  monthly_goal: number | null;
  privileges: Privilege[];
  internal_notes: string | null;
}

export const EMPTY_PROFILE: StaffProfileData = {
  display_name: null,
  seller_code: null,
  photo_url: null,
  phone_mobile: null,
  phone_whatsapp: null,
  phone_landline: null,
  email_alt: null,
  address: null,
  alert_email: null,
  locale: null,
  emergency_name: null,
  emergency_relation: null,
  emergency_phone: null,
  hire_date: null,
  commission_pct: null,
  monthly_goal: null,
  privileges: [],
  internal_notes: null,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s().-]{7,25}$/;
const CODE = /^[A-Z]{1,4}\d{1,4}$/;

const text = (v: unknown, max: number): string | null => {
  if (v === null) return null;
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s ? s : null;
};

/**
 * Validates a patch for the given editor. Fields the editor may not touch are
 * a `forbidden_field` error, not silently dropped: a form that sends them is a
 * bug worth seeing.
 */
export function cleanProfilePatch(
  patch: Record<string, unknown> | null | undefined,
  editor: "self" | "admin"
): { reason: string; field?: string } | { patch: Partial<StaffProfileData> } {
  const allowed = editor === "admin" ? ADMIN_EDITABLE : SELF_EDITABLE;
  const out: Partial<StaffProfileData> = {};
  for (const [key, raw] of Object.entries(patch ?? {})) {
    if (!allowed.has(key)) return { reason: "forbidden_field", field: key };
    switch (key) {
      case "phone_mobile":
      case "phone_whatsapp":
      case "phone_landline":
      case "emergency_phone": {
        const v = text(raw, 25);
        if (v && !PHONE.test(v)) return { reason: "bad_phone", field: key };
        out[key] = v;
        break;
      }
      case "email_alt":
      case "alert_email": {
        const v = text(raw, 200)?.toLowerCase() ?? null;
        if (v && !EMAIL.test(v)) return { reason: "bad_email", field: key };
        out[key] = v;
        break;
      }
      case "locale": {
        const v = text(raw, 5);
        if (v && v !== "es" && v !== "en") return { reason: "bad_locale", field: key };
        out.locale = v;
        break;
      }
      case "seller_code": {
        const v = text(raw, 8)?.toUpperCase() ?? null;
        if (v && !CODE.test(v)) return { reason: "bad_seller_code", field: key };
        out.seller_code = v;
        break;
      }
      case "hire_date": {
        const v = text(raw, 10);
        if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) return { reason: "bad_date", field: key };
        out.hire_date = v;
        break;
      }
      case "commission_pct": {
        if (raw === null || raw === "") { out.commission_pct = null; break; }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100) return { reason: "bad_number", field: key };
        out.commission_pct = Math.round(n * 100) / 100;
        break;
      }
      case "monthly_goal": {
        if (raw === null || raw === "") { out.monthly_goal = null; break; }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return { reason: "bad_number", field: key };
        out.monthly_goal = Math.round(n * 100) / 100;
        break;
      }
      case "privileges": {
        if (!Array.isArray(raw)) return { reason: "bad_privileges", field: key };
        const list = [...new Set(raw.map(String))];
        if (list.some((p) => !(PRIVILEGES as readonly string[]).includes(p))) return { reason: "bad_privileges", field: key };
        out.privileges = list as Privilege[];
        break;
      }
      case "photo_url": {
        if (raw === null || raw === "") { out.photo_url = null; break; }
        const v = typeof raw === "string" ? raw.trim() : "";
        if (!v) { out.photo_url = null; break; }
        // Accept base64 data URLs (camera/file upload resized on client) and https URLs.
        if (!v.startsWith("data:image/") && !/^https?:\/\/.+/i.test(v)) return { reason: "bad_photo_url", field: key };
        // Cap at 200 KB of text (a 256×256 JPEG at quality 80 encodes to ~30 KB base64).
        if (v.length > 200_000) return { reason: "photo_too_large", field: key };
        out.photo_url = v;
        break;
      }
      case "address":
      case "internal_notes":
        out[key] = text(raw, key === "internal_notes" ? 2000 : 200);
        break;
      default:
        (out as Record<string, unknown>)[key] = text(raw, 80);
    }
  }
  return { patch: out };
}

export interface Viewer {
  isAdmin: boolean;
  isSelf: boolean;
  /** A manager or supervisor who shares a store with the person. */
  managesThem: boolean;
}

/** The profile as `viewer` may see it; hidden groups are omitted, not nulled. */
export function viewProfile(p: StaffProfileData, viewer: Viewer): Partial<StaffProfileData> {
  const out: Partial<StaffProfileData> = { display_name: p.display_name, seller_code: p.seller_code, photo_url: p.photo_url };
  const pick = (keys: readonly (keyof StaffProfileData)[]) => {
    for (const k of keys) (out as Record<string, unknown>)[k] = p[k];
  };
  if (viewer.isAdmin || viewer.isSelf || viewer.managesThem) pick(CONTACT_FIELDS);
  if (viewer.isAdmin || viewer.isSelf) {
    pick(PREFERENCE_FIELDS);
    pick(WORK_FIELDS);
  }
  if (viewer.isAdmin) {
    pick(EMERGENCY_FIELDS);
    out.internal_notes = p.internal_notes;
  }
  return out;
}

/** Initials of the name plus the next free two-digit number: "Carlos Méndez" → CM01. */
export function suggestSellerCode(firstName: string | null, lastName: string | null, taken: string[]): string {
  const initial = (s: string | null) =>
    (s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z]/g, "")
      .charAt(0)
      .toUpperCase();
  const letters = (initial(firstName) + initial(lastName)) || "V";
  const used = new Set(taken.map((t) => t.toUpperCase()));
  for (let i = 1; i < 10000; i++) {
    const code = `${letters}${String(i).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
  return `${letters}${Date.now() % 10000}`;
}

/** Admins hold every privilege; others only what was granted to them. */
export function hasPrivilege(scope: { is_admin: boolean; privileges?: readonly string[] }, privilege: Privilege): boolean {
  return scope.is_admin || Boolean(scope.privileges?.includes(privilege));
}
