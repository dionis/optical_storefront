// Dónde se usa: /checkout. Resumen con quitar-línea (×), datos del paciente, envío FedEx/DHL (gratis desde $100, solo EE.UU.), pago Stripe con vuelta atrás garantizada.
import { useEffect, useRef, useState } from "react";
import { loadCache, saveCache } from "../lib/appCache.js";
import { Link, useNavigate } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useCart } from "../components/CartContext.jsx";
import {
  getCart, updateContact, listShippingOptions, setShippingMethod,
  quoteShipping, selectCarrier,
  startPayment, DEFAULT_PROVIDER, completeCart, revalidateCart,
} from "../data/medusaCart.js";
import { attachAddressAutocomplete, hasGooglePlaces } from "../data/addressAutocomplete.js";
import { resolveImage } from "../data/imageUrl.js";
import { shipping as shippingConfig } from "../admin/priceStore.js";
import { materialById, PHOTO, AR_OPTIONS, L as LBL } from "../data/lensPricing.js";

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
  const { clearCart, removeItem } = useCart();
  const navigate = useNavigate();
  const L = (k) => t(`checkout.${k}`);
  const money = (n) => "$" + Number(n || 0).toFixed(2);
  // Días hábiles de laboratorio (configurables por el dueño). No es tiempo de
  // transporte: es lo que tarda el pedido en estar listo para recoger o salir.
  const labDays = Number(shippingConfig().labDays) || 0;
  // Tarifa FIJA de FedEx (pedido del dueño): $28 siempre, 4 días — lo que el
  // cliente ve. El servidor cobra lo mismo (SHIPPING_FEDEX_RATE en Coolify).
  const FEDEX_RATE = Number(shippingConfig().fedexRate) || 28;
  const FEDEX_ETA = Number(shippingConfig().fedexEtaDays) || 4;

  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("contact"); // contact | pay | done
  // Caché de la app: los datos del cliente (contacto y dirección, NUNCA el
  // pago) se recuperan si vuelve al checkout.
  const [f, setF] = useState(() => ({
    email: "", phone: "", first_name: "", last_name: "", address_1: "", city: "", postal_code: "", country: "", country_code: "us",
    ...loadCache("rl_checkout_form", {}),
  }));
  // Cómo recibir la confirmación del pedido (el envío real es del backend).
  const [notify, setNotify] = useState(() => loadCache("rl_checkout_notify", { email: true, sms: false }));
  useEffect(() => { saveCache("rl_checkout_form", f); }, [f]);
  // Punto de retorno global; al completar el pedido se limpia.
  useEffect(() => { saveCache("rl_resume", { type: "checkout", url: "/checkout", name: null, at: Date.now() }); }, []);
  useEffect(() => { if (step === "done") { try { localStorage.removeItem("rl_resume"); } catch { /* nada */ } } }, [step]);
  useEffect(() => { saveCache("rl_checkout_notify", notify); }, [notify]);
  // ¿La dirección de facturación de la tarjeta es la misma del paciente? Si sí,
  // autorellenamos los datos de facturación de Stripe con los del paciente.
  const [cardMatches, setCardMatches] = useState(true);
  const [ship, setShip] = useState([]);
  const [shipId, setShipId] = useState("");
  // Cotización FedEx/DHL del servidor. null = aún sin pedir o backend sin la
  // ruta (se usa el flujo clásico de opciones Medusa como respaldo).
  const [carriers, setCarriers] = useState(null);
  const [carrierSel, setCarrierSel] = useState("");
  const [freeThreshold, setFreeThreshold] = useState(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [order, setOrder] = useState(null);
  // Líneas cuyo precio cambió al revalidar el carrito al entrar al checkout.
  const [repriced, setRepriced] = useState([]);
  // Estado real del Payment Element de Stripe: hasta ahora se montaba a ciegas,
  // así que si el iframe de Stripe no llegaba a cargar (bloqueador de anuncios,
  // ahorro de datos, red móvil lenta) el cliente veía una caja en blanco, sin
  // forma de elegir el método ni teclear la tarjeta, y el único aviso llegaba al
  // pulsar «Pagar» como un error crudo de Stripe ("elements should have a
  // mounted Payment Element"). Ahora el estado se sigue y se cuenta.
  const [payState, setPayState] = useState("idle"); // idle | loading | ready | error
  const [payLoadErr, setPayLoadErr] = useState("");
  const [payNonce, setPayNonce] = useState(0); // reintentar = volver a montar

  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const payElRef = useRef(null);
  const payMountRef = useRef(null); // instancia montada del Payment Element
  const paySecRef = useRef(null); // sección de pago (para traerla a la vista)
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

        // Last chance to correct a stale price before the customer commits: a
        // cart left open carries the frame price, lens matrix and tax rate from
        // whenever it was built. The backend re-quotes; we only display what it
        // says moved (`repriced`), because a total that changes between the cart
        // panel and the card form has to be stated, not slipped in.
        const r = await revalidateCart();
        if (r && r.cart) {
          setCart(r.cart);
          setRepriced(r.repriced || []);
        } else {
          const c = await getCart();
          setCart(c);
        }
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

  // ENVÍO SIN BOTÓN (pedido del cliente): en cuanto el correo y el domicilio
  // de entrega están completos, la cotización se pide sola (con un respiro de
  // 800 ms para no cotizar a cada tecla). Si el cliente corrige la dirección,
  // la línea de envío vuelve a "—" hasta re-cotizar.
  const quoteSigRef = useRef("");
  useEffect(() => {
    if (step !== "contact" || loading || !cart) return undefined;
    const emailOk = /\S+@\S+\.\S+/.test(f.email);
    const ready = emailOk && f.address_1.trim().length >= 5 && f.city.trim().length >= 2 && f.postal_code.trim().length >= 5;
    const sig = [f.email, f.address_1, f.city, f.postal_code].join("|");
    if (!ready) { quoteSigRef.current = ""; setShip([]); setCarriers(null); setCarrierSel(""); return undefined; }
    if (sig === quoteSigRef.current) return undefined;
    const tm = setTimeout(() => {
      quoteSigRef.current = sig;
      calcShipping();
    }, 800);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, loading, cart, f.email, f.address_1, f.city, f.postal_code]);

  const calcShipping = async () => {
    setErr(""); setBusy(true);
    try {
      await updateContact({
        email: f.email,
        shipping_address: shippingAddress(),
        // Preferencias que el backend usará para notificar (email/SMS) + idioma.
        metadata: { phone: f.phone || null, notify_email: notify.email, notify_sms: notify.sms, locale: lang },
      });
      // Cotización FedEx/DHL del servidor (gratis desde el umbral). Si la ruta
      // aún no está desplegada, quoteShipping() devuelve null y caemos al flujo
      // clásico de opciones Medusa — el checkout nunca se queda sin envío.
      const q = await quoteShipping();
      if (q && Array.isArray(q.quotes) && q.quotes.length) {
        setCarriers(q.quotes);
        setFreeThreshold(q.free_threshold || 100);
        setCarrierSel(q.quotes[0].carrier);
        // Para la puerta del paso de envío el flujo clásico usa `ship`:
        setShip([{ id: "__carriers__" }]);
      } else {
        const opts = await listShippingOptions();
        setShip(opts);
        if (opts[0]) setShipId(opts[0].id);
      }
    } catch (e) {
      if (e && e.reason === "us_only") setErr(t("ship.usOnly"));
      else setErr(e.message || String(e));
    }
    setBusy(false);
  };

  // Quitar una línea del carrito SIN salir del checkout (siempre debe poder
  // quitarse un elemento). El subtotal cambia, así que la cotización de envío
  // (gratis desde $100, tarifas FedEx/DHL) queda invalidada y se vuelve a pedir.
  const removeLine = async (lineId) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const c = await removeItem(lineId);
      if (c) setCart(c);
      setShip([]); setShipId(""); setCarriers(null); setCarrierSel("");
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
      // Transportista elegido (FedEx/DHL, re-cotizado en servidor) o, de
      // respaldo, la opción Medusa clásica.
      if (carriers && carrierSel) await selectCarrier(carrierSel);
      else await setShippingMethod(shipId);
      const { clientSecret } = await startPayment(DEFAULT_PROVIDER);
      setCart(await getCart());
      const stripe = await loadStripe(PK);
      stripeRef.current = stripe;
      // Apariencia de la casa para el formulario de Stripe: navy, compacto y en
      // el idioma elegido — el paso de pago cabe en una vista y se ve propio.
      const elements = stripe.elements({
        clientSecret,
        locale: lang === "en" ? "en" : "es",
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#0b2f66",
            colorText: "#17233a",
            fontSizeBase: "14px",
            spacingUnit: "3px",
            borderRadius: "10px",
          },
        },
      });
      elementsRef.current = elements;
      setStep("pay"); // el Payment Element se monta en el useEffect de abajo
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  // Monta (y re-monta) el Payment Element de Stripe. Si el cliente marca que la
  // tarjeta es del paciente, autorellenamos los datos de facturación con los
  // suyos (defaultValues.billingDetails); si lo desmarca, Stripe los pide.
  //
  // Montar no es lo mismo que estar listo: `mount()` sólo inserta el iframe de
  // Stripe, y el formulario vive DENTRO de ese iframe. Si nunca carga, el hueco
  // queda en blanco. Por eso escuchamos `ready`/`loaderror` y ponemos un plazo
  // máximo: sin esto el fallo era invisible hasta pulsar «Pagar».
  useEffect(() => {
    if (step !== "pay" || !elementsRef.current || !payElRef.current) return;
    const elements = elementsRef.current;
    if (payMountRef.current) { try { payMountRef.current.destroy(); } catch { /* noop */ } payMountRef.current = null; }
    setPayState("loading");
    setPayLoadErr("");
    // `fields.billingDetails.email: "never"` evita que Stripe muestre el campo de
    // email de Link, que es el que dispara la verificación fallida (401). El email
    // ya lo capturamos en los datos del paciente.
    const opts = {
      // Pestañas (una fila horizontal de métodos) + SIN Link: el bloque de
      // "guardar mi información" de Link medía ~260px y sacaba el pago de la
      // vista única; el email/celular ya viven en los datos del paciente.
      layout: { type: "tabs", defaultCollapsed: false },
      terms: { card: "never" },
      wallets: { applePay: "never", googlePay: "never" },
      fields: { billingDetails: { email: "never" } },
    };
    if (cardMatches) opts.defaultValues = { billingDetails: buildBilling() };
    let el;
    try {
      el = elements.create("payment", opts);
      // `ready` sólo llega cuando el formulario ya se pintó dentro del iframe;
      // es la única señal fiable de que el cliente puede teclear la tarjeta.
      el.on("ready", () => setPayState("ready"));
      el.on("loaderror", (ev) => {
        setPayLoadErr((ev && ev.error && ev.error.message) || "");
        setPayState("error");
      });
      el.mount(payElRef.current);
      payMountRef.current = el;
    } catch (e) {
      // `create()`/`mount()` pueden lanzar (p. ej. datos de facturación por
      // defecto inválidos). Antes esta excepción escapaba del efecto y dejaba la
      // pantalla muda.
      setPayLoadErr(e?.message || String(e));
      setPayState("error");
      return;
    }
    // Red móvil lenta o iframe bloqueado: `loaderror` no siempre llega, así que
    // a los 15 s damos el intento por fallido y ofrecemos reintentar. Si el
    // formulario aparece más tarde, `ready` devuelve el estado a «listo».
    const timer = setTimeout(() => setPayState((s) => (s === "loading" ? "error" : s)), 15000);
    return () => {
      clearTimeout(timer);
      try { el.destroy(); } catch { /* noop */ }
      payMountRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cardMatches, payNonce]);

  // En móvil el paso de pago aparece por debajo del resumen del pedido, que es
  // largo: sin esto el cliente se queda mirando los totales y no ve que ya hay
  // un formulario de tarjeta más abajo.
  useEffect(() => {
    if (step !== "pay" || !paySecRef.current) return;
    try { paySecRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* noop */ }
  }, [step]);

  const pay = async () => {
    setErr(""); setBusy(true);
    try {
      // Capture the cart id BEFORE charging: we must know what to complete, and
      // this guards against ever being charged with no id to reconcile. If it's
      // missing we bail before touching the card.
      const cartId = (cart && cart.id) || null;
      if (!cartId) { setErr(L("failed")); setBusy(false); return; }

      // Sin formulario montado, `confirmPayment` responde con un error interno de
      // Stripe en inglés que no le dice nada al cliente. Se corta antes y se le
      // explica qué pasa y qué hacer.
      if (payState !== "ready" || !payMountRef.current) { setErr(L("payNotReady")); setBusy(false); return; }

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
      {/* Cabecera (pedido del cliente): "Seguir comprando" alineado a la
          izquierda y el título CENTRADO, con la tarjeta dorada de la lámina. */}
      <div className="co-head">
        {step !== "done" && (
          <Link to="/catalogo" className="co-backlink">← {L("keepShopping")}</Link>
        )}
        <h1 className="co-title">
          <img className="co-title-ic" src="/ui/bn/bn-goldr-card.png" alt="" aria-hidden="true"
               onError={(e) => e.currentTarget.remove()} />
          {L("title")}
        </h1>
      </div>

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
          <div className="co-summary co-summary2">
            <div className="co-sum-navyhd">
              <img className="co-sum-ic" src="/ui/bn/bn-gold-deals.png" alt="" aria-hidden="true"
                   onError={(e) => e.currentTarget.remove()} />
              <span>{L("summary")}</span>
            </div>
            {/* El carrito se revalidó al abrir esta página. Si algún precio se
                movió respecto al que el cliente vio, se dice — no se pregunta. */}
            {repriced.length > 0 && (
              <div className="co-repriced" role="status">
                <b>{L("repricedTitle")}</b>
                <ul>
                  {repriced.map((r) => (
                    <li key={r.item_id}>
                      {r.title} · <s>{money(r.from)}</s> → <b>{money(r.to)}</b>
                    </li>
                  ))}
                </ul>
                <small>{L("repricedNote")}</small>
              </div>
            )}
            <ul className="panel-list">
              {(cart.items || []).map((i) => {
                const lc = i.metadata?.lens_config || {};
                const dl = DESIGN_LBL[lc.design_code];
                const parts = [dl ? (dl[lang] || dl.es) : lc.design_code, lc.material_code, lc.photo_code, lc.ar_code].filter(Boolean);
                // Ficha CLARA del pedido (pedido del cliente): espejuelo con su
                // foto, el cristal y los tratamientos con nombre legible.
                const mat = materialById(lc.material_code);
                const photoOpt = PHOTO.find((o) => o.id === lc.photo_code) || null;
                const arOpt = AR_OPTIONS.find((o) => o.id === lc.ar_code) || null;
                const treats = [photoOpt && LBL(photoOpt.label, lang), arOpt && LBL(arOpt.label, lang)].filter(Boolean);
                return (
                  <li key={i.id} className="panel-item co-item2">
                    {/* Clic en el espejuelo → su ficha; la miniatura pasa por
                        resolveImage (clave R2 → URL pública, ya no sale rota). */}
                    {i.thumbnail && (
                      <Link to={i.product_handle ? `/producto/${i.product_handle}` : "#"}
                            onClick={(e) => { if (!i.product_handle) e.preventDefault(); }}
                            className="co-item-phlink" aria-label={i.title}>
                        <img className="co-item-ph" src={resolveImage(i.thumbnail)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
                             onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                      </Link>
                    )}
                    <div className="panel-item-info">
                      <b>{i.product_handle
                        ? <Link className="co-item-title" to={`/producto/${i.product_handle}`}>{i.title}</Link>
                        : i.title}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</b>
                      {dl && <small><span className="co-dt">{L("frameLine")}:</span> {dl[lang] || dl.es}</small>}
                      {mat && <small><span className="co-dt">{L("lensLine")}:</span> {LBL(mat.label, lang)}</small>}
                      {treats.length > 0 && <small><span className="co-dt">{L("treatLine")}:</span> {treats.join(" · ")}</small>}
                      {i.metadata?.prescription_id && <small className="co-rx">✓ {L("withRx")}</small>}
                    </div>
                    <span className="panel-item-price">{money(i.total ?? i.unit_price)}</span>
                    {step === "contact" && (
                      <button
                        type="button"
                        className="panel-x co-item-x"
                        onClick={() => removeLine(i.id)}
                        disabled={busy}
                        aria-label={t("common.remove")}
                        title={t("common.remove")}
                      >×</button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="co-totals">
              {cart.item_total != null && <div><span>{L("subtotal")}</span><b>{money(cart.item_total)}</b></div>}
              {(() => {
                // Tarifa FIJA: en cuanto hay método de envío (cotizado solo al
                // completar la dirección), la línea dice FedEx · $28 — siempre.
                const ready = (carriers && carrierSel) || shipId || cart.shipping_total > 0;
                return (
                  <div>
                    <span>{L("shippingLine")}{ready ? " · FedEx" : ""}</span>
                    <b>{ready ? money(FEDEX_RATE) : "—"}</b>
                  </div>
                );
              })()}
              {cart.tax_total > 0 && <div><span>{L("tax")}</span><b>{money(cart.tax_total)}</b></div>}
              {(() => {
                // Impuesto de montura sola horneado en el precio (server-side);
                // se muestra como informativo "impuesto incluido".
                const inc = (cart.items || []).reduce((s, i) => s + Number(i.metadata?.tax_amount || 0), 0);
                return inc > 0 ? <div><span>{L("taxIncluded")}</span><b>{money(inc)}</b></div> : null;
              })()}
            </div>
            {(() => {
              // Total con la tarifa fija: lo que Medusa aún no haya sumado del
              // envío se completa hasta los $28 fijos para que el cliente vea
              // el número final real desde el principio.
              const ready = (carriers && carrierSel) || shipId || cart.shipping_total > 0;
              const pend = ready ? Math.max(0, FEDEX_RATE - Number(cart.shipping_total || 0)) : 0;
              return <div className="panel-total"><span>{L("total")}</span><b>{money(Number(cart.total || 0) + pend)}</b></div>;
            })()}
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
                    del contacto; sirve para SMS de confirmación y contacto. Va en
                    pareja con el país (fijo EE. UU.) para ahorrar una fila y que
                    todo el paso quepa en una vista en el móvil. */}
                <div className="co-two">
                  <input type="tel" placeholder={L("phone")} value={f.phone} onChange={set("phone")} autoComplete="tel" />
                  <input value={t("ship.usOnlyVal")} disabled aria-label={L("country")} title={t("ship.usOnlyNote")} />
                </div>
              </div>

              {/* Domicilio de entrega (pedido del cliente): sin botón de envío —
                  la cotización llega sola al completar la dirección. */}
              <div className="co-h co-h-ship">
                <img className="i3d i3d-co" src="/ui/icons3d/navy-truck.png" alt="" aria-hidden="true"
                     onError={(e) => { e.currentTarget.remove(); }} />
                {L("shipTo")}
              </div>
              <div className="co-fields">
                <div className="co-addr-wrap">
                  <input ref={addrRef} placeholder={L("address")} value={f.address_1} onChange={set("address_1")} autoComplete="street-address" />
                </div>
                <small className="co-hint">📍 {L("addrHint")}</small>
                <div className="co-two">
                  <input placeholder={L("city")} value={f.city} onChange={set("city")} autoComplete="address-level2" />
                  <input placeholder={L("zip")} value={f.postal_code} onChange={set("postal_code")} autoComplete="postal-code" />
                </div>
                {/* Solo USA por ahora (el campo fijo vive junto al celular); el
                    backend lo verifica igualmente (422 us_only). */}
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

              {/* Línea SUTIL de envío: aparece sola al completar la dirección
                  (cotizada en el servidor); mientras, una nota tranquila. Si el
                  servidor devolviera varias mensajerías, se elige aquí mismo. */}
              {(() => {
                const ready = (carriers && carrierSel) || shipId;
                if (busy && !ready) return <div className="co-shipline co-shipline-wait"><span className="btn-spin" aria-hidden="true" /> {L("processing")}</div>;
                if (!ready) return <small className="co-hint co-ship-pend">🚚 {L("shipPending")}</small>;
                return (
                  <div className="co-shipline" role="status">
                    <img className="i3d i3d-co" src="/ui/icons3d/navy2-truck.png" alt="" aria-hidden="true"
                         onError={(e) => e.currentTarget.remove()} />
                    <span className="co-shipline-tx">
                      <b>FedEx · {money(FEDEX_RATE)}</b>
                      <small>{t("ship.eta", { min: FEDEX_ETA, max: FEDEX_ETA })}{labDays > 0 ? ` · ${t("ship.labNote", { days: labDays })}` : ""}</small>
                    </span>
                  </div>
                );
              })()}
              <button className="btn btn-primary big" disabled={busy || (carriers ? !carrierSel : !shipId)} onClick={goToPay}>
                {busy ? <><span className="btn-spin" aria-hidden="true" /> {L("processing")}</> : L("pay")}
              </button>
            </div>
          )}

          {step === "pay" && (
            <div className="co-form co-payform" ref={paySecRef}>
              <div className="co-sum-navyhd co-pay-navyhd">
                <img className="co-sum-ic" src="/ui/icons3d/white-shield.png" alt="" aria-hidden="true"
                     onError={(e) => e.currentTarget.remove()} />
                <span>{L("payment")}</span>
                <small className="co-pay-safe">🔒 {t("trust.secure")}</small>
              </div>
              {/* Si la tarjeta es del paciente, autorellenamos los datos de
                  facturación de Stripe con los del paciente. Al cambiar, el
                  useEffect vuelve a montar el Payment Element. */}
              <label className="co-check co-cardmatch">
                <input type="checkbox" checked={cardMatches} onChange={(e) => setCardMatches(e.target.checked)} />
                <span>{L("cardMatches")}</span>
              </label>
              {/* El contenedor se pinta SIEMPRE: es el destino de `mount()`, así
                  que ocultarlo mientras carga dejaría a Stripe sin dónde montar. */}
              {/* TARJETA DE PRUEBA (pedido del dueño): mientras la llave de
                  Stripe sea de test (pk_test_), se enseña la tarjeta 4242 para
                  que nadie teclee datos reales. Al poner la llave live de la
                  cuenta final, esta cajita desaparece sola. */}
              {PK.startsWith("pk_test_") && (
                <div className="co-testcard" role="note">
                  <b>🧪 {L("testTitle")}</b>
                  <p>{L("testBody")}</p>
                  <div className="co-testcard-row">
                    <span>{L("testCard")}: <b>4242 4242 4242 4242</b></span>
                    <span>{L("testExp")}: <b>12/34</b> ({L("testAny")})</span>
                    <span>{L("testCvc")}: <b>123</b></span>
                    <span>{L("testZip")}: <b>77449</b></span>
                  </div>
                </div>
              )}
              <div ref={payElRef} className="co-pay-el" />
              {payState === "loading" && (
                <div className="co-pay-note" role="status">
                  <span className="btn-spin" aria-hidden="true" /> {L("payLoading")}
                </div>
              )}
              {payState === "error" && (
                <div className="co-pay-err" role="alert">
                  <b>{L("payLoadErrTitle")}</b>
                  <p>{L("payLoadErrBody")}</p>
                  {payLoadErr && <small className="muted">{payLoadErr}</small>}
                  <button type="button" className="btn btn-outline" onClick={() => setPayNonce((n) => n + 1)}>
                    {L("payRetry")}
                  </button>
                </div>
              )}
              <div className="co-pay-actions">
                <button className="btn btn-primary big" disabled={busy || payState !== "ready"} onClick={pay}>
                  {busy ? <><span className="btn-spin" aria-hidden="true" /> {L("paying")}</> : `${L("pay")} · ${money(cart.total)}`}
                </button>
                {/* Volver a los datos sin perder nada: el Payment Element se
                    desmonta y se vuelve a crear al regresar. */}
                <button
                  type="button"
                  className="btn btn-outline big co-back"
                  disabled={busy}
                  onClick={() => { setPayState("idle"); setStep("contact"); }}
                >
                  ← {L("backToData")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
