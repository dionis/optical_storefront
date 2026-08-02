import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useCart } from "../components/CartContext.jsx";
import {
  getCart, updateContact, listShippingOptions, setShippingMethod,
  startPayment, DEFAULT_PROVIDER, completeCart,
} from "../data/medusaCart.js";
import { attachAddressAutocomplete, hasGooglePlaces } from "../data/addressAutocomplete.js";

const PK = (import.meta.env && import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) || "";

function loadStripe(pk) {
  return new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe(pk));
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3";
    s.onload = () => resolve(window.Stripe(pk));
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function MedusaCheckout() {
  const { t, tv } = useLang();
  const { clearCart } = useCart();
  const navigate = useNavigate();
  const L = (k) => t(`checkout.${k}`);
  const money = (n) => "$" + Number(n || 0).toFixed(2);

  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("contact"); // contact | pay | done
  const [f, setF] = useState({ email: "", first_name: "", last_name: "", address_1: "", city: "", postal_code: "", country: "", country_code: "us" });
  const [ship, setShip] = useState([]);
  const [shipId, setShipId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [order, setOrder] = useState(null);

  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const payElRef = useRef(null);
  const addrRef = useRef(null);

  // Requirement 15: Google-Maps-style address autocomplete. When a Maps key is
  // configured we attach Places autocomplete to the street input and, on pick,
  // fill the separate street / ZIP / city / country fields at once. Without a
  // key this is a no-op and the manual separate fields stay fully usable, so
  // the build never depends on Google being reachable.
  useEffect(() => {
    if (step !== "contact") return;
    const cleanup = attachAddressAutocomplete(addrRef.current, (parts) => {
      setF((p) => ({
        ...p,
        address_1: parts.address_1 || p.address_1,
        postal_code: parts.postal_code || p.postal_code,
        city: parts.city || p.city,
        country: parts.country || p.country,
        // Only adopt a resolved country code when present; keep the US default
        // otherwise so the Medusa region/shipping never breaks.
        country_code: parts.country_code || p.country_code || "us",
      }));
    });
    return cleanup;
  }, [step]);

  useEffect(() => {
    (async () => {
      // try/finally guarantees the loading spinner is always cleared, even if a
      // future change throws somewhere in this async setup.
      try {
        // ORDEN 4/5 front — return from a Stripe 3D Secure / bank redirect.
        // When the card needs authentication, Stripe leaves this page and comes
        // back to return_url with ?redirect_status=... in the query string. We
        // handle that outcome here and then strip the params so a later reload
        // can't re-trigger it.
        const params = new URLSearchParams(window.location.search);
        const redirectStatus = params.get("redirect_status");
        if (redirectStatus) {
          navigate("/checkout", { replace: true }); // drop the query string
          if (redirectStatus === "succeeded") {
            // Bank authenticated the charge → complete the cart once. Medusa's
            // cart.complete() is idempotent, so this is safe.
            const r = await completeCart();
            if (r.ok) { setOrder(r.order); try { clearCart(); } catch {} setStep("done"); }
            else setErr(L("failed"));
            return;
          }
          // Authentication failed or was canceled — no charge was made.
          setErr(L("failed"));
          const c0 = await getCart();
          setCart(c0);
          return;
        }

        const c = await getCart();
        setCart(c);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const shippingAddress = () => ({
    first_name: f.first_name, last_name: f.last_name, address_1: f.address_1,
    city: f.city, postal_code: f.postal_code,
    // Region is US-only; fall back to "us" so an unrecognized autocomplete
    // country can never break shipping-option lookup or completion.
    country_code: (f.country_code || "us").toLowerCase(),
  });

  const calcShipping = async () => {
    setErr(""); setBusy(true);
    try {
      await updateContact({ email: f.email, shipping_address: shippingAddress() });
      const opts = await listShippingOptions();
      setShip(opts);
      if (opts[0]) setShipId(opts[0].id);
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  const goToPay = async () => {
    if (!PK) { setErr(L("noStripe")); return; }
    setErr(""); setBusy(true);
    try {
      await setShippingMethod(shipId);
      const { clientSecret } = await startPayment(DEFAULT_PROVIDER);
      setCart(await getCart());
      const stripe = await loadStripe(PK);
      stripeRef.current = stripe;
      const elements = stripe.elements({ clientSecret });
      elementsRef.current = elements;
      setStep("pay");
      // mount after the pay step DOM renders
      setTimeout(() => {
        const el = elements.create("payment");
        el.mount(payElRef.current);
      }, 0);
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  const pay = async () => {
    setErr(""); setBusy(true);
    try {
      // Capture the cart id BEFORE charging: we must know what to complete, and
      // this guards against ever being charged with no id to reconcile. If it's
      // missing we bail before touching the card.
      const cartId = (cart && cart.id) || null;
      if (!cartId) { setErr(L("failed")); setBusy(false); return; }

      const { error } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        // Required in case the card needs 3D Secure / bank authentication: then
        // Stripe redirects the browser away and back to this URL. With
        // "if_required" the redirect only happens when the bank demands it; the
        // return is handled by the mount effect below (ORDEN 4/5 front).
        confirmParams: { return_url: window.location.origin + "/checkout" },
        redirect: "if_required",
      });
      // NOTE: if a redirect DID occur, the browser already left this page and the
      // lines below never run — completion resumes on return via the mount effect.
      if (error) { setErr(error.message); setBusy(false); return; }

      // ── Payment is confirmed by Stripe HERE. Complete the cart → order once.
      // Medusa's cart.complete() is idempotent, so this is safe.
      const r = await completeCart();
      if (r.ok) {
        setOrder(r.order);
        try { clearCart(); } catch {}
        setStep("done");
      } else {
        setErr(L("failed"));
      }
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  if (loading) return <div className="section"><p>…</p></div>;

  if (step !== "done" && (!cart || !(cart.items || []).length)) {
    return (
      <div className="section checkout">
        <h1>{L("title")}</h1>
        <p className="muted">{L("empty")}</p>
        <Link to="/catalogo" className="btn btn-primary">{L("toCatalog")}</Link>
      </div>
    );
  }

  return (
    <div className="section checkout" style={{ maxWidth: 680, margin: "0 auto" }}>
      <h1>{L("title")}</h1>

      {step === "done" ? (
        <div className="checkout-done">
          <h2>✅ {L("done")}</h2>
          <p>{L("orderNo")}: <b>{order?.display_id ? `#${order.display_id}` : order?.id}</b></p>
          <p className="muted">{L("thanks")}</p>
          <Link to="/catalogo" className="btn btn-primary big">{L("toCatalog")}</Link>
        </div>
      ) : (
        <>
          {/* order summary */}
          <ul className="panel-list">
            {(cart.items || []).map((i) => (
              <li key={i.id} className="panel-item">
                <div className="panel-item-info">
                  <b>{i.title}</b>
                  {i.metadata?.lens_config && (
                    <small>{[i.metadata.lens_config.design_code, i.metadata.lens_config.material_code].filter(Boolean).join(" · ")}</small>
                  )}
                </div>
                <span className="panel-item-price">{money(i.unit_price)}</span>
              </li>
            ))}
          </ul>
          <div className="panel-total"><span>{L("total")}</span><b>{money(cart.total)}</b></div>

          {err && <div className="auth-err" style={{ margin: "10px 0" }}>{err}</div>}

          {step === "contact" && (
            <div className="co-form">
              <div className="co-h">👤 {L("contact")}</div>
              <div className="co-fields">
                <input type="email" placeholder={L("email")} value={f.email} onChange={set("email")} autoComplete="email" />
                <div className="co-two">
                  <input placeholder={L("first")} value={f.first_name} onChange={set("first_name")} />
                  <input placeholder={L("last")} value={f.last_name} onChange={set("last_name")} />
                </div>
                <input ref={addrRef} placeholder={L("address")} value={f.address_1} onChange={set("address_1")} autoComplete="street-address" />
                {hasGooglePlaces() && <small className="co-hint">📍 {L("addrHint")}</small>}
                <div className="co-two">
                  <input placeholder={L("city")} value={f.city} onChange={set("city")} autoComplete="address-level2" />
                  <input placeholder={L("zip")} value={f.postal_code} onChange={set("postal_code")} autoComplete="postal-code" />
                </div>
                <input placeholder={L("country")} value={f.country} onChange={set("country")} autoComplete="country-name" />
              </div>

              {!ship.length ? (
                <button className="btn btn-outline big" disabled={busy || !f.email || !f.address_1} onClick={calcShipping}>
                  {busy ? "…" : L("calcShip")}
                </button>
              ) : (
                <>
                  <div className="co-h">🚚 {L("shipping")}</div>
                  <div className="opt-list">
                    {ship.map((o) => (
                      <label key={o.id} className={`choice ${shipId === o.id ? "sel" : ""}`}>
                        <input type="radio" name="ship" checked={shipId === o.id} onChange={() => setShipId(o.id)} />
                        <span className="choice-main"><span className="choice-title">{tv(o.name)}</span></span>
                        <span className="choice-price">{o.amount > 0 ? money(o.amount) : L("free")}</span>
                      </label>
                    ))}
                  </div>
                  <button className="btn btn-primary big" disabled={busy || !shipId} onClick={goToPay}>
                    {busy ? "…" : L("toPay")}
                  </button>
                </>
              )}
            </div>
          )}

          {step === "pay" && (
            <div className="co-form">
              <div className="co-h">💳 {L("payment")}</div>
              <div ref={payElRef} style={{ margin: "12px 0" }} />
              <p className="muted small">{L("testCard")}</p>
              <button className="btn btn-primary big" disabled={busy} onClick={pay}>
                {busy ? L("paying") : `${L("pay")} · ${money(cart.total)}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
