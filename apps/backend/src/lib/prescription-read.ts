/**
 * Reads prescription records straight from Postgres.
 *
 * WHY NOT THE MODULE SERVICE: the prescription module's generated data methods
 * (`retrievePrescriptionRecord`, `listPrescriptionRecords`, …) all throw
 * "Cannot read properties of undefined (reading 'fork')" in this project — the
 * MikroORM entity manager is not wired into the module. That is why
 * `POST /store/prescriptions` writes with the shared PG connection instead of
 * `createFromRx`, and the read path has the same problem.
 *
 * The consequence was silent and expensive: `order-placed` wrapped its lookup in
 * a try/catch, logged a warning nobody reads, and sent every order email with an
 * empty prescription section. The values were in the database the whole time.
 *
 * `recordToRx` on the service is a pure mapping function — no ORM — so it stays
 * the single definition of how a row becomes a `Prescription`.
 */
import type { Knex } from "@mikro-orm/knex";

/** Raw prescription rows by id. Missing ids are simply absent from the map. */
export async function loadPrescriptionRecords(
  pg: Knex,
  ids: Iterable<string>
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const list = [...new Set([...ids].filter(Boolean).map(String))];
  if (!list.length) return out;

  const rows = (await pg("prescription")
    .whereIn("id", list)
    .whereNull("deleted_at")) as Array<Record<string, unknown>>;
  for (const row of rows) out.set(String(row["id"]), row);
  return out;
}

/** One record, or null when it does not exist (or was soft-deleted). */
export async function loadPrescriptionRecord(
  pg: Knex,
  id: string
): Promise<Record<string, unknown> | null> {
  const rows = (await pg("prescription")
    .where({ id })
    .whereNull("deleted_at")
    .limit(1)) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}
