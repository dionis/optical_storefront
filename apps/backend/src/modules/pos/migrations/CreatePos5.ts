import { Migration } from "@mikro-orm/migrations";

/**
 * Store-level cash register (owner, 2026-11): one open session per
 * establishment instead of one per till, digital signatures (initials) on the
 * opening, the close and the owner's approval of a difference, and the ledger
 * rule — every cash payment and refund becomes a `cash_movement`, so
 * expected = opening + Σ in − Σ out (lib/cash.ts).
 *
 * Idempotent: every statement tolerates having run before. Existing open
 * sessions are kept; when a store has several open at once (one per till),
 * all but the latest are closed with note `merged_store_sessions` so the new
 * unique index can be created. Cash payments already linked to a session get
 * their ledger line back-filled, so an open session's expected cash does not
 * drop when the rule changes.
 */
export class CreatePos5 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE cash_session ALTER COLUMN terminal_id DROP NOT NULL;`);
    this.addSql(`ALTER TABLE cash_session ADD COLUMN IF NOT EXISTS opened_signature TEXT;`);
    this.addSql(`ALTER TABLE cash_session ADD COLUMN IF NOT EXISTS opening_note TEXT;`);
    this.addSql(`ALTER TABLE cash_session ADD COLUMN IF NOT EXISTS closed_signature TEXT;`);
    this.addSql(`ALTER TABLE cash_session ADD COLUMN IF NOT EXISTS approval_signature TEXT;`);
    this.addSql(`ALTER TABLE cash_session ADD COLUMN IF NOT EXISTS approved_by TEXT;`);
    this.addSql(`ALTER TABLE cash_session ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;`);
    this.addSql(`ALTER TABLE cash_session ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';`);
    this.addSql(`UPDATE cash_session SET status = 'closed' WHERE closed_at IS NOT NULL AND status = 'open';`);

    this.addSql(`ALTER TABLE cash_movement ADD COLUMN IF NOT EXISTS sale_id TEXT;`);
    this.addSql(`ALTER TABLE cash_movement ADD COLUMN IF NOT EXISTS payment_id TEXT;`);
    this.addSql(`ALTER TABLE cash_movement ADD COLUMN IF NOT EXISTS terminal_id TEXT;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cash_movement_sale" ON "cash_movement" ("sale_id");`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cash_movement_payment" ON "cash_movement" ("payment_id") WHERE payment_id IS NOT NULL AND deleted_at IS NULL;`);

    // Ledger back-fill: one line per cash payment already attached to a session (refunds are negative rows → out).
    this.addSql(`
      INSERT INTO cash_movement (id, session_id, kind, amount_cents, category, note, created_by, sale_id, payment_id, terminal_id, created_at, updated_at)
      SELECT 'cashm_' || substr(md5(p.id), 1, 24),
             p.cash_session_id,
             CASE WHEN p.amount_cents < 0 THEN 'out' ELSE 'in' END,
             abs(p.amount_cents),
             CASE WHEN p.amount_cents < 0 THEN 'sale_refund' ELSE 'sale_payment' END,
             s.number, p.received_by, p.sale_id, p.id, s.terminal_id, p.created_at, p.created_at
      FROM pos_sale_payment p
      JOIN pos_sale s ON s.id = p.sale_id
      WHERE p.cash_session_id IS NOT NULL AND p.counts_as_cash AND p.deleted_at IS NULL AND p.amount_cents <> 0
        AND NOT EXISTS (SELECT 1 FROM cash_movement m WHERE m.payment_id = p.id);
    `);

    // One open session per store: close every open one but the latest, with its expected cash so nothing is lost.
    this.addSql(`
      UPDATE cash_session cs SET
        closed_at = NOW(),
        status = 'closed',
        note = 'merged_store_sessions',
        expected_cents = cs.opening_cents + COALESCE((SELECT SUM(CASE WHEN m.kind = 'in' THEN m.amount_cents ELSE -m.amount_cents END) FROM cash_movement m WHERE m.session_id = cs.id AND m.deleted_at IS NULL AND COALESCE(m.category, '') <> 'opening_float'), 0)
      WHERE cs.closed_at IS NULL AND cs.deleted_at IS NULL
        AND cs.id <> (SELECT o.id FROM cash_session o WHERE o.establishment_id = cs.establishment_id AND o.closed_at IS NULL AND o.deleted_at IS NULL ORDER BY o.opened_at DESC, o.id DESC LIMIT 1);
    `);
    this.addSql(`DROP INDEX IF EXISTS "IDX_cash_session_open";`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cash_session_open_store" ON "cash_session" ("establishment_id") WHERE closed_at IS NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cash_session_status" ON "cash_session" ("establishment_id", "status");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_cash_session_status";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_cash_session_open_store";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_cash_movement_payment";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_cash_movement_sale";`);
    this.addSql(`DELETE FROM cash_movement WHERE payment_id IS NOT NULL OR category = 'opening_float';`);
    this.addSql(`ALTER TABLE cash_movement DROP COLUMN IF EXISTS terminal_id;`);
    this.addSql(`ALTER TABLE cash_movement DROP COLUMN IF EXISTS payment_id;`);
    this.addSql(`ALTER TABLE cash_movement DROP COLUMN IF EXISTS sale_id;`);
    this.addSql(`ALTER TABLE cash_session DROP COLUMN IF EXISTS status;`);
    this.addSql(`ALTER TABLE cash_session DROP COLUMN IF EXISTS approved_at;`);
    this.addSql(`ALTER TABLE cash_session DROP COLUMN IF EXISTS approved_by;`);
    this.addSql(`ALTER TABLE cash_session DROP COLUMN IF EXISTS approval_signature;`);
    this.addSql(`ALTER TABLE cash_session DROP COLUMN IF EXISTS closed_signature;`);
    this.addSql(`ALTER TABLE cash_session DROP COLUMN IF EXISTS opening_note;`);
    this.addSql(`ALTER TABLE cash_session DROP COLUMN IF EXISTS opened_signature;`);
  }
}
