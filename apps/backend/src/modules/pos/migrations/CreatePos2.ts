import { Migration } from "@mikro-orm/migrations";

/**
 * Point of sale, aligned with the agreed documents:
 *
 *  - pos_terminal: one or more tills per store, Op2-POS1 (HU-80, HU-86).
 *  - pos_tray: physical trays the lenses travel in, Op2-163. A tray is taken
 *    by a sale and released on delivery; the number is the lowest free one.
 *  - pos_setting: one row — discount limits per role (HU-16) and the optical
 *    change thresholds (HU-123), both set by the owner or a superadmin.
 *  - payment methods get what the document asks to configure (HU-111/112):
 *    English label, kind, fee, counts-as-cash, stores where accepted and the
 *    reference data asked at checkout.
 *  - sales get till, deposit/balance, discount, tray, promised date, delivery
 *    and void fields; payments become a ledger (deposit | balance | refund).
 *  - insurance_claim: the insurer's part of a sale, pending until paid (HU-113/114).
 */
export class CreatePos2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS pos_terminal (
        id                TEXT PRIMARY KEY,
        establishment_id  TEXT NOT NULL,
        code              TEXT NOT NULL,
        name              TEXT,
        receipt_locale    TEXT NOT NULL DEFAULT 'es',
        ticket_locale     TEXT NOT NULL DEFAULT 'en',
        printer           JSONB,
        is_active         BOOLEAN NOT NULL DEFAULT TRUE,
        created_by        TEXT,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pos_terminal_code_unique" ON "pos_terminal" ("code");`);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS pos_tray (
        id                TEXT PRIMARY KEY,
        establishment_id  TEXT NOT NULL,
        number            INTEGER NOT NULL,
        sale_id           TEXT NOT NULL,
        assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        released_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // A number is held by one sale at a time; released trays are reused.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pos_tray_in_use" ON "pos_tray" ("establishment_id", "number") WHERE released_at IS NULL AND deleted_at IS NULL;`);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS pos_setting (
        id                  TEXT PRIMARY KEY,
        discount_limits     JSONB,
        optical_thresholds  JSONB,
        updated_by          TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      );
    `);

    this.addSql(`ALTER TABLE pos_payment_method ADD COLUMN IF NOT EXISTS label_en TEXT;`);
    this.addSql(`ALTER TABLE pos_payment_method ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'other';`);
    this.addSql(`ALTER TABLE pos_payment_method ADD COLUMN IF NOT EXISTS fee_pct REAL NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE pos_payment_method ADD COLUMN IF NOT EXISTS fee_fixed_cents INTEGER NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE pos_payment_method ADD COLUMN IF NOT EXISTS counts_as_cash BOOLEAN NOT NULL DEFAULT FALSE;`);
    this.addSql(`ALTER TABLE pos_payment_method ADD COLUMN IF NOT EXISTS establishment_ids JSONB;`);
    this.addSql(`ALTER TABLE pos_payment_method ADD COLUMN IF NOT EXISTS reference_fields JSONB;`);
    // The seeded five, with the data the document asks for at checkout.
    this.addSql(`UPDATE pos_payment_method SET kind = 'cash', counts_as_cash = TRUE WHERE id = 'pospm_cash';`);
    this.addSql(`UPDATE pos_payment_method SET kind = 'debit', reference_fields = '[{"key":"last4","required":false},{"key":"auth_no","required":false}]' WHERE id = 'pospm_debit';`);
    this.addSql(`UPDATE pos_payment_method SET kind = 'credit', reference_fields = '[{"key":"last4","required":false},{"key":"auth_no","required":false}]' WHERE id = 'pospm_credit';`);
    this.addSql(`UPDATE pos_payment_method SET kind = 'zelle', reference_fields = '[{"key":"confirmation","required":true},{"key":"sender","required":false}]' WHERE id = 'pospm_zelle';`);
    this.addSql(`UPDATE pos_payment_method SET kind = 'insurance', reference_fields = '[{"key":"payer","required":true},{"key":"member_id","required":true},{"key":"authorization_no","required":false}]' WHERE id = 'pospm_insurance';`);

    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS terminal_id TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS seller_code TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS idempotency_key TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS list_cents INTEGER;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS discount_pct REAL NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS discount_approval_id TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS paid_cents INTEGER NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS insurance_cents INTEGER NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS balance_cents INTEGER NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS tray_number INTEGER;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS promised_on TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS delivery TEXT NOT NULL DEFAULT 'pickup';`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS voided_by TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS void_reason TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS void_note TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS void_requested_by TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS void_requested_at TIMESTAMPTZ;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pos_sale_idempotency" ON "pos_sale" ("idempotency_key") WHERE idempotency_key IS NOT NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_sale_customer" ON "pos_sale" ("customer_id", "created_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_sale_seller" ON "pos_sale" ("seller_id", "created_at");`);

    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'deposit';`);
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS establishment_id TEXT;`);
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS received_by TEXT;`);
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS fee_cents INTEGER NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS counts_as_cash BOOLEAN NOT NULL DEFAULT FALSE;`);
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS details JSONB;`);
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS cash_session_id TEXT;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_sale_payment_store" ON "pos_sale_payment" ("establishment_id", "created_at");`);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS insurance_claim (
        id                TEXT PRIMARY KEY,
        sale_id           TEXT NOT NULL,
        order_id          TEXT,
        establishment_id  TEXT NOT NULL,
        payer_name        TEXT NOT NULL,
        member_id         TEXT,
        authorization_no  TEXT,
        covered_cents     INTEGER NOT NULL,
        status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'paid', 'rejected')),
        paid_cents        INTEGER,
        paid_at           TIMESTAMPTZ,
        note              TEXT,
        created_by        TEXT,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_insurance_claim_status" ON "insurance_claim" ("status", "establishment_id");`);

    // A discount above the seller's limit, or under the minimum price, waiting
    // for the owner or a superadmin (HU-16, HU-26). Bound to the exact quote it
    // was asked for: the sale must use the same list total and percentage.
    this.addSql(`
      CREATE TABLE IF NOT EXISTS discount_approval (
        id                TEXT PRIMARY KEY,
        establishment_id  TEXT NOT NULL,
        terminal_id       TEXT,
        requested_by      TEXT NOT NULL,
        discount_pct      REAL NOT NULL,
        limit_pct         REAL,
        below_minimum     BOOLEAN NOT NULL DEFAULT FALSE,
        list_cents        INTEGER NOT NULL,
        total_cents       INTEGER NOT NULL,
        lines             JSONB,
        reason            TEXT,
        status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'expired')),
        decided_by        TEXT,
        decided_at        TIMESTAMPTZ,
        decision_note     TEXT,
        expires_at        TIMESTAMPTZ NOT NULL,
        sale_id           TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discount_approval_status" ON "discount_approval" ("status", "created_at");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS discount_approval;`);
    this.addSql(`DROP TABLE IF EXISTS insurance_claim;`);
    this.addSql(`DROP TABLE IF EXISTS pos_setting;`);
    this.addSql(`DROP TABLE IF EXISTS pos_tray;`);
    this.addSql(`DROP TABLE IF EXISTS pos_terminal;`);
  }
}
