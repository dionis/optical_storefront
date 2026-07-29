import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";

// Probador virtual (AR) real: usa la cámara y, si es posible, rastrea la cara
// con MediaPipe FaceLandmarker (CDN) para colocar la montura sobre los ojos.
// Si no hay detección, cae a colocación MANUAL con ajuste de tamaño y altura.
// La montura se superpone con mix-blend-mode:multiply para que el fondo blanco
// de la foto del producto "desaparezca" sin necesidad de CORS.

// Un fotograma suelto sin detección es normal: mantenemos la última posición
// válida durante este margen antes de volver al modo manual. Sin esto la
// montura salta entre la cara y el centro de la pantalla y parpadea.
const LOST_FACE_GRACE_MS = 900;
// Suavizado exponencial de la posición: más bajo = más estable, más latencia.
const SMOOTHING = 0.35;

// ── Escalado físico ────────────────────────────────────────────────────────
// Distancia media entre las esquinas externas de los ojos (landmarks 33/263)
// en un adulto. Es nuestra "regla" para convertir milímetros a píxeles.
const OUTER_CANTHAL_MM = 91;
// Grosor combinado de los dos aros exteriores, que el calibre no incluye.
const RIM_MM = 8;
const DEFAULT_FRAME_MM = 135;
// Las fotos del catálogo vienen recortadas al ras de la montura (medido: la
// montura ocupa ~99% del ancho y ~97% del alto). La línea de los ojos no cae
// en el centro de esa caja: la pupila va en la mitad superior de la lente.
const EYE_LINE_IN_IMAGE = 0.45;
// Aspecto medio de las fotos del catálogo, sólo hasta que la imagen carga.
const FALLBACK_ASPECT = 2.5;

// Instrumentación de calibrado: abrir la página con ?tryonDebug=1 para que el
// probador emita sus medidas por consola (1 línea/segundo).
const DEBUG = typeof window !== "undefined" && /[?&]tryonDebug=1/.test(window.location.search);

// "54-56 mm" → 55 · "18 mm" → 18
function parseMm(value) {
  const nums = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  return nums.reduce((acc, n) => acc + parseFloat(n), 0) / nums.length;
}

// Ancho real de la montura = 2×calibre + puente + aros. Usar las medidas del
// catálogo en vez de una constante fija hace que las monturas de niño salgan
// estrechas y las de hombre anchas, en lugar de todas del mismo tamaño.
function frameWidthMm(product) {
  const eye = parseMm(product?.attributes?.eye_size);
  if (!eye) return DEFAULT_FRAME_MM;
  return 2 * eye + (parseMm(product?.attributes?.bridge_size) ?? 18) + RIM_MM;
}

export default function TryOn({ product, colorIdx = 0, onClose }) {
  const { t } = useLang();
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(0);
  const lmRef = useRef(null);
  const runningRef = useRef(true);

  // Estado del bucle de render, fuera de React para no re-renderizar por frame.
  const poseRef = useRef(null);          // última pose suavizada { cx, cy, eyeDist, ang }
  const lastSeenRef = useRef(0);         // timestamp de la última detección válida
  const lastFrameTimeRef = useRef(-1);   // video.currentTime del último frame analizado
  const stageSizeRef = useRef({ w: 0, h: 0 });
  const appliedWidthRef = useRef(0);
  const trackingRef = useRef(false);
  const lastLogRef = useRef(0);          // throttle del log de calibrado
  const sizeRef = useRef(1);
  const yOffRef = useRef(0);

  const [ci, setCi] = useState(colorIdx);
  const [status, setStatus] = useState("starting"); // starting | ready | denied | nocam
  const [tracking, setTracking] = useState(false);
  const [size, setSize] = useState(1);   // 0.5 – 1.5
  const [yOff, setYOff] = useState(0);   // -0.15 – 0.15

  const color = product.colors[ci] || product.colors[0];

  // Cuántas veces la distancia entre ojos mide la montura. Antes era un 2.05
  // fijo: ~37% de más, por eso las gafas no ajustaban a la cara.
  const frameRatio = useMemo(() => frameWidthMm(product) / OUTER_CANTHAL_MM, [product]);
  const frameRatioRef = useRef(frameRatio);

  // Los sliders se leen desde refs dentro del bucle: cambiarlos no debe
  // reiniciar el requestAnimationFrame.
  sizeRef.current = size;
  yOffRef.current = yOff;
  frameRatioRef.current = frameRatio;

  // 1) cámara
  useEffect(() => {
    runningRef.current = true;
    let cancelled = false;
    let stream = null;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus("nocam"); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        // El cleanup puede haber corrido mientras esperábamos (StrictMode monta
        // dos veces en dev): hay que cerrar este stream o la cámara queda abierta.
        if (cancelled) { s.getTracks().forEach((tk) => tk.stop()); return; }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => {});
          setStatus("ready");
        }
      } catch (e) {
        if (cancelled) return;
        setStatus(e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "nocam");
      }
    })();

    return () => {
      cancelled = true;
      runningRef.current = false;
      cancelAnimationFrame(rafRef.current);
      if (stream) stream.getTracks().forEach((tk) => tk.stop());
    };
  }, []);

  // 2) MediaPipe (best-effort; si falla, queda modo manual)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const V = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.6";
        const vision = await import(/* @vite-ignore */ V);
        const fileset = await vision.FilesetResolver.forVisionTasks(V + "/wasm");
        const lm = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
          runningMode: "VIDEO", numFaces: 1,
        });
        // Igual que con la cámara: si ya se desmontó, liberamos el grafo WASM.
        if (cancelled) { lm.close?.(); return; }
        lmRef.current = lm;
      } catch (e) { /* modo manual */ }
    })();
    return () => {
      cancelled = true;
      lmRef.current?.close?.();
      lmRef.current = null;
    };
  }, []);

  // 3) bucle de render (no re-renderiza React: escribe estilos por ref)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // Medimos el escenario con ResizeObserver en vez de leer clientWidth en
    // cada frame (eso fuerza un reflow sincrónico 60 veces por segundo).
    const measure = () => { stageSizeRef.current = { w: stage.clientWidth, h: stage.clientHeight }; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);

    const setTrackingOnce = (on) => {
      if (trackingRef.current === on) return;
      trackingRef.current = on;
      setTracking(on);
    };

    const loop = () => {
      if (!runningRef.current) return;
      rafRef.current = requestAnimationFrame(loop);

      const v = videoRef.current, ov = overlayRef.current;
      const { w: W, h: H } = stageSizeRef.current;
      if (!v || !ov || !W || !H || !v.videoWidth || v.readyState < 2) return;

      const now = performance.now();
      const aspect = (ov.naturalWidth && ov.naturalHeight) ? ov.naturalWidth / ov.naturalHeight : FALLBACK_ASPECT;

      // Sólo analizamos fotogramas nuevos. Reprocesar el mismo frame gasta GPU
      // y puede devolver resultados vacíos que provocarían el parpadeo.
      const isNewFrame = v.currentTime !== lastFrameTimeRef.current;
      if (lmRef.current && isNewFrame) {
        lastFrameTimeRef.current = v.currentTime;
        try {
          const res = lmRef.current.detectForVideo(v, now);
          const lms = res && res.faceLandmarks && res.faceLandmarks[0];
          if (lms) {
            // object-fit: cover → factor de escala/offset del video mostrado
            const vAsp = v.videoWidth / v.videoHeight, dAsp = W / H;
            let sx, sy, ox = 0, oy = 0;
            if (vAsp > dAsp) { sy = H; sx = H * vAsp; ox = (W - sx) / 2; }
            else { sx = W; sy = W / vAsp; oy = (H - sy) / 2; }
            const toX = (nx) => ox + (1 - nx) * sx; // espejado (selfie)
            const toY = (ny) => oy + ny * sy;
            // 33 = ojo derecho del usuario, 263 = izquierdo. toX() espeja la
            // imagen (selfie), así que el ojo derecho acaba a la DERECHA de la
            // pantalla: el vector izquierda→derecha va de 263 hacia 33. Tomarlo
            // al revés daba atan2 ≈ 180° y la montura salía cabeza abajo.
            const rE = lms[33], lE = lms[263];      // esquinas externas de los ojos
            const xR = toX(rE.x), yR = toY(rE.y);   // derecha en pantalla
            const xL = toX(lE.x), yL = toY(lE.y);   // izquierda en pantalla
            const dx = xR - xL, dy = yR - yL;
            const next = {
              cx: (xL + xR) / 2,
              cy: (yL + yR) / 2,
              eyeDist: Math.hypot(dx, dy),
              ang: Math.atan2(dy, dx) * 180 / Math.PI,
            };
            // Suavizado exponencial contra el jitter de los landmarks.
            const prev = poseRef.current;
            poseRef.current = prev ? {
              cx: prev.cx + (next.cx - prev.cx) * SMOOTHING,
              cy: prev.cy + (next.cy - prev.cy) * SMOOTHING,
              eyeDist: prev.eyeDist + (next.eyeDist - prev.eyeDist) * SMOOTHING,
              ang: prev.ang + (next.ang - prev.ang) * SMOOTHING,
            } : next;
            lastSeenRef.current = now;
            setTrackingOnce(true);

            // Instrumentación de calibrado (?tryonDebug=1). Mide la cara con
            // varias referencias para poder elegir la mejor escala. El modelo
            // devuelve 478 puntos, así que los del iris (468/473) existen.
            if (DEBUG && now - lastLogRef.current > 1000) {
              lastLogRef.current = now;
              const P = (i) => (lms[i] ? { x: toX(lms[i].x), y: toY(lms[i].y) } : null);
              const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN);
              const irisR = P(468), irisL = P(473);       // centros de iris
              const sideR = P(234), sideL = P(454);       // laterales de la cara (sienes)
              const brow = P(9);                          // entrecejo
              const noseTip = P(1), chin = P(152), headTop = P(10);
              const pdPx = dist(irisR, irisL);
              const facePx = dist(sideR, sideL);
              const canthalPx = next.eyeDist;
              const eyeLineY = irisR && irisL ? (irisR.y + irisL.y) / 2 : NaN;
              const gwNow = canthalPx * frameRatioRef.current * sizeRef.current;
              console.log("[tryon]", JSON.stringify({
                sku: product.sku, eye: product?.attributes?.eye_size, bridge: product?.attributes?.bridge_size,
                frameRatio: +frameRatioRef.current.toFixed(3), size: sizeRef.current, yOff: yOffRef.current,
                stage: `${Math.round(W)}x${Math.round(H)}`,
                img: `${ov.naturalWidth}x${ov.naturalHeight}`, aspect: +aspect.toFixed(3),
                // referencias de escala, en px de pantalla
                canthalPx: +canthalPx.toFixed(1), pdPx: +pdPx.toFixed(1), facePx: +facePx.toFixed(1),
                canthal_over_pd: +(canthalPx / pdPx).toFixed(3),
                face_over_canthal: +(facePx / canthalPx).toFixed(3),
                // lo que dibujamos vs lo que mide la cara
                gw: +gwNow.toFixed(1), ih: +(gwNow / aspect).toFixed(1),
                gw_over_face: +(gwNow / facePx).toFixed(3),
                // anclaje vertical: dónde está cada cosa en pantalla
                eyeLineY: +eyeLineY.toFixed(1), canthalY: +next.cy.toFixed(1),
                browY: brow ? +brow.y.toFixed(1) : null,
                noseTipY: noseTip ? +noseTip.y.toFixed(1) : null,
                headTopY: headTop ? +headTop.y.toFixed(1) : null, chinY: chin ? +chin.y.toFixed(1) : null,
                ang: +next.ang.toFixed(1), lmCount: lms.length,
              }));
            }
          }
        } catch (err) { if (DEBUG) console.warn("[tryon] frame error", err); }
      }

      // Conservamos la última pose durante el margen de gracia. Sin esto, un
      // solo frame sin cara mandaba la montura al centro y de vuelta.
      const pose = poseRef.current;
      const fresh = pose && (now - lastSeenRef.current) < LOST_FACE_GRACE_MS;
      if (!fresh) {
        if (pose) { poseRef.current = null; lastFrameTimeRef.current = -1; }
        setTrackingOnce(false);
      }

      let gw, left, top, ang;
      if (fresh) {
        gw = pose.eyeDist * frameRatioRef.current * sizeRef.current;
        left = pose.cx - gw / 2;
        // La línea de los ojos no es el centro de la foto: la pupila cae en la
        // mitad superior de la lente, así que anclamos por EYE_LINE_IN_IMAGE.
        top = pose.cy + yOffRef.current * H - (gw / aspect) * EYE_LINE_IN_IMAGE;
        ang = pose.ang;
      } else {
        gw = W * 0.6 * sizeRef.current;
        left = W / 2 - gw / 2;
        top = H * (0.42 + yOffRef.current) - (gw / aspect) / 2;
        ang = 0;
      }

      // width dispara layout, así que sólo lo tocamos cuando cambia de verdad;
      // la posición va por transform (composita, no reflowea).
      if (Math.abs(gw - appliedWidthRef.current) > 0.5) {
        appliedWidthRef.current = gw;
        ov.style.width = gw + "px";
      }
      ov.style.transform = `translate(${left}px, ${top}px) rotate(${ang}deg)`;
      ov.style.opacity = "1";
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { ro.disconnect(); cancelAnimationFrame(rafRef.current); };
  }, []);

  // Al cambiar de color la imagen se recarga: forzamos recalcular el ancho
  // aplicado para que el nuevo aspect ratio se tenga en cuenta.
  useEffect(() => { appliedWidthRef.current = 0; }, [ci]);

  // Portal a <body>: el modal se monta dentro de .card, y `.card:hover` aplica
  // un transform que convierte a la tarjeta en bloque contenedor de cualquier
  // position:fixed descendiente. Al abrir el probador la tarjeta está en hover,
  // así que el modal se dibujaba encajado (y recortado por su overflow:hidden)
  // dentro de la tarjeta, y saltaba a pantalla completa al salir el ratón.
  return createPortal(
    <div className="tryon" role="dialog" aria-modal="true">
      <div className="tryon-bar">
        <span className="tryon-title">👓 {t("tryon.title")} · {product.name}</span>
        <button className="tryon-x" onClick={onClose} aria-label={t("tryon.close")}>×</button>
      </div>

      <div className="tryon-stage" ref={stageRef}>
        <video ref={videoRef} className="tryon-video" playsInline muted />
        <img ref={overlayRef} className="tryon-frame" src={color.image} alt=""
             onLoad={() => { appliedWidthRef.current = 0; }}
             onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />

        {status !== "ready" && (
          <div className="tryon-overlay-msg">
            {status === "starting" && <p>📷 {t("tryon.starting")}</p>}
            {status === "denied" && <p>🚫 {t("tryon.denied")}</p>}
            {status === "nocam" && <p>😕 {t("tryon.noCam")}</p>}
          </div>
        )}
        {status === "ready" && (
          <div className={`tryon-badge ${tracking ? "on" : ""}`}>{tracking ? "🟢 " + t("tryon.tracking") : "🖐️ " + t("tryon.manual")}</div>
        )}
      </div>

      <div className="tryon-controls">
        <div className="tryon-swatches">
          {product.colors.map((c, i) => (
            <button key={c.name} className={`tryon-sw ${i === ci ? "on" : ""}`} style={{ background: c.hex || "#ccc" }}
                    title={c.name} aria-label={c.name} onClick={() => setCi(i)} />
          ))}
        </div>
        <label className="tryon-slider"><span>{t("tryon.size")}</span>
          <input type="range" min="0.5" max="1.5" step="0.01" value={size} onChange={(e) => setSize(parseFloat(e.target.value))} />
        </label>
        <label className="tryon-slider"><span>{t("tryon.height")}</span>
          <input type="range" min="-0.15" max="0.15" step="0.005" value={yOff} onChange={(e) => setYOff(parseFloat(e.target.value))} />
        </label>
      </div>
      <p className="tryon-hint">{t("tryon.hint")}</p>
    </div>,
    document.body
  );
}
