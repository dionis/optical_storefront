import { Migration } from "@mikro-orm/migrations";

/**
 * THE OPERATION LOG (owner, 15-nov-2026: «guardar el log de todas las
 * operaciones que se hagan en la base de datos con lujo de detalles para
 * auditoría»). lib/operation-log.ts reads it; docs/OPERATION-LOG.md explains it.
 *
 * Every INSERT, UPDATE, DELETE and TRUNCATE on the business tables leaves one
 * row here, written by a trigger INSIDE the same transaction as the change: a
 * change that commits is always logged, one that rolls back never is, and no
 * code path (route, job, script, a migration, someone at psql) can skip it.
 *
 *   - an UPDATE keeps only the columns that changed, before and after; one
 *     that only touched `updated_at` is not an operation and is not logged;
 *     `deleted_at` set = SOFT_DELETE, cleared = RESTORE;
 *   - who, from where and through what: the application tags each write with
 *     a comment `/*oplog:<base64url JSON>*\/` (lib/operation-log-context.ts:
 *     the user, the request id, method and route, IP and device) and the
 *     trigger reads it from `current_query()`. A write with no tag (a job, a
 *     migration, psql) is logged as `system`;
 *   - secrets are never copied (columns named like password/token/secret/
 *     hash/salt/api key → "[redacted]"), a prescription keeps which fields
 *     changed but not their values (health data), and a value longer than
 *     2,000 characters is replaced by its length.
 *
 * `oplog_attach_all()` puts the trigger on every table of the schema except
 * `oplog_skip_tables()` (Medusa's machinery, web carts, authentication, the
 * dashboards' projection and this log); the job `operation-log-maintain`
 * calls it every hour so a table a later migration creates is covered too.
 *
 * Idempotent: every statement tolerates having run before.
 */
export class CreateOperationLog2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS operation_log (
        seq              BIGSERIAL PRIMARY KEY,
        at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        txid             BIGINT NOT NULL DEFAULT txid_current(),
        table_name       TEXT NOT NULL,
        op               TEXT NOT NULL,
        row_id           TEXT,
        establishment_id TEXT,
        changed          TEXT[],
        before           JSONB,
        after            JSONB,
        actor_id         TEXT,
        actor_type       TEXT,
        actor_role       TEXT,
        source           TEXT NOT NULL DEFAULT 'system',
        request_id       TEXT,
        method           TEXT,
        route            TEXT,
        ip               TEXT,
        user_agent       TEXT,
        db_user          TEXT NOT NULL DEFAULT current_user
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_operation_log_at" ON operation_log (at DESC);`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_operation_log_table_at" ON operation_log (table_name, at DESC);`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_operation_log_actor_at" ON operation_log (actor_id, at DESC);`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_operation_log_store_at" ON operation_log (establishment_id, at DESC);`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_operation_log_row" ON operation_log (row_id);`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_operation_log_request" ON operation_log (request_id);`);

    this.addSql(`
      CREATE OR REPLACE FUNCTION oplog_skip_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
        SELECT ARRAY[
          'operation_log', 'audit_event', 'sale_fact', 'workflow_execution',
          'mikro_orm_migrations', 'script_migrations', 'link_module_migrations',
          'auth_identity', 'provider_identity', 'auth_mfa_factor', 'auth_mfa_recovery_code',
          'auth_password_reset_token', 'auth_verification', 'api_key',
          'cart', 'cart_address', 'cart_line_item', 'cart_line_item_adjustment', 'cart_line_item_tax_line',
          'cart_payment_collection', 'cart_promotion', 'cart_shipping_method', 'cart_shipping_method_adjustment',
          'cart_shipping_method_tax_line', 'payment_session', 'payment_collection', 'payment_collection_payment_providers',
          'notification', 'ai_usage_event', 'order_summary'
        ]::text[]
      $f$;
    `);

    this.addSql(`
      CREATE OR REPLACE FUNCTION oplog_clean(tbl text, j jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $f$
      DECLARE
        out jsonb := '{}'::jsonb;
        k text;
        v jsonb;
        rx_keep text[] := ARRAY['id','customer_id','kind','rx_number','rx_date','rx_date_approx','source','verified_by_user','previous_prescription_id','worn_source','created_at','updated_at','deleted_at'];
      BEGIN
        IF j IS NULL THEN RETURN NULL; END IF;
        FOR k, v IN SELECT key, value FROM jsonb_each(j) LOOP
          IF k ~* '(password|passwd|secret|token|salt|hash|api_?key|private_?key|cvv|card_?number|recovery|otp)' THEN
            out := out || jsonb_build_object(k, '[redacted]');
          ELSIF tbl = 'prescription' AND NOT (k = ANY (rx_keep)) THEN
            out := out || jsonb_build_object(k, CASE WHEN v = 'null'::jsonb THEN NULL ELSE to_jsonb('[health data]'::text) END);
          ELSIF length(v::text) > 2000 THEN
            out := out || jsonb_build_object(k, jsonb_build_object('_truncated', length(v::text)));
          ELSE
            out := out || jsonb_build_object(k, v);
          END IF;
        END LOOP;
        RETURN out;
      END
      $f$;
    `);

    this.addSql(`
      CREATE OR REPLACE FUNCTION oplog_context() RETURNS jsonb LANGUAGE plpgsql AS $f$
      DECLARE
        q text := current_query();
        h text;
        m text[];
        b64 text;
        ctx jsonb := NULL;
      BEGIN
        IF q IS NULL OR position('/*oplog:' in q) = 0 THEN RETURN NULL; END IF;
        -- Parsed once per statement (a bulk write fires the trigger per row): cached in the session by the query's hash.
        h := md5(q);
        IF current_setting('oplog.qh', true) = h THEN
          RETURN NULLIF(current_setting('oplog.ctx', true), '')::jsonb;
        END IF;
        -- A tag that cannot be read never stops the write: it is logged as system.
        BEGIN
          m := regexp_match(q, '/\\*oplog:([A-Za-z0-9_-]+)\\*/');
          IF m IS NOT NULL AND length(m[1]) <= 4000 THEN
            b64 := translate(m[1], '-_', '+/');
            b64 := b64 || repeat('=', (4 - length(b64) % 4) % 4);
            ctx := convert_from(decode(b64, 'base64'), 'UTF8')::jsonb;
            IF jsonb_typeof(ctx) <> 'object' THEN ctx := NULL; END IF;
          END IF;
        EXCEPTION WHEN others THEN
          ctx := NULL;
        END;
        PERFORM set_config('oplog.qh', h, false);
        PERFORM set_config('oplog.ctx', COALESCE(ctx::text, ''), false);
        RETURN ctx;
      END
      $f$;
    `);

    this.addSql(`
      CREATE OR REPLACE FUNCTION oplog_capture() RETURNS trigger LANGUAGE plpgsql AS $f$
      DECLARE
        ctx jsonb := oplog_context();
        full_old jsonb := NULL;
        full_new jsonb := NULL;
        o jsonb := NULL;
        n jsonb := NULL;
        ch text[];
        operation text := TG_OP;
        rid text;
        est text;
      BEGIN
        IF TG_OP = 'TRUNCATE' THEN
          INSERT INTO operation_log (table_name, op, actor_id, actor_type, actor_role, source, request_id, method, route, ip, user_agent)
          VALUES (TG_TABLE_NAME, 'TRUNCATE', ctx->>'u', ctx->>'t', ctx->>'o', COALESCE(ctx->>'s', 'system'), ctx->>'r', ctx->>'m', ctx->>'p', ctx->>'ip', ctx->>'ua');
          RETURN NULL;
        END IF;

        IF TG_OP <> 'INSERT' THEN full_old := to_jsonb(OLD); END IF;
        IF TG_OP <> 'DELETE' THEN full_new := to_jsonb(NEW); END IF;
        rid := COALESCE(full_new->>'id', full_old->>'id', full_new->>'seq', full_old->>'seq');
        est := COALESCE(full_new->>'establishment_id', full_old->>'establishment_id');

        IF TG_OP = 'UPDATE' THEN
          SELECT array_agg(e.key ORDER BY e.key) INTO ch
            FROM jsonb_each(full_new) e
           WHERE e.value IS DISTINCT FROM full_old->e.key AND e.key <> 'updated_at';
          -- Only updated_at moved: not an operation.
          IF ch IS NULL THEN RETURN NULL; END IF;
          IF full_old->>'deleted_at' IS NULL AND full_new->>'deleted_at' IS NOT NULL THEN operation := 'SOFT_DELETE';
          ELSIF full_old->>'deleted_at' IS NOT NULL AND full_new->>'deleted_at' IS NULL THEN operation := 'RESTORE';
          END IF;
          SELECT jsonb_object_agg(key, value) INTO o FROM jsonb_each(full_old) WHERE key = ANY (ch);
          SELECT jsonb_object_agg(key, value) INTO n FROM jsonb_each(full_new) WHERE key = ANY (ch);
        ELSIF TG_OP = 'INSERT' THEN
          n := full_new;
          SELECT array_agg(k ORDER BY k) INTO ch FROM jsonb_object_keys(full_new) k WHERE full_new->k <> 'null'::jsonb;
        ELSE
          o := full_old;
          SELECT array_agg(k ORDER BY k) INTO ch FROM jsonb_object_keys(full_old) k;
        END IF;

        INSERT INTO operation_log (table_name, op, row_id, establishment_id, changed, before, after, actor_id, actor_type, actor_role, source, request_id, method, route, ip, user_agent)
        VALUES (TG_TABLE_NAME, operation, rid, est, ch, oplog_clean(TG_TABLE_NAME, o), oplog_clean(TG_TABLE_NAME, n),
                ctx->>'u', ctx->>'t', ctx->>'o', COALESCE(ctx->>'s', 'system'), ctx->>'r', ctx->>'m', ctx->>'p', ctx->>'ip', ctx->>'ua');
        RETURN NULL;
      END
      $f$;
    `);

    this.addSql(`
      CREATE OR REPLACE FUNCTION oplog_attach_all() RETURNS integer LANGUAGE plpgsql AS $f$
      DECLARE
        t record;
        added integer := 0;
      BEGIN
        FOR t IN
          SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = current_schema()
             AND c.relkind IN ('r', 'p')
             AND NOT (c.relname = ANY (oplog_skip_tables()))
             AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND tg.tgname = 'oplog_row')
        LOOP
          EXECUTE format('CREATE TRIGGER oplog_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION oplog_capture()', t.relname);
          EXECUTE format('CREATE TRIGGER oplog_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION oplog_capture()', t.relname);
          added := added + 1;
        END LOOP;
        RETURN added;
      END
      $f$;
    `);
    this.addSql(`SELECT oplog_attach_all();`);

    // The log itself cannot be edited, and only the retention job (which says so
    // with SET LOCAL oplog.purge = 'on') can remove old rows.
    this.addSql(`
      CREATE OR REPLACE FUNCTION oplog_guard() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'operation_log is append-only';
        END IF;
        IF COALESCE(current_setting('oplog.purge', true), '') <> 'on' THEN
          RAISE EXCEPTION 'operation_log rows are removed only by the retention job';
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END;
      END
      $f$;
    `);
    this.addSql(`DROP TRIGGER IF EXISTS oplog_guard_row ON operation_log;`);
    this.addSql(`CREATE TRIGGER oplog_guard_row BEFORE UPDATE OR DELETE ON operation_log FOR EACH ROW EXECUTE FUNCTION oplog_guard();`);
    this.addSql(`DROP TRIGGER IF EXISTS oplog_guard_truncate ON operation_log;`);
    this.addSql(`CREATE TRIGGER oplog_guard_truncate BEFORE TRUNCATE ON operation_log FOR EACH STATEMENT EXECUTE FUNCTION oplog_guard();`);
  }

  async down(): Promise<void> {
    this.addSql(`
      DO $d$
      DECLARE t record;
      BEGIN
        FOR t IN SELECT c.relname FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid WHERE tg.tgname IN ('oplog_row') LOOP
          EXECUTE format('DROP TRIGGER IF EXISTS oplog_row ON %I', t.relname);
          EXECUTE format('DROP TRIGGER IF EXISTS oplog_truncate ON %I', t.relname);
        END LOOP;
      END
      $d$;
    `);
    this.addSql(`DROP TRIGGER IF EXISTS oplog_guard_row ON operation_log;`);
    this.addSql(`DROP TRIGGER IF EXISTS oplog_guard_truncate ON operation_log;`);
    this.addSql(`DROP FUNCTION IF EXISTS oplog_guard();`);
    this.addSql(`DROP FUNCTION IF EXISTS oplog_attach_all();`);
    this.addSql(`DROP FUNCTION IF EXISTS oplog_capture();`);
    this.addSql(`DROP FUNCTION IF EXISTS oplog_context();`);
    this.addSql(`DROP FUNCTION IF EXISTS oplog_clean(text, jsonb);`);
    this.addSql(`DROP FUNCTION IF EXISTS oplog_skip_tables();`);
    this.addSql(`DROP TABLE IF EXISTS operation_log;`);
  }
}
