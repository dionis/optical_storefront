import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { IconGlasses, IconLensWidth, IconBridge, IconTemple } from "./measureIcons.jsx";
import MeasureReport from "./MeasureReport.jsx";
// Medición propia (sin IA): PD + altura de corredor con iris + landmarks + dims del
// marco. Sustituye los números de Gemini; la IA solo hace el montaje de las gafas.
import { measureFromFrontal, pdFromLandmarks } from "../data/opticalMeasure.js";
import {
  startMeasurementJob,
  pollMeasurementJob,
  armMeasurementNotification,
  pickMeasurement,
  frameImageDataUrl,
} from "../data/visionMeasure.js";
import {
  getMeasureJob, setMeasureJob, clearMeasureJob,
  saveMeasureResult, getMeasureResult, clearMeasureResult,
} from "../data/tryOnState.js";

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

/* Sonido de obturador de cámara (WebAudio, sin assets externos). Al capturar cada
   foto el cliente oye el "clic" de la cámara — como en una óptica real — para que
   sepa que la toma se realizó. kind="shutter": foto frontal (clic + cierre mecánico);
   kind="click": foto lateral (clic nítido de cierre, señal de que ya se tomaron las
   medidas). Falla en silencio si el navegador bloquea el audio. */
function playShutter(kind) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const sr = ctx.sampleRate;
    const now = ctx.currentTime;
    const burst = (start, dur, freq, q, gain, type) => {
      const buf = ctx.createBuffer(1, Math.max(1, Math.floor(sr * dur)), sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const p = i / d.length;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 3);
      }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const flt = ctx.createBiquadFilter();
      flt.type = type || "bandpass"; flt.frequency.value = freq; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(flt).connect(g).connect(ctx.destination);
      src.start(now + start);
    };
    // Clic de apertura, nítido y agudo.
    burst(0, 0.05, 3200, 1.1, 0.32, "bandpass");
    if (kind === "shutter") {
      // Cierre mecánico del espejo, más grave, tras ~85 ms (obturador tipo réflex).
      burst(0.085, 0.12, 1100, 0.7, 0.34, "lowpass");
    }
    setTimeout(() => ctx.close?.(), 700);
  } catch { /* audio no disponible: silencio */ }
}

/* Iconos de medida vectorizados de los originales del cliente: ver ./measureIcons.jsx */

// Iconos de "ampliar" (lupa) y "descargar" para las fotos del resultado.
const IC_ZOOM = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
);
const IC_DOWN = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
);

// Nombre de archivo al descargar: "frontal/lateral-<modelo> <serie> <color>.ext".
function fileExtFromDataUrl(src) {
  const m = /^data:image\/(png|jpe?g|webp)/i.exec(src || "");
  if (!m) return "png";
  const t = m[1].toLowerCase();
  return t === "jpeg" ? "jpg" : t;
}
function cleanFilePart(s) {
  return String(s || "").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
}

// Mediana (robusta a valores atípicos) de una lista de números.
function median(nums) {
  const a = nums.filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export default function TryOnStudio({ product, colorIdx = 0, onClose, onAddPrescription }) {
  const { t, tv, lang } = useLang();
  // Confirmación tras "Añadir receta" ("idle" | "added").
  const [addedState, setAddedState] = useState("idle");
  // Imagen del resultado ampliada (lightbox): { src, which } | null.
  const [zoom, setZoom] = useState(null);
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
  // Detección de espejuelos en la captura (para pedir que se los quiten).
  const gsCanvasRef = useRef(null);
  const gsTickRef = useRef(0);
  const gsHitsRef = useRef(0);
  // Muestras de PD acumuladas durante el "no te muevas" (para promediar el PD y
  // que salga estable, no dependiente de un solo fotograma con ruido).
  const pdSamplesRef = useRef([]);
  const capturedPdRef = useRef(null);   // { pd, pdRight, pdLeft } mediana de la toma

  useEffect(() => {
    phaseRef.current = phase; holdRef.current = 0; setCount(0);
    if (phase === "front") pdSamplesRef.current = [];   // nueva toma: reinicia muestras de PD
  }, [phase]);

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

  // ¿El cliente lleva espejuelos? Heurística por imagen: densidad de bordes +
  // reflejos en la zona de los ojos comparada con las mejillas. Con persistencia
  // (varios frames) para evitar falsos positivos puntuales. La SUBIDA MANUAL de la
  // foto NO pasa por aquí, así que siempre hay una vía para continuar.
  function wearingGlasses(v, L) {
    gsTickRef.current = (gsTickRef.current + 1) % 5;
    if (gsTickRef.current === 0) {
      const s = glassesScore(v, L);
      gsHitsRef.current = Math.max(0, Math.min(6, gsHitsRef.current + (s > 1.0 ? 1 : -1)));
    }
    return gsHitsRef.current >= 3;
  }

  function glassesScore(v, L) {
    try {
      const vw = v.videoWidth, vh = v.videoHeight;
      if (!vw || !vh) return 0;
      const cw = 256, ch = Math.round(cw * vh / vw) || 1;
      let cn = gsCanvasRef.current;
      if (!cn) { cn = document.createElement("canvas"); gsCanvasRef.current = cn; }
      cn.width = cw; cn.height = ch;
      const cx = cn.getContext("2d", { willReadFrequently: true });
      cx.drawImage(v, 0, 0, cw, ch);
      const d = cx.getImageData(0, 0, cw, ch).data;
      const lum = (x, y) => {
        x = x < 0 ? 0 : x >= cw ? cw - 1 : x;
        y = y < 0 ? 0 : y >= ch ? ch - 1 : y;
        const i = (y * cw + x) * 4;
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      };
      const box = (x0, y0, x1, y1) => {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        if (x1 <= x0 + 2 || y1 <= y0 + 2) return { e: 0, bright: 0 };
        let sum = 0, n = 0, bright = 0;
        for (let y = y0 + 1; y < y1 - 1; y += 2) {
          for (let x = x0 + 1; x < x1 - 1; x += 2) {
            sum += Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
            if (lum(x, y) > 245) bright++;
            n++;
          }
        }
        return n ? { e: sum / n, bright: bright / n } : { e: 0, bright: 0 };
      };
      const P = (i) => ({ x: L[i].x * cw, y: L[i].y * ch });
      const oL = P(33), oR = P(263), bTop = P(168), lidL = P(145), lidR = P(374);
      const eyeX0 = Math.min(oL.x, oR.x) - cw * 0.03;
      const eyeX1 = Math.max(oL.x, oR.x) + cw * 0.03;
      const eyeY0 = Math.min(oL.y, oR.y, bTop.y) - ch * 0.02;
      const eyeY1 = Math.max(lidL.y, lidR.y) + ch * 0.03;
      const eye = box(eyeX0, eyeY0, eyeX1, eyeY1);
      const cheekY0 = eyeY1 + ch * 0.02;
      const cheek = box(eyeX0, cheekY0, eyeX1, cheekY0 + (eyeY1 - eyeY0) * 0.9);
      const ratio = eye.e / (cheek.e + 1e-3);
      const s = Math.max(0, (ratio - 1.7) / 1.3) + Math.max(0, (eye.bright - 0.008) * 9);
      if (CAPDBG) console.log("[glasses] ratio", ratio.toFixed(2), "bright", eye.bright.toFixed(3), "s", s.toFixed(2));
      return s;
    } catch { return 0; }
  }

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
      else if (wearingGlasses(v, L)) { msg = t("cap.glasses"); }
      else { ok = true; msg = t("cap.hold"); }
    } else {
      if (!turned) msg = t("cap.turnLeft");
      else { ok = true; msg = t("cap.hold"); }
    }
    setGuide(msg);
    if (ok) {
      // Mientras la pose frontal es buena, acumulamos medidas de PD de CADA
      // fotograma; al capturar se toma la MEDIANA (estable, sin ruido de un solo
      // frame). Solo tomas dentro de un rango humano razonable.
      if (ph === "front") {
        const sp = pdFromLandmarks(L, v.videoWidth, v.videoHeight);
        if (sp && sp.pdTotal > 45 && sp.pdTotal < 82) {
          pdSamplesRef.current.push(sp);
          if (pdSamplesRef.current.length > 150) pdSamplesRef.current.shift();
        }
      }
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
    // Sonido de cámara: obturador completo en la 1ª foto, clic nítido de cierre en la
    // 2ª (señal de que ya se tomaron las dos tomas para las medidas).
    if (ph === "front") {
      // PD ESTABLE: mediana de todas las muestras acumuladas durante el "no te
      // muevas" (no un solo fotograma). El reparto OD/OS solo si la mayoría de
      // las muestras lo dieron válido (pose frontal); si no, se deja al binocular.
      const S = pdSamplesRef.current;
      if (S.length >= 5) {
        const rights = S.map((s) => s.pdRight).filter((x) => x != null);
        const lefts = S.map((s) => s.pdLeft).filter((x) => x != null);
        capturedPdRef.current = {
          pd: median(S.map((s) => s.pdTotal)),
          pdRight: rights.length > S.length * 0.5 ? median(rights) : null,
          pdLeft: lefts.length > S.length * 0.5 ? median(lefts) : null,
        };
      } else {
        capturedPdRef.current = null;
      }
      setFrontImg(url); setPhase("side"); playShutter("shutter");
    } else { setSideImg(url); setPhase("done"); playShutter("click"); }
  }

  function onUpload(which, file) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      if (which === "front") {
        // Foto SUBIDA: no hay muestras de cámara; se usa la medición robusta de un
        // solo fotograma (escala de iris mejorada). Limpiamos el promedio de cámara.
        capturedPdRef.current = null; pdSamplesRef.current = [];
        setFrontImg(rd.result); if (phaseRef.current === "front") setPhase("side"); playShutter("shutter");
      } else { setSideImg(rd.result); if (phaseRef.current !== "done") setPhase("done"); playShutter("click"); }
    };
    rd.readAsDataURL(file);
  }
  function retake(which) {
    autoDoneRef.current = false;
    setMState("idle"); setMData(null);
    // Se va a rehacer la toma: la generación guardada ya no aplica.
    clearMeasureResult(product);
    if (which === "front") { capturedPdRef.current = null; pdSamplesRef.current = []; setFrontImg(null); setPhase("front"); }
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

  // Medición propia (MediaPipe) calculada en el navegador desde la foto frontal. Se
  // guarda aquí para fusionarla con el resultado del trabajo (settleMeasurement) y así
  // los NÚMEROS salen de nuestro cálculo, no de la IA. Falla en silencio → cae a la IA.
  const ourMeasureRef = useRef(null);
  async function computeOurMeasurement(frontDataUrl) {
    const at = product?.attributes || {};
    try {
      const m = await measureFromFrontal(frontDataUrl, {
        eye: at.eye_size, bridge: at.bridge_size, b: at.b_measurement,
      });
      ourMeasureRef.current = m && m.ok ? m : null;
    } catch {
      ourMeasureRef.current = null;
    }
  }
  // Sobrescribe los números del sobre con los NUESTROS cuando están disponibles.
  function applyOurNumbers(picked) {
    if (!picked) return picked;
    const mine = ourMeasureRef.current;
    if (mine) {
      if (mine.pdTotal != null) picked.pd = mine.pdTotal;
      if (mine.pdRight != null) picked.pdRight = mine.pdRight;
      if (mine.pdLeft != null) picked.pdLeft = mine.pdLeft;
      if (mine.corridor != null) { picked.corridor = mine.corridor; picked.progressive = mine.corridor; }
      if (mine.bifocal != null) picked.bifocal = mine.bifocal;
      if (mine.suitable != null) picked.suitable = mine.suitable;
      if (mine.minRequired != null) picked.minRequired = mine.minRequired;
      if (mine.quality) picked.quality = mine.quality;
      if (mine.fit) picked.fit = mine.fit;
      picked.measuredBy = "device";
    }
    // Si la foto se TOMÓ con la cámara, el PD promedio (mediana de muchos
    // fotogramas) es más fiable que el de un solo frame: manda ese.
    const cap = capturedPdRef.current;
    if (cap && cap.pd != null) {
      picked.pd = Math.round(cap.pd * 10) / 10;
      if (cap.pdRight != null) picked.pdRight = Math.round(cap.pdRight * 10) / 10;
      if (cap.pdLeft != null) picked.pdLeft = Math.round(cap.pdLeft * 10) / 10;
      picked.measuredBy = "device";
    }
    return picked;
  }

  // Aplica el resultado (o el fallo) de un trabajo terminado — compartido entre el
  // arranque en frío (doMeasure) y la reanudación tras un remount (más abajo), para
  // que las dos rutas terminen exactamente igual.
  function settleMeasurement(promise, signal) {
    promise
      .then((resp) => {
        clearMeasureJob(product);
        if (signal.aborted) return;
        const picked = applyOurNumbers(pickMeasurement(resp));
        if (!picked.ok && picked.pd == null && !picked.frontImage) {
          setMCode(picked.errorCode); setMError(picked.error); setMState("error");
        } else {
          setMData(picked); setMState("result");
          // Persistimos la generación (imágenes + números) para que salir/reabrir el
          // estudio NO obligue a re-generar: al reabrir se restaura tal cual.
          try { saveMeasureResult(product, { data: picked, frontImg, sideImg }); } catch { /* cuota: se ignora */ }
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
      // En paralelo: descargamos la foto del marco Y calculamos NUESTRAS medidas
      // (MediaPipe) desde la frontal, para tenerlas listas antes de que termine el
      // trabajo. Los números saldrán de aquí; la IA solo monta las gafas.
      const [glassesImage] = await Promise.all([
        color?.image ? frameImageDataUrl(color.image) : Promise.resolve(null),
        computeOurMeasurement(frontImg),
      ]);
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
    if (pending.frontImg) { setFrontImg(pending.frontImg); computeOurMeasurement(pending.frontImg); }
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

  // Restaura la ÚLTIMA generación guardada (imágenes + números) al reabrir el estudio.
  // El cliente cerró la pantalla y volvió: en vez de re-generar (segundos/minutos +
  // otra petición a Gemini), mostramos el resultado tal cual quedó. Si hay un trabajo
  // aún en curso, manda la reconexión de arriba y NO restauramos un resultado viejo.
  useEffect(() => {
    if (getMeasureJob(product)) return;
    const saved = getMeasureResult(product);
    if (!saved || !saved.data) return;
    if (saved.frontImg) setFrontImg(saved.frontImg);
    if (saved.sideImg) setSideImg(saved.sideImg);
    setPhase("done");
    setMData(saved.data);
    setMState("result");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // En RESPONSIVE la barra de "Calcular medidas" queda por debajo del pliegue: en
  // cuanto están las dos fotos la traemos a la vista para que el cliente no se pierda
  // y sepa exactamente qué pulsar a continuación.
  const actionbarRef = useRef(null);
  useEffect(() => {
    if (frontImg && sideImg && mState === "idle" && typeof window !== "undefined" && window.innerWidth <= 900) {
      requestAnimationFrame(() =>
        actionbarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
    }
  }, [frontImg, sideImg, mState]);

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

  // Compartir la prueba (rostro con los espejuelos). En móvil usa el compartir
  // nativo con la imagen (WhatsApp, etc.); si no está disponible, descarga la
  // imagen y abre WhatsApp con un mensaje para adjuntarla. Enganche de conversión:
  // el cliente enseña la prueba y decide con quien quiera.
  async function shareResult() {
    const src = mData?.frontImage || frontImg;
    const text = t("vm.shareText");
    const title = "Óptica El Rancho";
    const url = typeof location !== "undefined" ? location.href : "";
    try {
      if (src && typeof navigator !== "undefined" && navigator.canShare) {
        const blob = await (await fetch(src)).blob();
        const file = new File([blob], "prueba-espejuelos.jpg", { type: blob.type || "image/jpeg" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text, title });
          return;
        }
      }
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text, title, url });
        return;
      }
    } catch { return; /* el usuario canceló el diálogo de compartir */ }
    // Fallback (escritorio sin compartir nativo): descarga + WhatsApp con texto.
    try {
      if (src) {
        const a = document.createElement("a");
        a.href = src; a.download = "prueba-espejuelos.jpg"; a.click();
      }
    } catch { /* descarga no disponible */ }
    window.open(`https://wa.me/?text=${encodeURIComponent(text + (url ? " " + url : ""))}`, "_blank", "noopener");
  }

  // Nombre del archivo de la foto generada: "frontal|lateral-<modelo> <serie> <color>".
  function resultFileName(which, src) {
    const base = [product?.name, product?.brand, color?.name].map(cleanFilePart).filter(Boolean).join(" ");
    const prefix = which === "side" ? "lateral" : "frontal";
    return `${prefix}${base ? "-" + base : ""}.${fileExtFromDataUrl(src)}`;
  }

  // Dibuja las medidas SOBRE la foto (para descargarla ya rotulada, no como una
  // imagen suelta). Si algo falla (imagen remota sin CORS…) devuelve la original.
  async function composeWithMeasures(src) {
    if (!src) return src;
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
      });
      const W = img.naturalWidth || img.width;
      const H = img.naturalHeight || img.height;
      if (!W || !H) return src;
      const cn = document.createElement("canvas");
      cn.width = W; cn.height = H;
      const cx = cn.getContext("2d");
      cx.drawImage(img, 0, 0, W, H);

      const lines = [
        `DIP: ${mmv(mData?.pd)}`,
        (mData?.pdRight != null || mData?.pdLeft != null)
          ? `OD ${mmv(mData?.pdRight)}   ·   OS ${mmv(mData?.pdLeft)}` : null,
        `Altura de corredor: ${mmv(mData?.corridor)}`,
        `Lente · Puente: ${eyeD || "—"} · ${bridgeD || "—"}`,
      ].filter(Boolean);

      const s = W / 1000;                                   // escala tipográfica
      const pad = Math.round(28 * s);
      const lh = Math.round(40 * s);
      const headH = Math.round(96 * s);
      const panelH = headH + lines.length * lh + pad;
      const gy = Math.max(0, H - panelH);

      const grad = cx.createLinearGradient(0, gy, 0, H);
      grad.addColorStop(0, "rgba(9,18,40,0)");
      grad.addColorStop(0.28, "rgba(9,18,40,0.86)");
      grad.addColorStop(1, "rgba(6,12,26,0.96)");
      cx.fillStyle = grad;
      cx.fillRect(0, gy, W, H - gy);

      cx.textBaseline = "alphabetic";
      cx.fillStyle = "#ffffff";
      cx.font = `800 ${Math.round(38 * s)}px system-ui, -apple-system, Segoe UI, Arial`;
      cx.fillText("Óptica El Rancho", pad, gy + Math.round(50 * s));
      cx.fillStyle = "rgba(200,215,240,0.92)";
      cx.font = `600 ${Math.round(26 * s)}px system-ui, -apple-system, Segoe UI, Arial`;
      const sub = [product?.name, product?.brand, color?.name].filter(Boolean).join("   ·   ");
      if (sub) cx.fillText(sub, pad, gy + Math.round(86 * s));

      cx.font = `700 ${Math.round(30 * s)}px system-ui, -apple-system, Segoe UI, Arial`;
      let ly = gy + headH + Math.round(28 * s);
      for (const ln of lines) {
        cx.fillStyle = "#ffffff";
        cx.fillText(ln, pad, ly);
        ly += lh;
      }
      return cn.toDataURL("image/jpeg", 0.92);
    } catch {
      return src;
    }
  }

  // Descarga la foto del resultado YA con las medidas rotuladas + nombre profesional.
  async function downloadResult(src, which) {
    if (!src) return;
    const out = await composeWithMeasures(src);
    try {
      const a = document.createElement("a");
      a.href = out;
      a.download = resultFileName(which, out);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch { /* descarga no disponible en este navegador */ }
  }

  // "Medir de nuevo" desde la vista de resultado: descarta la generación guardada y
  // vuelve a la captura desde cero.
  function remeasure() {
    if (mAbort.current) { mAbort.current.abort(); mAbort.current = null; }
    clearMeasureJob(product);
    clearMeasureResult(product);
    jobIdRef.current = null;
    capturedPdRef.current = null; pdSamplesRef.current = [];
    setMData(null); setMState("idle"); setAddedState("idle");
    setFrontImg(null); setSideImg(null); setPhase("front");
  }

  // "Añadir receta": entrega al flujo de compra las medidas de encaje (DIP + altura)
  // + la imagen generada + para quién es. La página de la receta (LensProcess) las
  // pre-rellena en la receta y sigue al checkout; los datos quedan guardados con el
  // producto (localStorage) para no perderlos si el cliente sale. El envío por
  // correo a la tienda y al cliente es una etapa aparte (backend).
  function addPrescription() {
    const payload = {
      productId: product?.id, productSku: product?.sku, productName: product?.name,
      colorName: color?.name, colorIndex: ci,
      forWhom, otherName: forWhom === "other" ? (otherName || "").trim() : "",
      pd: mData?.pd ?? null, pdRight: mData?.pdRight ?? null, pdLeft: mData?.pdLeft ?? null,
      corridor: mData?.corridor ?? null, segHeight: mData?.corridor ?? null,
      bifocal: mData?.bifocal ?? null, suitable: mData?.suitable ?? null,
      frame: {
        A: a?.eye_size ?? null, DBL: a?.bridge_size ?? null,
        B: a?.b_measurement ?? null, temple: a?.temple_length ?? null,
      },
      frontImage: mData?.frontImage || frontImg || null,
      profileImage: mData?.profileImage || sideImg || null,
      measuredBy: mData?.measuredBy || "device",
      savedAt: Date.now(),
    };
    // Persistimos también la última "receta de medidas" por producto, por si el
    // callback no está disponible (probador abierto fuera de la página de receta).
    try { saveMeasureResult(product, { data: mData, frontImg, sideImg, prescription: payload }); } catch { /* cuota */ }
    setAddedState("added");
    if (typeof onAddPrescription === "function") onAddPrescription(payload);
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

  // Formato de milímetros para los números medidos (DIP, altura de corredor).
  const mmv = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : `${Math.round(Number(v) * 10) / 10} mm`);

  // Resultado DENTRO de la misma ventana del estudio (reemplaza la columna de captura):
  // las dos imágenes con los espejuelos puestos + "Añadir receta" / "Medir de nuevo".
  function resultViews() {
    const front = mData?.frontImage || frontImg;
    const side = mData?.profileImage || sideImg;
    return (
      <div className="vm-result">
        <div className="vm-result-imgs">
          <figure className="vm-rfig">
            <figcaption className="vm-rlabel">{t("vm.front")}</figcaption>
            {front ? (
              <>
                <img className="vm-rimg" src={front} alt={t("vm.front")}
                     onClick={() => setZoom({ src: front, which: "front" })} />
                <div className="vm-rtools">
                  <button type="button" className="vm-rtool" title={t("vm.zoom")} aria-label={t("vm.zoom")}
                          onClick={() => setZoom({ src: front, which: "front" })}>{IC_ZOOM}</button>
                  <button type="button" className="vm-rtool" title={t("vm.download")} aria-label={t("vm.download")}
                          onClick={() => downloadResult(front, "front")}>{IC_DOWN}</button>
                </div>
              </>
            ) : <div className="vm-noimg">📷</div>}
            <div className="vm-rbadge"><span>{t("vm.pd")}</span><b>{mmv(mData?.pd)}</b></div>
          </figure>
          <figure className="vm-rfig">
            <figcaption className="vm-rlabel">{t("vm.side")}</figcaption>
            {side ? (
              <>
                <img className="vm-rimg" src={side} alt={t("vm.side")}
                     onClick={() => setZoom({ src: side, which: "side" })} />
                <div className="vm-rtools">
                  <button type="button" className="vm-rtool" title={t("vm.zoom")} aria-label={t("vm.zoom")}
                          onClick={() => setZoom({ src: side, which: "side" })}>{IC_ZOOM}</button>
                  <button type="button" className="vm-rtool" title={t("vm.download")} aria-label={t("vm.download")}
                          onClick={() => downloadResult(side, "side")}>{IC_DOWN}</button>
                </div>
              </>
            ) : <div className="vm-noimg">📷</div>}
            <div className="vm-rbadge"><span>{t("vm.corridor")}</span><b>{mmv(mData?.corridor)}</b></div>
          </figure>
        </div>
        {mData?.quality && (
          <div className={`vm-conf vm-conf-${mData.quality.level}`}>
            <span className="vm-conf-dot" aria-hidden="true" />
            <span className="vm-conf-tx">
              <b>{t(`vm.conf.${mData.quality.level}`)}</b>
              {mData.quality.estErrorMm != null && (
                <small>{t("vm.conf.pm")} ±{mData.quality.estErrorMm} mm</small>
              )}
            </span>
            {mData.quality.level === "low" && (
              <button type="button" className="vm-conf-btn" onClick={remeasure}>{t("vm.remeasure")}</button>
            )}
          </div>
        )}
        <div className="vm-result-actions">
          <button type="button" className="vm-remeasure" onClick={remeasure}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L2.5 9" /><path d="M2.5 3.5V9H8" /></svg>
            {t("vm.remeasure")}
          </button>
          <button type="button" className="vm-share" onClick={shareResult} title={t("vm.share")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
            {t("vm.share")}
          </button>
          {addedState === "added" ? (
            <span className="vm-added">✓ {t("vm.added")}</span>
          ) : (
            <button type="button" className="vm-addrx" onClick={addPrescription}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5v14" /></svg>
              {t("lens.step.rx")}
            </button>
          )}
        </div>
        {/* En MÓVIL las medidas calculadas se muestran aquí, debajo de las fotos
            (en escritorio van en la tarjeta flotante de la esquina). */}
        <div className="vm-dims-inflow">{dimsPanel()}</div>
      </div>
    );
  }

  // Panel de dimensiones (esquina inferior derecha): mismo lenguaje visual que la
  // ficha "Información de la montura" — encabezado azul marino + iconos por medida.
  function dimsPanel() {
    const sub = (mData?.pdRight != null || mData?.pdLeft != null)
      ? `OD ${mmv(mData?.pdRight)} · OS ${mmv(mData?.pdLeft)}` : null;
    const q = mData?.quality;
    const svg = (d) => (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
    );
    const icPd = svg(<><circle cx="12" cy="12" r="3" /><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /></>);
    const icCorr = svg(<><path d="M12 3v18" /><path d="M8 6l4-3 4 3" /><path d="M8 18l4 3 4-3" /></>);
    const icFrame = svg(<><circle cx="6" cy="14" r="4" /><circle cx="18" cy="14" r="4" /><path d="M10 14a2 2 0 0 1 4 0M2.5 11l3-2.5M21.5 11l-3-2.5" /></>);
    const icConf = svg(<><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>);
    const rows = [
      { ic: icPd, k: t("vm.pd"), v: mmv(mData?.pd), sub: q?.estErrorMm != null ? `${sub ? sub + " · " : ""}±${q.estErrorMm} mm` : sub },
      { ic: icCorr, k: t("vm.corridor"), v: mmv(mData?.corridor) },
      { ic: icFrame, k: `${t("fs.lensWidth")} · ${t("fs.bridge")}`, v: `${eyeD || "—"} · ${bridgeD || "—"}` },
      ...(q ? [{ ic: icConf, k: t("vm.conf.label"), v: t(`vm.conf.short.${q.level}`) }] : []),
    ];
    return (
      <aside className="vm-dims" aria-label={t("vm.dims.title")}>
        <div className="vm-dims-h">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18" /></svg>
          {t("vm.dims.title")}
        </div>
        <div className="vm-dims-body">
          {rows.map((r, i) => (
            <div className="vm-dims-row" key={i}>
              <span className="vm-dims-ic" aria-hidden="true">{r.ic}</span>
              <span className="vm-dims-k">{r.k}</span>
              <span className="vm-dims-v">{r.v}{r.sub && <em>{r.sub}</em>}</span>
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return createPortal(
    <div className={`tryon tryon-studio ${(mState === "loading" || mState === "error") ? "tryon-busy" : ""} ${mState === "result" ? "tryon-result" : ""}`}
         role="dialog" aria-modal="true" style={{ top: headerH || 0 }}>
      <div className="tryon-bar">
        <button className="tryon-x" onClick={onClose} aria-label={t("tryon.close")}>×</button>
      </div>

      <input ref={frontInput} type="file" accept="image/*" hidden
             onChange={(e) => onUpload("front", e.target.files && e.target.files[0])} />
      <input ref={sideInput} type="file" accept="image/*" hidden
             onChange={(e) => onUpload("side", e.target.files && e.target.files[0])} />

      <div className="tryon-studio-grid">
        {/* Izquierda: captura guiada (frontal + lateral) o, ya con el resultado, las
            imágenes con los espejuelos puestos — todo en la MISMA ventana. */}
        <div className="tryon-studio-cap">
          {mState === "result" ? resultViews() : (
            <>
              {capBox({ which: "front", num: "1", title: t("cap.front"), img: frontImg, active: phase === "front", waiting: false })}
              {capBox({ which: "side", num: "2", title: t("cap.side"), img: sideImg, active: phase === "side", waiting: phase === "front" })}
            </>
          )}
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
        <div className="vm-actionbar" ref={actionbarRef}>
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

      {/* (Las medidas calculadas se muestran EN EL FLUJO dentro de resultViews,
          debajo de las fotos — ver .vm-dims-inflow. Ya no hay tarjeta flotante
          para evitar solapamientos.) */}

      {/* Lightbox: foto del resultado ampliada, con opción de descargar. */}
      {zoom && (
        <div className="vm-zoom" role="dialog" aria-modal="true" onClick={() => setZoom(null)}>
          <div className="vm-zoom-bar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="vm-zoom-dl"
                    onClick={() => downloadResult(zoom.src, zoom.which)}>
              {IC_DOWN}<span>{t("vm.download")}</span>
            </button>
            <button type="button" className="vm-zoom-x" aria-label={t("tryon.close")}
                    onClick={() => setZoom(null)}>×</button>
          </div>
          <img className="vm-zoom-img" src={zoom.src} alt=""
               onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* Carga y error se muestran como capa translúcida SOBRE el estudio (que queda
          desenfocado detrás); el RESULTADO ya vive dentro de la ventana (arriba). */}
      {(mState === "loading" || mState === "error") && (
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
