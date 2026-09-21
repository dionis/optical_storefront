import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { IconGlasses, IconLensWidth, IconBridge, IconTemple } from "./measureIcons.jsx";
import { IconMaterial, IconMeasures, IconGender, IconCamera, IconCheck, Icon360, IconGlasses as IconGlassesUi } from "./UiIcons.jsx";
import MeasureReport from "./MeasureReport.jsx";
// Medición propia (sin IA): PD + altura de corredor con iris + landmarks + dims del
// marco. Sustituye los números de Gemini; la IA solo hace el montaje de las gafas.
import { measureFromFrontal, pdFromLandmarks } from "../data/opticalMeasure.js";
import { predictGender } from "../data/genderDetect.js";
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
  saveFacePhotos, getFacePhotos, clearFacePhotos,
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

/* Iconos pequeños de la lista de recomendaciones (misma familia de trazo que el
   resto del sitio: contorno, 2px, esquinas redondeadas). */
const ic = (d) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IC_LIGHT = ic(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
const IC_FACE = ic(<><path d="M5 11a7 7 0 0 1 14 0c0 4.2-3.1 8-7 8s-7-3.8-7-8z" /><path d="M9 11h.01M15 11h.01M9.5 15c.8.7 1.6 1 2.5 1s1.7-.3 2.5-1" /></>);
const IC_PROFILE = ic(<><path d="M7 3.5c4 0 8 3 8 8 0 2 .8 2.6 1.8 3.4.7.6.4 1.6-.5 1.8l-2.3.5v2.3a1 1 0 0 1-1 1H9" /><path d="M7 3.5C4.5 5 3 8 3 11.5 3 16 6 20 10 20" /><path d="M10.5 11h.01" /></>);
// Iconos de los mensajes de introducción del asistente.
const IC_EYE = ic(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>);
const IC_ROTATE = ic(<><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" /><path d="M4 20v-4h4" /></>);

/* Ilustración de "Ejemplo" (silueta neutra, sin persona real): rostro de frente y
   de perfil. Trazo navy sobre fondo suave, con el sello "Ejemplo" encima. */
const EX_FRONT = (
  <svg className="ts2-ex-illus" viewBox="0 0 120 150" role="img" aria-hidden="true">
    <rect width="120" height="150" rx="10" fill="#eef2f8" />
    <path d="M60 118c-24 0-34 14-37 24h74c-3-10-13-24-37-24z" fill="#c7d2e6" />
    <ellipse cx="60" cy="66" rx="27" ry="32" fill="#dbe3f1" />
    <path d="M33 60c0-19 12-30 27-30s27 11 27 30c2-1 4 2 3 7-1 4-4 5-5 5-2 12-13 22-25 22s-23-10-25-22c-1 0-4-1-5-5-1-5 1-8 3-7z" fill="#c7d2e6" />
    <circle cx="50" cy="66" r="3" fill="#8092b3" /><circle cx="70" cy="66" r="3" fill="#8092b3" />
    <path d="M52 80c3 2 5 3 8 3s5-1 8-3" stroke="#8092b3" strokeWidth="2.4" fill="none" strokeLinecap="round" />
  </svg>
);
const EX_SIDE = (
  <svg className="ts2-ex-illus" viewBox="0 0 120 150" role="img" aria-hidden="true">
    <rect width="120" height="150" rx="10" fill="#eef2f8" />
    <path d="M64 118c-22 0-31 14-34 24h72c-2-10-12-24-38-24z" fill="#c7d2e6" />
    <path d="M44 40c14-10 34-6 40 12 4 12 1 22-6 30-2 8-3 14-3 16 0 3-3 4-6 4H45c-9 0-17-8-19-20-3-19 5-34 18-42z" fill="#dbe3f1" />
    <path d="M44 40c14-10 34-6 40 12 4 12 1 22-6 30-2 8-3 14-3 16" fill="none" stroke="#c7d2e6" strokeWidth="0" />
    <circle cx="52" cy="66" r="3" fill="#8092b3" />
    <path d="M40 74c-4 1-7 2-7 5s3 4 6 4" stroke="#8092b3" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    <circle cx="74" cy="72" r="6" fill="none" stroke="#8092b3" strokeWidth="2.2" />
  </svg>
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
  // Género detectado (solo para elegir la foto de EJEMPLO) + fase de preparación:
  // mientras es "detecting" se muestra un "preparando…" y NO la ventana; en cuanto se
  // sabe el género (o vence el tiempo/no hay cámara) pasa a "done" y aparece la ventana.
  const [gender, setGender] = useState("male");            // "male" | "female"
  const [genderPhase, setGenderPhase] = useState("detecting"); // detecting | done
  const genderDoneRef = useRef(false);
  const finishGender = useCallback((g) => {
    if (genderDoneRef.current) return;
    genderDoneRef.current = true;
    if (g === "male" || g === "female") setGender(g);
    setGenderPhase("done");
  }, []);
  const [frontImg, setFrontImg] = useState(null);
  const [sideImg, setSideImg] = useState(null);
  const [guide, setGuide] = useState("");
  const [count, setCount] = useState(0);
  // Sub-etapa del paso actual: "intro" = mensajes guiados sobre la cara de
  // referencia; "live" = cámara en vivo + conteo de 5 s. Se reinicia al cambiar de
  // paso (front/side). capStageRef espeja el valor para el bucle de detección.
  const [capStage, setCapStage] = useState("intro");   // intro | live
  const [introIdx, setIntroIdx] = useState(0);
  const capStageRef = useRef("intro");
  const holdStartRef = useRef(0);                       // ms en que empezó a sostener la pose
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
    phaseRef.current = phase; holdRef.current = 0; holdStartRef.current = 0; setCount(0);
    if (phase === "front") pdSamplesRef.current = [];   // nueva toma: reinicia muestras de PD
    // Cada paso de captura arranca con su introducción guiada (mensajes) antes de
    // la cámara en vivo.
    if (phase === "front" || phase === "side") { setCapStage("intro"); setIntroIdx(0); }
  }, [phase]);

  // Espeja capStage en un ref para el bucle de detección (que corre fuera de React).
  useEffect(() => { capStageRef.current = capStage; }, [capStage]);

  // Reproduce los mensajes de introducción del paso (con la cara de referencia de
  // fondo) UNO TRAS OTRO, con tiempo suficiente para leerlos; al terminar el último
  // pasa a la cámara en vivo. Solo con la ventana ya revelada (genderPhase "done").
  useEffect(() => {
    if (genderPhase !== "done" || capStage !== "intro" || phase === "done") return;
    const nMsgs = phase === "side" ? 1 : 2;
    const id = setTimeout(() => {
      setIntroIdx((i) => {
        if (i + 1 >= nMsgs) { setCapStage("live"); return i; }
        return i + 1;
      });
    }, 3200);
    return () => clearTimeout(id);
  }, [genderPhase, capStage, introIdx, phase]);

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
      if (!navigator.mediaDevices?.getUserMedia) { setCamStatus("nocam"); finishGender("male"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setCamStatus("ready");
        // Detección de género (best-effort) para elegir el set de fotos de EJEMPLO.
        // Corre sobre unos fotogramas bajo el "preparando…"; si no concluye a tiempo,
        // el temporizador maestro revela la ventana igual (con el ejemplo por defecto).
        (async () => {
          const votes = { male: 0, female: 0 };
          const deadline = Date.now() + 2600;
          while (!cancelled && !genderDoneRef.current && Date.now() < deadline) {
            const v = videoRef.current;
            const r = v ? await predictGender(v) : null;
            if (r && r.prob >= 0.62) {
              votes[r.gender] += 1;
              if (votes.male + votes.female >= 3) break;
            }
            await new Promise((s) => setTimeout(s, 320));
          }
          if (!cancelled) finishGender(votes.female > votes.male ? "female" : "male");
        })();
      } catch (e) {
        setCamStatus(e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "nocam");
        finishGender("male");
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

  // Red de seguridad: la ventana NUNCA se queda en "preparando…". Pase lo que pase con
  // la cámara o la detección, a los ~3,8 s se revela con el ejemplo que haya (por
  // defecto hombre). Así el "cargando" es breve e imperceptible, no un bloqueo.
  useEffect(() => {
    const id = setTimeout(() => finishGender(), 3800);
    return () => clearTimeout(id);
  }, [finishGender]);

  // En cuanto existe la foto FRONTAL, se van calculando POR DETRÁS nuestras medidas
  // (MediaPipe, en el navegador — lo que ya tenemos estable) para que estén listas
  // antes de pulsar "Calcular mis medidas". La IA (montaje) sigue en ese botón.
  useEffect(() => {
    if (frontImg) computeOurMeasurement(frontImg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontImg]);

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
    // Solo se detecta/captura en la etapa "live" (tras los mensajes de introducción).
    if (!v || !lm || ph === "done" || v.readyState < 2 || capStageRef.current !== "live") return;
    let res;
    try { res = lm.detectForVideo(v, performance.now()); } catch { return; }
    const L = res?.faceLandmarks?.[0];
    if (CAPDBG) { loop._n = (loop._n || 0) + 1; if (loop._n % 15 === 0) console.log("CAPDBG", L ? "faceW " + Math.abs(L[454].x - L[234].x).toFixed(3) + " r " + ((L[1].x - L[234].x) / ((L[454].x - L[234].x) || 1e-6)).toFixed(3) : "noface", "ph", ph); }
    if (!L) { holdStartRef.current = 0; setCount(0); setGuide(t("cap.noFace")); return; }

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
      // Conteo de 5 s por tiempo real (no por fotogramas), robusto a los FPS.
      if (!holdStartRef.current) holdStartRef.current = performance.now();
      const elapsed = performance.now() - holdStartRef.current;
      setCount(Math.max(1, Math.ceil((5000 - elapsed) / 1000)));
      if (elapsed >= 5000) { capture(ph); }
    } else {
      holdStartRef.current = 0; setCount(0);
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
  // "Tomar las fotos de nuevo": descarta las fotos GUARDADAS (globales) y la
  // generación de este producto, y reinicia toda la captura desde la foto frontal.
  // Es la única vía para rehacer las fotos una vez que ya están reutilizadas.
  function retakeAll() {
    autoDoneRef.current = false;
    clearFacePhotos();
    clearMeasureResult(product);
    capturedPdRef.current = null; pdSamplesRef.current = [];
    setMState("idle"); setMData(null);
    setFrontImg(null); setSideImg(null); setPhase("front");
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

  // REUTILIZAR FOTOS ENTRE MONTURAS: una vez que el cliente tomó su cara (frontal +
  // lateral), esas fotos quedan guardadas globalmente y sirven para CUALQUIER otra
  // montura — no hace falta volver a tomarlas. Al abrir el estudio, si no hay trabajo
  // en curso ni una generación guardada para ESTE producto pero sí hay fotos de cara
  // guardadas, se restauran y saltamos directo a la revisión (con "Calcular mis
  // medidas"). El cliente puede rehacerlas con "Tomar las fotos de nuevo".
  useEffect(() => {
    if (getMeasureJob(product)) return;
    if (getMeasureResult(product)) return;
    const face = getFacePhotos();
    if (!face) return;
    setFrontImg(face.frontImg);
    setSideImg(face.sideImg);
    setPhase("done");
    computeOurMeasurement(face.frontImg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persiste las dos fotos de cara en cuanto existen, para reutilizarlas con otras
  // monturas (ver arriba). Se guardan las tomas ORIGINALES del cliente (no la
  // generación de la IA), reescaladas para caber en localStorage.
  useEffect(() => {
    if (frontImg && sideImg) saveFacePhotos({ frontImg, sideImg });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontImg, sideImg]);

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
    const title = "RUBI LENS";
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
      cx.fillText("RUBI LENS", pad, gy + Math.round(50 * s));
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
  const genderLabel = a.gender ? tv(String(a.gender)) : null;
  const measuresStr = [a.eye_size, a.bridge_size, a.temple_length]
    .map((x) => String(x == null ? "" : x).trim())
    .filter(Boolean)
    .join(" - ") || null;
  const colorNames = colors.map((c) => c.name).filter(Boolean).join(" · ");
  // Fotos de EJEMPLO segun el genero detectado (hombre por defecto).
  const exFront = gender === "female" ? "/ejemplo-mujer-frontal.jpg" : "/ejemplo-hombre-frontal.jpg";
  const exSide = gender === "female" ? "/ejemplo-mujer-lateral.jpg" : "/ejemplo-hombre-lateral.jpg";
  const specRows = [
    { key: "model", label: t("fs.model"),
      node: (<>{product.name}{product.brand ? <span className="fs-sub"> ({product.brand})</span> : null}</>) },
    { key: "color", label: t("fs.color"), node: color?.name || na },
    materialText && { key: "material", label: t("fs.material"), node: materialText },
    shapeText && { key: "shape", label: t("fs.shape"), node: shapeText },
    genderLabel && { key: "gender", label: t("spec.gender"), node: genderLabel },
    measuresStr && { key: "measures", label: t("fs.measures"), node: measuresStr },
  ].filter(Boolean);

  // ── Estado de cada caja de captura ──
  const camMsg = camStatus === "starting" ? t("tryon.starting")
    : camStatus === "denied" ? t("tryon.denied")
    : camStatus === "nocam" ? t("tryon.noCam") : "";

  // Paso del asistente (SOLO uno visible a la vez): la cámara a TODO EL ANCHO y,
  // debajo, la referencia (ejemplo) + la lista de recomendaciones lado a lado. El
  // mensaje ("Mire directo a la cámara" / "Gire la cabeza hacia un lado") va en la
  // cabecera. Se llama como función (no como <Componente/>) para NO remontar el
  // <video> en cada render y así no perder la cámara.
  function stepCard({ which, num, title, sub, example, refSrc, checks }) {
    const inputRef = which === "front" ? frontInput : sideInput;
    const camReady = camStatus === "ready";
    const introMsgs = which === "side"
      ? [{ ic: IC_ROTATE, tx: t("tryon2.msgSideIntro") }]
      : [{ ic: IC_EYE, tx: t("tryon2.msgFront") }, { ic: IC_LIGHT, tx: t("tryon2.msgLight") }];
    const introCur = introMsgs[Math.min(introIdx, introMsgs.length - 1)];
    const showIntro = camReady && capStage === "intro";
    return (
      <section className="ts2-step ts2-wiz on">
        <div className="ts2-step-hd">
          <span className="ts2-step-badge">{num}</span>
          <div className="ts2-step-tt"><b>{title}</b><span>{sub}</span></div>
          <button type="button" className="ts2-step-up" onClick={() => inputRef.current?.click()}
                  title={t(which === "front" ? "tryon2.upFront" : "tryon2.upSide")}
                  aria-label={t(which === "front" ? "tryon2.upFront" : "tryon2.upSide")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
            <span className="ts2-step-up-tx">{t(which === "front" ? "tryon2.upFront" : "tryon2.upSide")}</span>
          </button>
        </div>
        <div className="ts2-wiz-body">
          {/* Cámara a todo el ancho. El <video> se monta SIEMPRE (para detección y
              género); durante la introducción queda cubierto por la capa de mensajes
              con la cara de referencia de fondo. */}
          <div className={`ts2-drop ts2-wiz-cam ${camReady ? "live" : ""}`}
               role="button" tabIndex={0}
               onClick={() => { if (!camReady) inputRef.current?.click(); }}
               onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !camReady) { e.preventDefault(); inputRef.current?.click(); } }}
               onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
               onDragLeave={(e) => e.currentTarget.classList.remove("over")}
               onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); const f = e.dataTransfer?.files && e.dataTransfer.files[0]; if (f) onUpload(which, f); }}>
            {camReady ? (
              <>
                <video ref={attachVideo} className="ts2-video" playsInline muted />
                {showIntro ? (
                  <div className="ts2-intro" style={refSrc ? { backgroundImage: `url(${refSrc})` } : undefined}>
                    <div className="ts2-intro-inner" key={introIdx}>
                      <span className="ts2-intro-ic">{introCur.ic}</span>
                      <b className="ts2-intro-msg">{introCur.tx}</b>
                    </div>
                  </div>
                ) : (
                  <>
                    {count > 0 && <div className="ts2-count ts2-count-top">{count}</div>}
                    <span className="ts2-badge"><span className="ts2-live-dot" aria-hidden="true" /> {t("cap.auto")}</span>
                    <div className="ts2-guide">{guide || sub}</div>
                  </>
                )}
              </>
            ) : (
              <div className="ts2-drop-ph">
                <span className="ts2-drop-cam"><IconCamera className="ts2-drop-cam-ic" /></span>
                <b>{camMsg || t("tryon2.drop")}</b>
                <small>{t("tryon2.dropHint")}</small>
              </div>
            )}
          </div>
          {/* Referencia (ejemplo) + lista de recomendaciones, lado a lado (queda debajo) */}
          <div className="ts2-wiz-foot">
            <figure className="ts2-ex">
              {example}
              <figcaption className="ts2-ex-badge"><IconCheck className="ts2-ex-badge-ic" /> {t("tryon2.example")}</figcaption>
            </figure>
            <ul className="ts2-checks">
              {checks.map((c, i) => (
                <li key={i}><span className="ts2-check-ic">{c.ic}</span>{c.tx}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    );
  }

  // Revisión: con las DOS fotos ya tomadas, se ven por separado la frontal y la
  // lateral, cada una con "Repetir" y "Subir foto", y debajo (permanente) la ficha
  // de la montura + la barra con "Calcular mis medidas".
  function reviewFig(which, img, label) {
    const inputRef = which === "front" ? frontInput : sideInput;
    return (
      <figure className="ts2-rvfig">
        {img ? <img className="ts2-rvimg" src={img} alt={label} />
             : <div className="ts2-rvimg ts2-rvimg-ph" aria-hidden="true">📷</div>}
        <span className="ts2-rvbadge"><IconCheck className="ts2-rvbadge-ic" /> {t("cap.ready")}</span>
        <div className="ts2-rvtools">
          <button type="button" className="ts2-rvbtn" onClick={() => retake(which)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L2.5 9" /><path d="M2.5 3.5V9H8" /></svg>
            <span>{t("cap.retake")}</span>
          </button>
          <button type="button" className="ts2-rvbtn" onClick={() => inputRef.current?.click()}
                  title={t(which === "front" ? "tryon2.upFront" : "tryon2.upSide")}
                  aria-label={t(which === "front" ? "tryon2.upFront" : "tryon2.upSide")}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
            <span className="ts2-rvbtn-tx">{t(which === "front" ? "tryon2.upFront" : "tryon2.upSide")}</span>
          </button>
        </div>
        <figcaption className="ts2-rvlabel">{label}</figcaption>
      </figure>
    );
  }
  function captureReview() {
    return (
      <section className="ts2-step ts2-rv on">
        <div className="ts2-step-hd">
          <span className="ts2-step-badge ts2-badge-done"><IconCheck /></span>
          <div className="ts2-step-tt"><b>{t("tryon2.reviewTitle")}</b><span>{t("tryon2.reviewSub")}</span></div>
          <button type="button" className="ts2-step-up ts2-retake-all" onClick={retakeAll}
                  title={t("tryon2.retakeAll")} aria-label={t("tryon2.retakeAll")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L2.5 9" /><path d="M2.5 3.5V9H8" /></svg>
            <span className="ts2-step-up-tx">{t("tryon2.retakeAll")}</span>
          </button>
        </div>
        <div className="ts2-rv-grid">
          {reviewFig("front", frontImg, t("cap.front"))}
          {reviewFig("side", sideImg, t("cap.side"))}
        </div>
        {/* Acción "Calcular mis medidas" DENTRO de la revisión, justo debajo de las
            fotos (en el flujo, no una barra flotante): así en móvil siempre se ve y no
            queda tapada por la navegación inferior del sitio. Manda las dos fotos a la
            IA para devolver el rostro con los espejuelos + las medidas. */}
        {mState === "idle" && (
          <div className="ts2-rv-actions" ref={actionbarRef}>
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
            <button type="button" className="vm-go" onClick={doMeasure} disabled={!frontImg || !sideImg}>📐 {t("vm.calc")}</button>
          </div>
        )}
      </section>
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

      {/* Preparación: mientras la cámara arranca y se detecta el perfil, se muestra un
          "preparando…" breve (nunca más de ~3,8 s) y luego se revela la ventana ya con
          las fotos de ejemplo adecuadas. */}
      {genderPhase === "detecting" && mState === "idle" && !frontImg && !sideImg && (
        <div className="ts2-prep" role="status" aria-live="polite">
          <div className="ts2-prep-card">
            <span className="ts2-prep-spin" aria-hidden="true" />
            <b>{t("tryon2.preparing")}</b>
            <small>{t("tryon2.preparingSub")}</small>
          </div>
        </div>
      )}

      <div className="tryon-studio-grid ts2wrap">
        <div className="ts2">
          {/* Resumen del marco: material · medidas · género (mismo lenguaje visual
              que la ficha del producto). */}
          <div className="ts2-facts">
            <div className="ts2-fact">
              <IconMaterial className="ts2-fact-ic" />
              <div className="ts2-fact-tx">
                <span className="ts2-fact-k">{t("spec.material")}</span>
                <b>{materialText || na}</b>
                <small>{t("tryon2.materialSub")}</small>
              </div>
            </div>
            <div className="ts2-fact">
              <IconMeasures className="ts2-fact-ic" />
              <div className="ts2-fact-tx">
                <span className="ts2-fact-k">{t("pdp.metaMeasures")}</span>
                <b>{measuresStr || "—"}</b>
                <small>{t("tryon2.measuresSub")}</small>
              </div>
            </div>
            <div className="ts2-fact">
              <IconGender className="ts2-fact-ic" />
              <div className="ts2-fact-tx">
                <span className="ts2-fact-k">{t("spec.gender")}</span>
                <b>{genderLabel || na}</b>
              </div>
            </div>
          </div>

          {/* Colores disponibles */}
          {colors.length > 0 && (
            <div className="ts2-colors">
              <div className="ts2-colors-sw" role="listbox" aria-label={t("tryon2.colorsAvailable")}>
                {colors.map((c, i) => (
                  <button key={c.name + i} type="button" role="option" aria-selected={i === ci}
                          className={`ts2-sw ${i === ci ? "on" : ""}`} style={{ background: c.hex || "#ccc" }}
                          title={c.name} aria-label={c.name} onClick={() => setCi(i)} />
                ))}
              </div>
              <div className="ts2-colors-tx">
                <b>{t("tryon2.colorsAvailable")}</b>
                <span>{colorNames}</span>
              </div>
            </div>
          )}

          {/* Asistente paso a paso: frontal -> lateral -> revisión (o el resultado
              con las gafas puestas). Solo se ve UN paso a la vez, sin salir de la
              ventana; la ficha de la montura queda permanente debajo. */}
          {mState === "result" ? resultViews()
            : (frontImg && sideImg) ? captureReview()
            : phase === "side"
              ? stepCard({
                  which: "side", num: "2", title: t("cap.side"), sub: t("tryon2.msgSide"), refSrc: exSide,
                  example: <img className="ts2-ex-img" src={exSide} alt={t("tryon2.example")} loading="lazy" />,
                  checks: [
                    { ic: IC_LIGHT, tx: t("tryon2.chk.light") },
                    { ic: IC_PROFILE, tx: t("tryon2.chk.profile") },
                    { ic: <IconGlassesUi className="ts2-check-glass" />, tx: t("tryon2.chk.noGlasses") },
                    { ic: <IconCheck className="ts2-check-ok" />, tx: t("tryon2.chk.headStraight") },
                  ],
                })
              : stepCard({
                  which: "front", num: "1", title: t("cap.front"), sub: t("tryon2.msgFront"), refSrc: exFront,
                  example: <img className="ts2-ex-img" src={exFront} alt={t("tryon2.example")} loading="lazy" />,
                  checks: [
                    { ic: IC_LIGHT, tx: t("tryon2.chk.light") },
                    { ic: <IconGlassesUi className="ts2-check-glass" />, tx: t("tryon2.chk.noGlasses") },
                    { ic: <IconCheck className="ts2-check-ok" />, tx: t("tryon2.chk.lookFront") },
                  ],
                })}

          {/* Información de la montura (ancho completo, abajo) */}
          <aside className="fs-card ts2-frame">
            <div className="fs-hd">
              <IconGlasses className="fs-hd-ic" />
              <span className="ts2-frame-title">{product.name}{color?.name ? ` - ${color.name}` : ""}</span>
            </div>

            <div className="ts2-fr ts2-fr-solo">
              {/* Foto grande de la montura: selector de color abajo-izquierda y
                  Material/Género como badges arriba-derecha (como las cards de la tienda);
                  medidas debajo. */}
              <div className="ts2-fr-main">
                <div className="fs-photo ts2-fr-photo">
                  {color?.image
                    ? <img src={color.image} referrerPolicy="no-referrer"
                           alt={`${product.name} ${color?.name || ""}`}
                           onError={(e) => { e.currentTarget.style.opacity = 0.15; }} />
                    : <div className="fs-photo-ph" aria-hidden="true">👓</div>}
                  <div className="ts2-fr-badges">
                    {materialText && (
                      <span className="ts2-fr-badge"><IconMaterial className="ts2-fr-badge-ic" />{materialText}</span>
                    )}
                    {genderLabel && (
                      <span className="ts2-fr-badge"><IconGender className="ts2-fr-badge-ic" />{genderLabel}</span>
                    )}
                  </div>
                  {colors.length > 1 && (
                    <div className="ts2-fr-onphoto" role="listbox" aria-label={product.name}>
                      {colors.map((c, i) => (
                        <button key={c.name + i} type="button" role="option" aria-selected={i === ci}
                                className={`ts2-fr-onsw ${i === ci ? "on" : ""}`} style={{ background: c.hex || "#ccc" }}
                                title={c.name} aria-label={c.name} onClick={() => setCi(i)} />
                      ))}
                    </div>
                  )}
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
              </div>
            </div>

            {/* Pie profesional: fecha, hora y logo RUBI LENS */}
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
              <img src="/logo-rubilens.png" alt="RUBI LENS" className="fs-foot-logo" />
            </div>
          </aside>
        </div>
      </div>

      {/* La acción "Calcular mis medidas" vive ahora DENTRO de la revisión
          (captureReview), justo debajo de las fotos, para que en móvil siempre sea
          visible y no quede tapada por la navegación inferior del sitio. */}

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
