import middlewareConfig from "../src/api/middlewares";

/**
 * Medusa passes every entry in `defineMiddlewares` through `wrapHandler`, which
 * returns a three-argument function. Express classifies error-handling
 * middleware by `fn.length === 4`, so a four-argument middleware registered here
 * is never recognised as one: it runs in the normal chain with its arguments
 * shifted (`err` receives the request, `next` receives nothing) and the first
 * `next(err)` throws `TypeError: next is not a function`.
 *
 * The failure mode is brutal and silent — every request to that route returns an
 * opaque 500 whether or not it carries an upload, and nothing in the code reads
 * as wrong. It took a production outage on `/store/prescriptions/ocr` to find.
 * Multer errors belong in a callback inside a three-argument middleware instead
 * (see `ocrUpload`).
 */
describe("api middlewares", () => {
  const entries = (middlewareConfig.routes ?? []).flatMap((route) =>
    (route.middlewares ?? []).map((fn, index) => ({
      matcher: route.matcher,
      index,
      name: (fn as { name?: string }).name || `#${index}`,
      arity: (fn as (...args: unknown[]) => unknown).length,
    }))
  );

  it("registers at least one middleware (guards against an empty config)", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("declares no four-argument middleware, which Medusa cannot host", () => {
    const offenders = entries.filter((e) => e.arity >= 4);
    expect(
      offenders.map((e) => `${e.matcher} → ${e.name} (${e.arity} args)`)
    ).toEqual([]);
  });
});
