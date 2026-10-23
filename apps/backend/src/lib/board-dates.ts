/**
 * Accept a plain `YYYY-MM-DD` and widen it to cover the whole day.
 *
 * The owner picks a day, not an instant. Passing the bare date through would
 * make `to=2026-03-10` mean "up to midnight", silently dropping every order
 * placed during that day — the single most confusing thing a date filter can do.
 *
 * Returns `null` when absent and `false` for input that is present but
 * unparseable, so the caller can reject rather than quietly ignore it. Shared
 * by the order board, the seller stats and the cost summary so all three read
 * a date range the same way.
 */
export function parseBoardDate(value: string | undefined, edge: "start" | "end"): string | null | false {
  if (!value) return null;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const iso = bare ? `${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString();
}
