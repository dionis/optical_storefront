import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";

// Probador virtual (AR) real: usa la cámara y, si es posible, rastrea la cara
// con MediaPipe FaceLandmarker (CDN) para colocar la montura sobre los ojos.
// Si no hay detección, cae a colocación MANUAL con ajuste de tamaño y altura.
// La montura se superpone con mix-blend-mode:multiply para que el fondo blanco
// de la foto del producto "desaparezca" sin necesidad de CORS.
export default function TryOn({ product, colorIdx = 0, onClose }) {
  const { t } = useLang();
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(0);
  const lmRef = useRef(null);
  const runningRef = useRef(true);
  const detectedRef = useRef(false);

  const [ci, setCi] = useState(colorIdx);
  const [status, setStatus] = useState("starting"); // starting | ready | denied | nocam
  const [tracking, setTracking] = useState(false);
  const [size, setSize] = useState(1);   // 0.5 – 1.5
  const [yOff, setYOff] = useState(0);   // -0.15 – 0.15

  const color = product.colors[ci] || product.colors[0];

  // 1) cámara
  useEffect(() => {
    let stream;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus("nocam"); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setStatus("ready");
        }
      } catch (e) {
        setStatus(e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "nocam");
      }
    })();
    return () => { runningRef.current = false; cancelAnimationFrame(rafRef.current); if (stream) stream.getTracks().forEach((tk) => tk.stop()); };
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
        if (!cancelled) lmRef.current = lm;
      } catch (e) { /* modo manual */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 3) bucle de render (no re-renderiza React: escribe estilos por ref)
  useEffect(() => {
    const loop = () => {
      if (!runningRef.current) return;
      const v = videoRef.current, ov = overlayRef.current, stage = stageRef.current;
      if (v && ov && stage && v.videoWidth) {
        const W = stage.clientWidth, H = stage.clientHeight;
        const aspect = (ov.naturalWidth && ov.naturalHeight) ? ov.naturalWidth / ov.naturalHeight : 2.2;
        let placed = false;

        if (lmRef.current) {
          try {
            const res = lmRef.current.detectForVideo(v, performance.now());
            const lms = res && res.faceLandmarks && res.faceLandmarks[0];
            if (lms) {
              // object-fit: cover → factor de escala/offset del video mostrado
              const vAsp = v.videoWidth / v.videoHeight, dAsp = W / H;
              let sx, sy, ox = 0, oy = 0;
              if (vAsp > dAsp) { sy = H; sx = H * vAsp; ox = (W - sx) / 2; }
              else { sx = W; sy = W / vAsp; oy = (H - sy) / 2; }
              const toX = (nx) => ox + (1 - nx) * sx; // espejado (selfie)
              const toY = (ny) => oy + ny * sy;
              const rE = lms[33], lE = lms[263];      // esquinas externas de los ojos
              const x1 = toX(rE.x), y1 = toY(rE.y), x2 = toX(lE.x), y2 = toY(lE.y);
              const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + yOff * H;
              const dx = x2 - x1, dy = y2 - y1;
              const eyeDist = Math.hypot(dx, dy);
              const gw = eyeDist * 2.05 * size;
              const ih = gw / aspect;
              const ang = Math.atan2(dy, dx) * 180 / Math.PI;
              ov.style.width = gw + "px";
              ov.style.left = (cx - gw / 2) + "px";
              ov.style.top = (cy - ih / 2) + "px";
              ov.style.transform = `rotate(${ang}deg)`;
              ov.style.opacity = "1";
              placed = true;
              if (!detectedRef.current) { detectedRef.current = true; setTracking(true); }
            } else if (detectedRef.current) { detectedRef.current = false; setTracking(false); }
          } catch { /* ignore frame */ }
        }

        if (!placed) {
          const gw = W * 0.6 * size;
          const ih = gw / aspect;
          ov.style.width = gw + "px";
          ov.style.left = (W / 2 - gw / 2) + "px";
          ov.style.top = (H * (0.42 + yOff) - ih / 2) + "px";
          ov.style.transform = "rotate(0deg)";
          ov.style.opacity = "1";
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [size, yOff, ci]);

  return (
    <div className="tryon" role="dialog" aria-modal="true">
      <div className="tryon-bar">
        <span className="tryon-title">👓 {t("tryon.title")} · {product.name}</span>
        <button className="tryon-x" onClick={onClose} aria-label={t("tryon.close")}>×</button>
      </div>

      <div className="tryon-stage" ref={stageRef}>
        <video ref={videoRef} className="tryon-video" playsInline muted />
        <img ref={overlayRef} className="tryon-frame" src={color.image} alt="" style={{ opacity: 0 }}
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
    </div>
  );
}
