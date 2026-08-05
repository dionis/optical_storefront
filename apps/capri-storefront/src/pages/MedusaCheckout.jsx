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

// Etiquetas legibles para el tipo de lente en el resumen del checkout (el carrito
// sólo guarda los códigos; la receta/PHI vive en el servidor).
const DESIGN_LBL = {
  "frame-only": { es: "Solo montura", en: "Frame only" },
  sv: { es: "Visión Sencilla", en: "Single Vision" },
  bifocal: { es: "Bifocal", en: "Bifocal" },
  "prog-mid": { es: "Progresivo", en: "Progressive" },
  "prog-high": { es: "Progresivo gama alta", en: "Progressive premium" },
};

export default function MedusaCheckout() {
  const { t, tv, lang } = useLang();
  const { clearCart } = useCart();
  const navigate = useNavigate();
  const L = (k) => t(`checkout.${k}`);
  const money = (n) => "$" + Number(n || 0).toFixed(2);

  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("contact"); // contact | pay | done
  const [f, setF] = useState({ email: "", phone: "", first_name: "", last_name: "", address_1: "", city: "", postal_code: "", country: "", country_code: "us" });
  // Cómo recibir la confirmación del pedido (el envío real es del backend).
  const [notify, setNotify] = useState({ email: true, sms: false });
  // ¿La dirección de facturación de la tarjeta es la misma del paciente? Si sí,
  // autorellenamos los datos de facturación de Stripe con los del paciente.
  const [cardMatches, setCardMatches] = useState(true);
  const [ship, setShip] = useState([]);
  const [shipId, setShipId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [order, setOrder] = useState(null);

  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const payElRef = useRef(null);
  const payMountRef = useRef(null); // instancia montada del Payment Element
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
    phone: f.phone || null, // celular del paciente (para SMS y contacto)
    // Region is US-only; fall back to "us" so an unrecognized autocomplete
    // country can never break shipping-option lookup or completion.
    country_code: (f.country_code || "us").toLowerCase(),
  });

  // Datos de facturación para Stripe, tomados del paciente (autofill).
  // NO pasamos email ni teléfono a Stripe a propósito: si Stripe recibe un email
  // reconocido por Stripe Link, dispara su verificación ("Confirma que eres tú")
  // que en esta cuenta falla con 401 y bloquea el pago. El email/teléfono ya se
  // capturan en los datos del paciente y viajan al backend; para la TARJETA sólo
  // hace falta nombre + dirección de facturación.
  const buildBilling = () => {
    const name = `${f.first_name} ${f.last_name}`.trim();
    const bd = {};
    if (name) bd.name = name;
    const address = {};
    if (f.address_1) address.line1 = f.address_1;
    if (f.city) address.city = f.city;
    if (f.postal_code) address.postal_code = f.postal_code;
    address.country = (f.country_code || "us").toUpperCase();
    bd.address = address;
    return bd;
  };

  const calcShipping = async () => {
    setErr(""); setBusy(true);
    try {
      await updateContact({
        email: f.email,
        shipping_address: shippingAddress(),
        // Preferencias que el backend usará para notificar (email/SMS) + idioma.
        metadata: { phone: f.phone || null, notify_email: notify.email, notify_sms: notify.sms, locale: lang },
      });
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
      // Re-send the notification preferences before leaving this step.
      // `calcShipping` was the only place that wrote them, so a shopper who
      // ticked "email me" AFTER the shipping options appeared — the checkboxes
      // are still on screen at that point — had the change silently dropped and
      // the order carried whatever was set on the earlier click.
      await updateContact({
        metadata: { phone: f.phone || null, notify_email: notify.email, notify_sms: notify.sms, locale: lang },
      });
      await setShippingMethod(shipId);
      const { clientSecret } = await startPayment(DEFAULT_PROVIDER);
      setCart(await getCart());
      const stripe = await loadStripe(PK);
      stripeRef.current = stripe;
      const elements = stripe.elements({ clientSecret });
      elementsRef.current = elements;
      setStep("pay"); // el Payment Element se monta en el useEffect de abajo
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  // Monta (y re-monta) el Payment Element de Stripe. Si el cliente marca que la
  // tarjeta es del paciente, autorellenamos los datos de facturación con los
  // suyos (defaultValues.billingDetails); si lo desmarca, Stripe los pide.
  useEffect(() => {
    if (step !== "pay" || !elementsRef.current || !payElRef.current) return;
    const elements = elementsRef.current;
    if (payMountRef.current) { try { payMountRef.current.destroy(); } catch { /* noop */ } payMountRef.current = null; }
    // `fields.billingDetails.email: "never"` evita que Stripe muestre el campo de
    // email de Link, que es el que dispara la verificación fallida (401). El email
    // ya lo capturamos en los datos del paciente.
    const opts = { fields: { billingDetails: { email: "never" } } };
    if (cardMatches) opts.defaultValues = { billingDetails: buildBilling() };
    const el = elements.create("payment", opts);
    el.mount(payElRef.current);
    payMountRef.current = el;
    return () => { try { el.destroy(); } catch { /* noop */ } payMountRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cardMatches]);

  const pay = async () => {
    setErr(""); setBusy(true);
    try {
      // Capture the cart id BEFORE charging: we must know what to complete, and
      // this guards against ever being charged with no id to reconcile. If it's
      // missing we bail before touching the card.
      const cartId = (cart && cart.id) || null;
      if (!cartId) { setErr(L("failed")); setBusy(false); return; }

      // Al ocultar el email del Element con `fields.billingDetails.email: "never"`
      // (ver el useEffect de montaje), Stripe EXIGE recibirlo aquí; si no, avisa
      // con "you did not pass confirmParams.payment_method_data.billing_details.email"
      // y la tarjeta se guarda sin email. Mandarlo en confirmParams NO reabre la
      // verificación de Link que daba 401: esa la dispara el campo de email del
      // Element, que sigue oculto. Si la tarjeta no es del paciente, sólo va el
      // email (nombre y dirección los teclea el cliente en el Element).
      const billing = { ...(cardMatches ? buildBilling() : {}), email: f.email };

      const { error } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        // Required in case the card needs 3D Secure / bank authentication: then
        // Stripe redirects the browser away and back to this URL. With
        // "if_required" the redirect only happens when the bank demands it; the
        // return is handled by the mount effect below (ORDEN 4/5 front).
        confirmParams: {
          return_url: window.location.origin + "/checkout",
          payment_method_data: { billing_details: billing },
        },
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
          {/* El seguimiento no lleva token aquí: la página pide el correo y
              manda un enlace, para no dejar una credencial en el historial del
              navegador ni en un enlace que se pueda compartir. */}
          <p className="muted">{L("trackHint")}</p>
          <div className="checkout-done-actions">
            <Link to="/my-orders" className="btn btn-primary big">{L("trackCta")}</Link>
            <Link to="/catalogo" className="btn btn-outline big">{L("toCatalog")}</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Resumen del pedido COMPLETO, siempre visible arriba de "Finalizar compra" */}
          <div className="co-summary">
            <div className="co-summary-h">🧾 {L("summary")}</div>
            <ul className="panel-list">
              {(cart.items || []).map((i) => {
                const lc = i.metadata?.lens_config || {};
                const dl = DESIGN_LBL[lc.design_code];
                const parts = [dl ? (dl[lang] || dl.es) : lc.design_code, lc.material_code, lc.photo_code, lc.ar_code].filter(Boolean);
                return (
                  <li key={i.id} className="panel-item">
                    <div className="panel-item-info">
                      <b>{i.title}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</b>
                      {parts.length > 0 && <small>{parts.join(" · ")}</small>}
                      {i.metadata?.prescription_id && <small className="co-rx">✓ {L("withRx")}</small>}
                    </div>
                    <span className="panel-item-price">{money(i.total ?? i.unit_price)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="co-totals">
              {cart.item_total != null && <div><span>{L("subtotal")}</span><b>{money(cart.item_total)}</b></div>}
              <div><span>{L("shippingLine")}</span><b>{cart.shipping_total > 0 ? money(cart.shipping_total) : L("free")}</b></div>
              {cart.tax_total > 0 && <div><span>{L("tax")}</span><b>{money(cart.tax_total)}</b></div>}
              {(() => {
                // Impuesto de montura sola horneado en el precio (server-side);
                // se muestra como informativo "impuesto incluido".
                const inc = (cart.items || []).reduce((s, i) => s + Number(i.metadata?.tax_amount || 0), 0);
                return inc > 0 ? <div><span>{L("taxIncluded")}</span><b>{money(inc)}</b></div> : null;
              })()}
            </div>
            <div className="panel-total"><span>{L("total")}</span><b>{money(cart.total)}</b></div>
          </div>

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
                {/* Celular del paciente: se toma de forma orgánica junto al resto
                    del contacto; sirve para SMS de confirmación y contacto. */}
                <input type="tel" placeholder={L("phone")} value={f.phone} onChange={set("phone")} autoComplete="tel" />
                <input ref={addrRef} placeholder={L("address")} value={f.address_1} onChange={set("address_1")} autoComplete="street-address" />
                {hasGooglePlaces() && <small className="co-hint">📍 {L("addrHint")}</small>}
                <div className="co-two">
                  <input placeholder={L("city")} value={f.city} onChange={set("city")} autoComplete="address-level2" />
                  <input placeholder={L("zip")} value={f.postal_code} onChange={set("postal_code")} autoComplete="postal-code" />
                </div>
                <input placeholder={L("country")} value={f.country} onChange={set("country")} autoComplete="country-name" />
              </div>

              {/* ¿Cómo quiere recibir la confirmación del pedido? El envío real de
                  email/SMS lo hace el backend con estas preferencias. */}
              <div className="co-notify">
                <div className="co-notify-h">🔔 {L("notify")}</div>
                <label className="co-check">
                  <input type="checkbox" checked={notify.email} onChange={(e) => setNotify((p) => ({ ...p, email: e.target.checked }))} />
                  <span>{L("notifyEmail")}</span>
                </label>
                <label className="co-check">
                  <input type="checkbox" checked={notify.sms} onChange={(e) => setNotify((p) => ({ ...p, sms: e.target.checked }))} />
                  <span>{L("notifySms")}</span>
                </label>
              </div>

              {!ship.length ? (
                <button className="btn btn-outline big" disabled={busy || !f.email || !f.address_1} onClick={calcShipping}>
                  {busy ? <><span className="btn-spin" aria-hidden="true" /> {L("processing")}</> : L("calcShip")}
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
                    {busy ? <><span className="btn-spin" aria-hidden="true" /> {L("processing")}</> : L("toPay")}
                  </button>
                </>
              )}
            </div>
          )}

          {step === "pay" && (
            <div className="co-form">
              <div className="co-h">💳 {L("payment")}</div>
              {/* Si la tarjeta es del paciente, autorellenamos los datos de
                  facturación de Stripe con los del paciente. Al cambiar, el
                  useEffect vuelve a montar el Payment Element. */}
              <label className="co-check co-cardmatch">
                <input type="checkbox" checked={cardMatches} onChange={(e) => setCardMatches(e.target.checked)} />
                <span>{L("cardMatches")}</span>
              </label>
              <div ref={payElRef} style={{ margin: "12px 0" }} />
              <p className="muted small">{L("testCard")}</p>
              <button className="btn btn-primary big" disabled={busy} onClick={pay}>
                {busy ? <><span className="btn-spin" aria-hidden="true" /> {L("paying")}</> : `${L("pay")} · ${money(cart.total)}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
