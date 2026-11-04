/**
 * «Consumo IA»: pricing, the derived balance, the pace and when an alert fires.
 *
 * No provider reports a prepaid balance through an API, so the balance is the
 * owner's figure minus what this system measured — these rules are the whole
 * of what the panel and the alert emails say. Pure functions, no database.
 */
import {
  alertShouldFire,
  alertTripped,
  burnWindowStart,
  cleanAlert,
  cleanCreditEntry,
  cleanUsageEvent,
  creditCycle,
  isNoCreditError,
  normalizeProvider,
  priceTokens,
  providerBalance,
  providerState,
  visionUsageEvents,
} from "../src/lib/ai-usage";

const NOW = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("pricing", () => {
  it("prices an OCR model from the OCR catalogue", () => {
    const p = priceTokens("anthropic", "claude-sonnet-5", 1_000_000, 100_000);
    expect(p.priced).toBe("estimated");
    expect(p.cost_usd).toBeCloseTo(3 + 1.5, 6);
  });

  it("prices the scraper's translation model by prefix", () => {
    const p = priceTokens("anthropic", "claude-sonnet-4-5", 200, 100);
    expect(p.priced).toBe("estimated");
    expect(p.cost_usd).toBeCloseTo((200 * 3 + 100 * 15) / 1_000_000, 9);
  });

  it("prefers the longest prefix (image model over text model)", () => {
    const p = priceTokens("gemini", "gemini-2.5-flash-image", 0, 1290);
    expect(p.cost_usd).toBeCloseTo((1290 * 30) / 1_000_000, 9);
  });

  it("never invents a price for an unknown model", () => {
    const p = priceTokens("openai", "gpt-9", 1000, 1000);
    expect(p).toMatchObject({ priced: "unpriced", cost_usd: 0 });
  });
});

describe("usage events", () => {
  it("keeps a caller's own cost as reported", () => {
    const r = cleanUsageEvent({ provider: "gemini", activity: "media_views", cost_usd: 0.039, model: "gemini-2.5-flash-image" });
    expect(r).toMatchObject({ event: { cost_usd: 0.039, priced: "reported" } });
  });

  it("a refusal for lack of credit costs nothing", () => {
    const r = cleanUsageEvent({ provider: "anthropic", activity: "ocr", status: "no_credit", input_tokens: 500 });
    expect(r).toMatchObject({ event: { status: "no_credit", cost_usd: 0 } });
  });

  it("rejects unknown providers and activities", () => {
    expect(cleanUsageEvent({ provider: "acme", activity: "ocr" })).toEqual({ reason: "invalid_provider" });
    expect(cleanUsageEvent({ provider: "anthropic", activity: "mining" })).toEqual({ reason: "invalid_activity" });
    expect(cleanUsageEvent({ provider: "anthropic", activity: "ocr", cost_usd: -1 })).toEqual({ reason: "invalid_cost" });
  });

  it("folds provider spellings", () => {
    expect(normalizeProvider("Google")).toBe("gemini");
    expect(normalizeProvider("claude")).toBe("anthropic");
    expect(normalizeProvider("local")).toBeNull();
  });
});

describe("no-credit detection", () => {
  it.each([
    "Your credit balance is too low to access the Anthropic API.",
    "429 RESOURCE_EXHAUSTED: Your prepayment credits are depleted.",
    "insufficient_quota",
  ])("%s", (msg) => expect(isNoCreditError(msg)).toBe(true));

  it("a plain rate limit is not out of credit", () => {
    expect(isNoCreditError("429 RESOURCE_EXHAUSTED: quota per minute exceeded, retry later")).toBe(false);
    expect(isNoCreditError("rate limited")).toBe(false);
  });

  it("OpenRouter's 402 is out of credit", () => expect(isNoCreditError("", 402)).toBe(true));
});

describe("credit cycle and balance", () => {
  it("adds deposits from the first one", () => {
    const c = creditCycle([
      { id: "a", kind: "deposit", amount_usd: 50, effective_at: daysAgo(10) },
      { id: "b", kind: "deposit", amount_usd: 20, effective_at: daysAgo(2) },
    ]);
    expect(c).toMatchObject({ funded: 70, cycle_id: "b", anchor_kind: "deposit" });
    expect(c.start?.toISOString()).toBe(daysAgo(10));
  });

  it("a balance figure resets everything before it; later deposits add", () => {
    const c = creditCycle([
      { id: "a", kind: "deposit", amount_usd: 50, effective_at: daysAgo(30) },
      { id: "b", kind: "balance", amount_usd: 12.5, effective_at: daysAgo(5) },
      { id: "c", kind: "deposit", amount_usd: 25, effective_at: daysAgo(1) },
    ]);
    expect(c).toMatchObject({ funded: 37.5, cycle_id: "c", anchor_kind: "balance" });
    expect(c.start?.toISOString()).toBe(daysAgo(5));
  });

  it("no entries → not tracked, spending still shown", () => {
    const c = creditCycle([]);
    const b = providerBalance(c, 3.2, 3.2, NOW);
    expect(b).toMatchObject({ tracked: false, remaining: null, spent: 3.2 });
  });

  it("remaining, percent left, pace and days left", () => {
    const c = creditCycle([{ id: "a", kind: "deposit", amount_usd: 100, effective_at: daysAgo(20) }]);
    const b = providerBalance(c, 60, 14, NOW); // $14 in the last 7 days → $2/day
    expect(b).toMatchObject({ tracked: true, remaining: 40, pct_left: 40, burn_per_day: 2, days_left: 20 });
  });

  it("a young cycle averages the pace over its own age (min one day)", () => {
    const c = creditCycle([{ id: "a", kind: "deposit", amount_usd: 10, effective_at: daysAgo(2) }]);
    expect(burnWindowStart(c, NOW).toISOString()).toBe(daysAgo(2));
    const b = providerBalance(c, 4, 4, NOW);
    expect(b.burn_per_day).toBe(2);
    expect(b.days_left).toBe(3);
  });

  it("states: empty, low, no_credit", () => {
    const c = creditCycle([{ id: "a", kind: "deposit", amount_usd: 10, effective_at: daysAgo(3) }]);
    expect(providerState(providerBalance(c, 11, 11, NOW), 0, null, NOW)).toBe("empty");
    expect(providerState(providerBalance(c, 5, 5, NOW), 1, null, NOW)).toBe("low");
    expect(providerState(providerBalance(c, 1, 1, NOW), 0, new Date(NOW.getTime() - 3_600_000), NOW)).toBe("no_credit");
    expect(providerState(providerBalance(c, 1, 1, NOW), 0, new Date(NOW.getTime() - 48 * 3_600_000), NOW)).toBe("ok");
  });
});

describe("alerts", () => {
  const cycle = creditCycle([{ id: "dep1", kind: "deposit", amount_usd: 100, effective_at: daysAgo(10) }]);
  const bal = providerBalance(cycle, 85, 21, NOW); // $15 left, $3/day → 5 days

  it.each([
    ["usd", 20, true],
    ["usd", 10, false],
    ["percent", 15, true],
    ["percent", 10, false],
    ["days", 7, true],
    ["days", 3, false],
  ])("%s ≤ %d → %s", (unit, threshold, expected) => {
    expect(alertTripped({ unit: unit as string, threshold: threshold as number, is_active: true, fired_cycle: null }, bal)).toBe(expected);
  });

  it("fires once per funding cycle and re-arms on the next entry", () => {
    const alert = { unit: "usd", threshold: 20, is_active: true, fired_cycle: null as string | null };
    expect(alertShouldFire(alert, bal, cycle)).toBe(true);
    alert.fired_cycle = "dep1";
    expect(alertShouldFire(alert, bal, cycle)).toBe(false);
    const topped = creditCycle([
      { id: "dep1", kind: "deposit", amount_usd: 100, effective_at: daysAgo(10) },
      { id: "dep2", kind: "deposit", amount_usd: 5, effective_at: daysAgo(0) },
    ]);
    expect(alertShouldFire(alert, providerBalance(topped, 85, 21, NOW), topped)).toBe(true);
  });

  it("an inactive rule or an untracked provider never fires", () => {
    expect(alertTripped({ unit: "usd", threshold: 1000, is_active: false, fired_cycle: null }, bal)).toBe(false);
    expect(alertTripped({ unit: "usd", threshold: 1000, is_active: true, fired_cycle: null }, providerBalance(creditCycle([]), 1, 1, NOW))).toBe(false);
  });
});

describe("input cleaning", () => {
  it("a deposit must be positive and not in the future", () => {
    expect(cleanCreditEntry({ provider: "gemini", amount_usd: 0 }, NOW)).toEqual({ reason: "invalid_amount" });
    expect(cleanCreditEntry({ provider: "gemini", amount_usd: 10, effective_at: "2027-01-01" }, NOW)).toEqual({ reason: "future_date" });
    expect(cleanCreditEntry({ provider: "gemini", kind: "balance", amount_usd: 0 }, NOW)).toMatchObject({ entry: { kind: "balance", amount_usd: 0 } });
  });

  it("alert thresholds are bounded by unit and emails are checked", () => {
    expect(cleanAlert({ provider: "gemini", unit: "percent", threshold: 120 })).toEqual({ reason: "invalid_threshold" });
    expect(cleanAlert({ provider: "gemini", unit: "usd", threshold: 10, recipients: "a@b.co, nope" })).toEqual({ reason: "invalid_email" });
    expect(cleanAlert({ provider: "gemini", unit: "days", threshold: 7, recipients: "A@b.co; a@b.co" })).toMatchObject({ alert: { recipients: ["a@b.co"] } });
  });
});

describe("vision-measure answers", () => {
  const sync = {
    ok: true,
    requestId: "req1",
    results: [
      { ok: true, provider: "gemini", model: "gemini-2.5-flash", cost: { inputTokens: 3000, outputTokens: 400, totalCost: 0.0019, ratesCheckedOn: "2026-08-21" } },
      { ok: false, provider: "anthropic", model: "claude-sonnet-5", error: "Your credit balance is too low", cost: null },
      { ok: true, provider: "local", method: "local" },
    ],
    tryOn: { ok: true, provider: "gemini", model: "gemini-2.5-flash-image", imageDataUrl: "data:image/png;base64,AAA" },
  };

  it("records each paid result, the refusal and the render, keyed by request", () => {
    const ev = visionUsageEvents(sync);
    expect(ev.map((e) => [e.activity, e.status, e.event_key])).toEqual([
      ["vision_measure", "ok", "vision:req1:0"],
      ["vision_measure", "no_credit", "vision:req1:1"],
      ["tryon_render", "ok", "vision:req1:render:front"],
    ]);
    expect(ev[0].cost_usd).toBe(0.0019);
    expect(ev[2].output_tokens).toBe(1290);
  });

  it("a finished job yields the same keys (polling twice counts once)", () => {
    expect(visionUsageEvents({ ok: true, status: "done", result: sync }).map((e) => e.event_key)).toEqual(visionUsageEvents(sync).map((e) => e.event_key));
  });

  it("a pending job or a non-measurement answer records nothing", () => {
    expect(visionUsageEvents({ ok: true, status: "pending", jobId: "j" })).toEqual([]);
    expect(visionUsageEvents({ providers: [] })).toEqual([]);
  });
});
