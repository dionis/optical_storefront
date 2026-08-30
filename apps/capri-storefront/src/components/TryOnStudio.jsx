import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { IconGlasses, IconLensWidth, IconBridge, IconTemple } from "./measureIcons.jsx";
import MeasureReport from "./MeasureReport.jsx";
import {
  startMeasurementJob,
  pollMeasurementJob,
  armMeasurementNotification,
  pickMeasurement,
  frameImageDataUrl,
} from "../data/visionMeasure.js";
import { getMeasureJob, setMeasureJob, clearMeasureJob } from "../data/tryOnState.js";

// Interfaz de CLIENTE del probador (producción).
//
// IZQUIERDA: captura guiada AUTOMÁTICA en dos pasos — (1) foto frontal cuando el
// cliente está de frente y cerca; (2) foto lateral cuando gira la cabeza y se le
// ven las orejas (para ver el encaje de las patillas). El cliente no pulsa nada;
// además hay un botón para subir cada foto manualmente.
// DERECHA: ficha profesional del marco (datos reales + foto + medidas + pie).
// El respaldo TryOn.jsx (motor 3D) queda intacto (ver README).

// Motor de detección facial (mismo que usa el respaldo TryOn.jsx).
const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.6";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HOLD_FRAMES = 90; // ~3 s sosteniendo la pose antes de capturar (más tiempo para colocarse)
const CAPDBG = typeof location !== "undefined" && location.search.includes("capdbg");

/* Iconos de medida vectorizados de los originales del cliente: ver ./measureIcons.jsx */

export default function TryOnStudio({ product, colorIdx = 0, onClose }) {
  const { t, tv, lang } = useLang();
  const [ci, setCi] = useState(colorIdx);
  const [now, setNow] = useState(() => new Date());
  const [headerH, setHeaderH] = useState(0);
  const autoDoneRef = useRef(false);

  // Cámara + captura automática
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const lmRef = useRef(null);
  const rafRef = useRef(0);
  const holdRef = useRef(0);
  const phaseRef = useRef("front");
  const [camStatus, setCamStatus] = useState("starting"); // starting | ready | denied | nocam
  const [phase, setPhase] = useState("front");             // front | side | done
  const [frontImg, setFrontImg] = useState(null);
  const [sideImg, setSideImg] = useState(null);
  const [guide, setGuide] = useState("");
  const [count, setCount] = useState(0);
  const frontInput = useRef(null);
  const sideInput = useRef(null);

  useEffect(() => { phaseRef.current = phase; holdRef.current = 0; setCount(0); }, [phase]);

  // Reloj en vivo (pie de la ficha)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Deja ver el menú superior de la web: el probador arranca bajo el header sticky
  // y bloquea el scroll del fondo mientras está abierto.
  useEffect(() => {
    const measure = () => {
      const h = document.querySelector(".header");
      setHeaderH(h ? Math.round(h.getBoundingClientRect().height) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    const prevOv = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("resize", measure); document.body.style.overflow = prevOv; };
  }, []);

  // Adjunta el stream al <video> activo (se remonta al cambiar de caja)
  const attachVideo = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  // Arranca cámara + FaceLandmarker
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setCamStatus("nocam"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setCamStatus("ready");
      } catch (e) {
        setCamStatus(e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "nocam");
        return;
      }
      try {
        const vision = await import(/* @vite-ignore */ MP);
        const fileset = await vision.FilesetResolver.forVisionTasks(MP + "/wasm");
        const lm = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL },
          runningMode: "VIDEO", numFaces: 1,
        });
        if (cancelled) { lm.close?.(); return; }
        lmRef.current = lm;
        rafRef.current = requestAnimationFrame(loop);
      } catch (e) { /* sin auto-captura: quedan las subidas manuales */ }
    }
    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      lmRef.current?.close?.();
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bucle de detección + captura automática
  function loop() {
    rafRef.current = requestAnimationFrame(loop);
    const v = videoRef.current, lm = lmRef.current;
    const ph = phaseRef.current;
    if (!v || !lm || ph === "done" || v.readyState < 2) return;
    let res;
    try { res = lm.detectForVideo(v, performance.now()); } catch { return; }
    const L = res?.faceLandmarks?.[0];
    if (CAPDBG) { loop._n = (loop._n || 0) + 1; if (loop._n % 15 === 0) console.log("CAPDBG", L ? "faceW " + Math.abs(L[454].x - L[234].x).toFixed(3) + " r " + ((L[1].x - L[234].x) / ((L[454].x - L[234].x) || 1e-6)).toFixed(3) : "noface", "ph", ph); }
    if (!L) { holdRef.current = 0; setCount(0); setGuide(t("cap.noFace")); return; }

    const R = L[234], Lf = L[454], nose = L[1];   // laterales del rostro + punta de nariz
    const faceW = Math.abs(Lf.x - R.x);
    const denom = (Lf.x - R.x) || 1e-6;
    const r = (nose.x - R.x) / denom;             // 0.5 ≈ de frente; lejos de 0.5 ≈ girado
    const centered = r > 0.38 && r < 0.62;
    const turned = r < 0.37 || r > 0.63;

    let ok = false, msg = "";
    if (ph === "front") {
      if (faceW < 0.09) msg = t("cap.closer");
      else if (!centered) msg = t("cap.lookFront");
      else { ok = true; msg = t("cap.hold"); }
    } else {
      if (!turned) msg = t("cap.turnLeft");
      else { ok = true; msg = t("cap.hold"); }
    }
    setGuide(msg);
    if (ok) {
      holdRef.current += 1;
      setCount(Math.max(1, Math.ceil((HOLD_FRAMES - holdRef.current) / (HOLD_FRAMES / 3))));
      if (holdRef.current >= HOLD_FRAMES) { capture(ph); }
    } else {
      holdRef.current = 0; setCount(0);
    }
  }

  function capture(ph) {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const cw = v.videoWidth, ch = v.videoHeight;
    const cn = document.createElement("canvas");
    cn.width = cw; cn.height = ch;
    const cx = cn.getContext("2d");
    cx.translate(cw, 0); cx.scale(-1, 1);         // espejo, como se muestra en pantalla
    cx.drawImage(v, 0, 0, cw, ch);
    const url = cn.toDataURL("image/jpeg", 0.9);
    holdRef.current = 0; setCount(0);
    if (ph === "front") { setFrontImg(url); setPhase("side"); }
    else { setSideImg(url); setPhase("done"); }
  }

  function onUpload(which, file) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      if (which === "front") { setFrontImg(rd.result); if (phaseRef.current === "front") setPhase("side"); }
      else { setSideImg(rd.result); if (phaseRef.current !== "done") setPhase("done"); }
    };
    rd.readAsDataURL(file);
  }
  function retake(which) {
    autoDoneRef.current = false;
    setMState("idle"); setMData(null);
    if (which === "front") { setFrontImg(null); setPhase("front"); }
    else { setSideImg(null); setPhase(frontImg ? "side" : "front"); }
  }

  // ── Medición óptica (IA): al tener las dos fotos se manda SOLO a Gemini ──
  // La referencia de escala (tarjeta ID-1 pegada al rostro) va SIEMPRE, invisible.
  const [mState, setMState] = useState("idle");    // idle | loading | error | result
  const [mData, setMData] = useState(null);
  const [mError, setMError] = useState(null);
  const [mCode, setMCode] = useState(null);
  const [mProg, setMProg] = useState(0);           // ms transcurridos (para el cargador)
  // Progreso de reintento reportado por el servicio mientras Gemini está saturado (ver
  // providers.py); { attempt, maxAttempts, slow, ... } o null entre reintentos.
  const [mProgress, setMProgress] = useState(null);
  // idle | pending | armed | error — el aviso por correo/WhatsApp ofrecido una vez que
  // mProgress.slow es cierto (desde el 2º-3º intento fallido, no hay que esperar a que
  // el cliente se rinda para ofrecerle no seguir mirando la pantalla).
  const [notifyState, setNotifyState] = useState("idle");
  const [notifyError, setNotifyError] = useState(null);
  // ¿Para quién son los espejuelos? "me" = para el propio cliente; "other" = referencia
  // para un familiar/amigo (con nombre opcional). Se guarda junto con la medición.
  const [forWhom, setForWhom] = useState("me");    // "me" | "other"
  const [otherName, setOtherName] = useState("");
  const mAbort = useRef(null);
  // El jobId del trabajo en curso, para que el formulario de aviso (fuera del flujo
  // async de doMeasure) sepa a qué trabajo armar el contacto.
  const jobIdRef = useRef(null);

  // Aplica el resultado (o el fallo) de un trabajo terminado — compartido entre el
  // arranque en frío (doMeasure) y la reanudación tras un remount (más abajo), para
  // que las dos rutas terminen exactamente igual.
  function settleMeasurement(promise, signal) {
    promise
      .then((resp) => {
        clearMeasureJob(product);
        if (signal.aborted) return;
        const picked = pickMeasurement(resp);
        if (!picked.ok && picked.pd == null && !picked.frontImage) {
          setMCode(picked.errorCode); setMError(picked.error); setMState("error");
        } else {
          setMData(picked); setMState("result");
        }
      })
      .catch((e) => {
        clearMeasureJob(product);
        if (e?.code === "aborted" || e?.name === "AbortError") return;
        setMCode(e?.code || null); setMError(e?.message || null); setMState("error");
      });
  }

  // Progreso de un sondeo: cuenta los ms para el cargador, publica el intento actual
  // (para decidir si mostrar el aviso) y refleja si un contacto ya quedó guardado —
  // por si otra pestaña, o una reanudación anterior, ya lo armó.
  function onMeasureProgress({ elapsedMs, progress, notifyArmed }) {
    setMProg(elapsedMs);
    setMProgress(progress || null);
    if (notifyArmed) setNotifyState("armed");
  }

  async function doMeasure() {
    if (!frontImg || !sideImg) return;
    if (mAbort.current) mAbort.current.abort();
    const ctrl = new AbortController();
    mAbort.current = ctrl;
    setMState("loading"); setMError(null); setMCode(null); setMProg(0);
    setMProgress(null); setNotifyState("idle"); setNotifyError(null);
    try {
      // Flujo ASÍNCRONO: se envían las DOS fotos (frontal→DIP, lateral→altura de
      // corredor) + la foto REAL de la montura. El backend mide y luego Gemini GENERA
      // el rostro con los espejuelos puestos; el navegador va preguntando el estado y
      // NUNCA corta la generación. Las fotos se comprimen antes de subir.
      const at = product?.attributes || {};
      const glassesImage = color?.image ? await frameImageDataUrl(color.image) : null;
      const jobId = await startMeasurementJob({
        faceImage: frontImg,
        sideImage: sideImg,
        glassesImage,
        frameSpec: { name: product?.name, eye: at.eye_size, bridge: at.bridge_size, temple: at.temple_length },
        lang, withReferenceCard: true, render: true,
        signal: ctrl.signal,
      });
      jobIdRef.current = jobId;
      // Guardado ANTES de esperar: si este componente se remonta a mitad de la espera
      // (ver tryOnState.js), el trabajo sigue vivo en el servidor y la instancia nueva
      // puede reconectarse a él en vez de mandar al cliente de vuelta a las fotos.
      setMeasureJob(product, { jobId, frontImg, sideImg });
      settleMeasurement(pollMeasurementJob(jobId, { onProgress: onMeasureProgress, signal: ctrl.signal }), ctrl.signal);
    } catch (e) {
      if (e?.code === "aborted" || e?.name === "AbortError") return;
      setMCode(e?.code || null); setMError(e?.message || null); setMState("error");
    }
  }

  // Reconecta con un trabajo que ya estaba corriendo cuando este componente se montó
  // — el caso que antes se veía como "me mandó de vuelta a la pantalla de fotos": el
  // trabajo en el servidor nunca se enteró de que el navegador lo dejó de ver un
  // instante, solo el estado de React se había perdido.
  useEffect(() => {
    const pending = getMeasureJob(product);
    if (!pending) return;
    const ctrl = new AbortController();
    mAbort.current = ctrl;
    jobIdRef.current = pending.jobId;
    if (pending.frontImg) setFrontImg(pending.frontImg);
    if (pending.sideImg) setSideImg(pending.sideImg);
    setPhase("done");
    setMState("loading"); setMError(null); setMCode(null); setMProg(0);
    setMProgress(null); setNotifyState("idle"); setNotifyError(null);
    settleMeasurement(
      pollMeasurementJob(pending.jobId, { onProgress: onMeasureProgress, signal: ctrl.signal }),
      ctrl.signal
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guarda el contacto contra el trabajo en curso y deja de sondear en primer plano:
  // el trabajo sigue corriendo en el servidor pase lo que pase con este componente, así
  // que no hay nada más que este cliente tenga que seguir haciendo una vez guardado.
  async function handleNotifySubmit(email, whatsapp) {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    if (!email && !whatsapp) {
      setNotifyState("error"); setNotifyError(t("vm.slowNeedContact"));
      return;
    }
    setNotifyState("pending"); setNotifyError(null);
    const result = await armMeasurementNotification(jobId, { email, whatsapp }, lang);
    if (!result.ok) {
      setNotifyState("error"); setNotifyError(result.error || t("vm.slowError"));
      return;
    }
    setNotifyState("armed");
    mAbort.current?.abort();
  }

  function closeReport() {
    if (mAbort.current) { mAbort.current.abort(); mAbort.current = null; }
    clearMeasureJob(product);
    jobIdRef.current = null;
    setMProgress(null); setNotifyState("idle"); setNotifyError(null);
    setMState("idle");
  }

  // Vista previa sin cámara: ?vmdemo=result | ?vmdemo=loading (solo para revisar el diseño).
  useEffect(() => {
    const p = typeof location !== "undefined" && new URLSearchParams(location.search).get("vmdemo");
    if (!p) return;
    if (p === "loading") { setMState("loading"); setMProg(37000); return; }
    setMData({ pd: 63, pdRight: 31.5, pdLeft: 31.5, corridor: 22, progressive: 22, bifocal: null,
      suitable: true, warnings: [], frontImage: null, profileImage: null });
    setMState("result");
  }, []);

  // (El envío a Gemini es manual: botón "Calcular mis medidas" cuando hay dos fotos.)

  // ── Datos de la ficha (derecha) ──
  const colors = product?.colors || [];
  const color = colors[ci] || colors[0] || null;
  const a = product?.attributes || {};

  const fmt = (v) => {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    if (!s) return null;
    return /^[\d.,\s]+$/.test(s) ? `${s} mm` : s;
  };
  const eyeD = fmt(a.eye_size), bridgeD = fmt(a.bridge_size), templeD = fmt(a.temple_length);

  const materials = Array.isArray(a.material) ? a.material : (a.material ? [a.material] : []);
  const materialText = materials.length
    ? materials.map((m) => tv(String(m))).join(` ${t("fs.and")} `)
    : null;
  const shapeText = a.shape ? tv(a.shape) : null;
  const na = t("fs.na");

  const locale = lang === "en" ? "en-US" : "es-ES";
  const dateStr = now.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const cells = [
    { key: "eye", label: t("fs.lensWidth"), value: eyeD, Icon: IconLensWidth },
    { key: "bridge", label: t("fs.bridge"), value: bridgeD, Icon: IconBridge },
    { key: "temple", label: t("fs.temple"), value: templeD, Icon: IconTemple },
  ];
  const specRows = [
    { key: "model", label: t("fs.model"),
      node: (<>{product.name}{product.brand ? <span className="fs-sub"> ({product.brand})</span> : null}</>) },
    { key: "color", label: t("fs.color"), node: color?.name || na },
    materialText && { key: "material", label: t("fs.material"), node: materialText },
    shapeText && { key: "shape", label: t("fs.shape"), node: shapeText },
  ].filter(Boolean);

  // ── Estado de cada caja de captura ──
  const camMsg = camStatus === "starting" ? t("tryon.starting")
    : camStatus === "denied" ? t("tryon.denied")
    : camStatus === "nocam" ? t("tryon.noCam") : "";

  // Caja de captura (frontal o lateral). Se llama como función (no como <Componente/>)
  // para no remontar el <video> en cada render y perder la cámara.
  function capBox({ which, num, title, img, active, waiting }) {
    return (
      <div className={`cap-box ${active ? "on" : ""}`}>
        <div className="cap-head">
          <span className="cap-title"><span className="cap-num">{num}</span>{title}</span>
          <button type="button" className="cap-up"
                  onClick={() => (which === "front" ? frontInput : sideInput).current?.click()}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
            {t(which === "front" ? "cap.upFront" : "cap.upSide")}
          </button>
        </div>
        <div className="cap-media">
          {img ? (
            <>
              <img src={img} alt={title} />
              <span className="cap-badge cap-ok">✓ {t("cap.ready")}</span>
              <button type="button" className="cap-retake" onClick={() => retake(which)}
                      title={t("cap.retake")} aria-label={t("cap.retake")}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L2.5 9" /><path d="M2.5 3.5V9H8" /></svg>
                <span>{t("cap.retake")}</span>
              </button>
            </>
          ) : active && camStatus === "ready" ? (
            <>
              <video ref={attachVideo} className="cap-video" playsInline muted />
              <span className="cap-badge">● {t("cap.auto")}</span>
              {count > 0 && <div className="cap-count">{count}</div>}
              <div className="cap-guide">{guide || t(which === "front" ? "cap.lookFront" : "cap.turnLeft")}</div>
            </>
          ) : (
            <div className="cap-ph">
              {camStatus !== "ready" ? camMsg
                : waiting ? t("cap.waitFront")
                : which === "side" ? t("cap.sideHint") : ""}
            </div>
          )}
        </div>
      </div>
    );
  }

  return createPortal(
    <div className="tryon tryon-studio" role="dialog" aria-modal="true" style={{ top: headerH || 0 }}>
      <div className="tryon-bar">
        <button className="tryon-x" onClick={onClose} aria-label={t("tryon.close")}>×</button>
      </div>

      <input ref={frontInput} type="file" accept="image/*" hidden
             onChange={(e) => onUpload("front", e.target.files && e.target.files[0])} />
      <input ref={sideInput} type="file" accept="image/*" hidden
             onChange={(e) => onUpload("side", e.target.files && e.target.files[0])} />

      <div className="tryon-studio-grid">
        {/* Izquierda: captura guiada automática (frontal + lateral) */}
        <div className="tryon-studio-cap">
          {capBox({ which: "front", num: "1", title: t("cap.front"), img: frontImg, active: phase === "front", waiting: false })}
          {capBox({ which: "side", num: "2", title: t("cap.side"), img: sideImg, active: phase === "side", waiting: phase === "front" })}
        </div>

        {/* Derecha: ficha profesional del marco ("Información de la montura") */}
        <aside className="fs-card">
          <div className="fs-hd"><IconGlasses className="fs-hd-ic" />{t("fs.frameInfo")}</div>

          <div className="fs-top">
            <div className="fs-info">
              <dl className="fs-specs">
                {specRows.map((row) => (
                  <div className="fs-row" key={row.key}>
                    <dt>{row.label}</dt>
                    <dd>{row.node}</dd>
                  </div>
                ))}
              </dl>
              {colors.length > 1 && (
                <div className="fs-swatches" role="listbox" aria-label={product.name}>
                  {colors.map((c, i) => (
                    <button key={c.name + i} type="button" role="option" aria-selected={i === ci}
                            className={`fs-sw ${i === ci ? "on" : ""}`} style={{ background: c.hex || "#ccc" }}
                            title={c.name} aria-label={c.name} onClick={() => setCi(i)} />
                  ))}
                </div>
              )}
            </div>
            <div className="fs-photo">
              {color?.image
                ? <img src={color.image} referrerPolicy="no-referrer"
                       alt={`${product.name} ${color?.name || ""}`}
                       onError={(e) => { e.currentTarget.style.opacity = 0.15; }} />
                : <div className="fs-photo-ph" aria-hidden="true">👓</div>}
            </div>
          </div>

          <div className="fs-measures">
            <div className="fs-mhead">
              {cells.map((c) => <span key={c.key}>{c.label}</span>)}
            </div>
            <div className="fs-mbody">
              {cells.map(({ key, value, Icon }) => (
                <div className="fs-mcell" key={key}>
                  <Icon className="fs-mic" />
                  <b className="fs-mval">{value || "—"}</b>
                </div>
              ))}
            </div>
          </div>

          {/* Pie profesional: fecha, hora y logo RUBI_LENS */}
          <div className="fs-foot">
            <div className="fs-foot-meta">
              <span className="fs-foot-date">
                <svg className="fs-foot-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="17" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>
                {dateStr}
              </span>
              <span className="fs-foot-time">
                <svg className="fs-foot-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5l3.5 2" /></svg>
                {timeStr}
              </span>
            </div>
            <img src="/logo.svg" alt="RUBI_LENS" className="fs-foot-logo" />
          </div>
        </aside>
      </div>

      {frontImg && sideImg && mState === "idle" && (
        <div className="vm-actionbar">
          {/* ¿Para quién son los espejuelos? Se puede medir para uno mismo o como
              referencia para un familiar/amigo. Se guarda junto con la medición. */}
          <div className="vm-who">
            <span className="vm-who-q">{t("vm.who.title")}</span>
            <div className="vm-who-opts" role="radiogroup" aria-label={t("vm.who.title")}>
              <button type="button" role="radio" aria-checked={forWhom === "me"}
                      className={`vm-who-opt ${forWhom === "me" ? "on" : ""}`}
                      onClick={() => setForWhom("me")}>{t("vm.who.me")}</button>
              <button type="button" role="radio" aria-checked={forWhom === "other"}
                      className={`vm-who-opt ${forWhom === "other" ? "on" : ""}`}
                      onClick={() => setForWhom("other")}>{t("vm.who.other")}</button>
            </div>
            {forWhom === "other" && (
              <input className="vm-who-name" type="text" value={otherName} maxLength={60}
                     onChange={(e) => setOtherName(e.target.value)}
                     placeholder={t("vm.who.otherName")} aria-label={t("vm.who.otherName")} />
            )}
          </div>
          <span className="vm-actionbar-ok">✓ {t("cap.front")} · {t("cap.side")}</span>
          <button type="button" className="vm-go" onClick={doMeasure}>📐 {t("vm.calc")}</button>
        </div>
      )}

      {mState !== "idle" && (
        <MeasureReport
          phase={mState} data={mData} frontFallback={frontImg} sideFallback={sideImg}
          error={mError} errorCode={mCode} topOffset={headerH || 0} progressMs={mProg}
          slow={Boolean(mProgress?.slow)} notifyState={notifyState} notifyError={notifyError}
          onNotifySubmit={handleNotifySubmit}
          product={product} color={color}
          onRetry={doMeasure} onClose={closeReport}
        />
      )}
    </div>,
    document.body
  );
}
