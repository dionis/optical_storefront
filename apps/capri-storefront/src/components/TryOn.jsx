import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import { buildFrame, frameDimensions } from "./tryon/frameGeometry.js";
import { createFaceOccluder, DEFAULT_EXPAND, DEFAULT_EXPAND_UP } from "./tryon/faceOccluder.js";

// Probador virtual 3D. La montura es geometría real generada a partir de las
// medidas del catálogo (calibre, puente, varilla, forma, material), NO la foto
// del producto: esas fotos son tomas en perspectiva 3/4 — el frente ocupa sólo
// ~55% del ancho de la imagen — y por eso nunca podían encajar sobre un rostro
// frontal por mucho que se ajustase la escala.
//
// La cámara de la escena es ORTOGRÁFICA en espacio de píxeles de pantalla, de
// modo que el encuadre coincide exactamente con el `object-fit: cover` del
// vídeo. La pose 3D de la cabeza viene de la matriz de MediaPipe, y un oclusor
// invisible con la forma de la cabeza esconde las varillas que pasan por detrás.

const LOST_FACE_GRACE_MS = 900;
const SMOOTHING = 0.4;
// Distancia media entre las esquinas externas de los ojos (landmarks 33/263).
// Es la regla que convierte los milímetros del catálogo a píxeles.
const OUTER_CANTHAL_MM = 91;
// Las gafas apoyan en el puente de la nariz, por delante de la superficie de la
// cara. Sin este margen la montura se hunde en el oclusor y desaparece.
const FRAME_FORWARD_MM = 13;

const DEBUG = (typeof window !== "undefined" && /[?&]tryonDebug=1/.test(window.location.search))
  || (typeof import.meta !== "undefined" && import.meta.env?.DEV);

export default function TryOn({ product, colorIdx = 0, onClose }) {
  const { t } = useLang();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(0);
  const lmRef = useRef(null);
  const runningRef = useRef(true);

  const glRef = useRef(null);          // { renderer, scene, camera, occluder, root }
  const frameRef = useRef(null);       // THREE.Group de la montura
  const poseRef = useRef(null);
  const lastSeenRef = useRef(0);
  const lastFrameTimeRef = useRef(-1);
  const stageSizeRef = useRef({ w: 0, h: 0 });
  const trackingRef = useRef(false);
  const lastLogRef = useRef(0);
  const sizeRef = useRef(1);
  const yOffRef = useRef(0);

  const [ci, setCi] = useState(colorIdx);
  const [status, setStatus] = useState("starting"); // starting | ready | denied | nocam
  const [tracking, setTracking] = useState(false);
  const [size, setSize] = useState(1);
  const [yOff, setYOff] = useState(0);

  // Calibrado en vivo. Estas cuatro constantes sólo se pueden fijar mirando una
  // cara real, y editarlas a mano obliga a recompilar en cada intento. El panel
  // sólo aparece en dev / con ?tryonDebug=1.
  const [tune, setTune] = useState({
    forwardMm: FRAME_FORWARD_MM,
    expand: DEFAULT_EXPAND,
    expandUp: DEFAULT_EXPAND_UP,
    // Multiplica la escala calculada. >1 agranda la montura. Es independiente
    // del slider "Size" que ve el cliente: aquí calibramos el valor POR DEFECTO
    // (la constante OUTER_CANTHAL_MM), no la preferencia de cada usuario.
    scale: 1,
    flipYaw: false,
    showOccluder: false,
  });
  const tuneRef = useRef(tune);
  tuneRef.current = tune;
  const [live, setLive] = useState(null);   // lecturas para el panel

  const color = product.colors[ci] || product.colors[0];
  sizeRef.current = size;
  yOffRef.current = yOff;

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

  // 2) MediaPipe
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
          // La pose 3D de la cabeza: imprescindible para orientar la montura.
          outputFacialTransformationMatrixes: true,
        });
        if (cancelled) { lm.close?.(); return; }
        lmRef.current = lm;
      } catch (e) { if (DEBUG) console.warn("[tryon] MediaPipe no disponible", e); }
    })();
    return () => { cancelled = true; lmRef.current?.close?.(); lmRef.current = null; };
  }, []);

  // 3) escena three.js (una sola vez)
  useEffect(() => {
    const canvas = canvasRef.current, stage = stageRef.current;
    if (!canvas || !stage) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    // Sin entorno, un material metálico se ve negro: el metal sólo refleja.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(0.4, 0.8, 1);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xdce6ff, 0.7);
    rim.position.set(-0.6, 0.2, 0.5);
    scene.add(rim);

    // Ortográfica en píxeles: x∈[0,W] a la derecha, y∈[0,H] hacia ARRIBA.
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 20000);
    camera.position.set(0, 0, 5000);

    const occluder = createFaceOccluder();
    scene.add(occluder);

    // Contenedor de la montura: aquí se aplican pose y escala.
    const root = new THREE.Group();
    scene.add(root);

    glRef.current = { renderer, scene, camera, occluder, root, pmrem };

    const measure = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      stageSizeRef.current = { w, h };
      renderer.setSize(w, h, false);
      camera.left = 0; camera.right = w;
      camera.top = h; camera.bottom = 0;
      camera.updateProjectionMatrix();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);

    return () => {
      ro.disconnect();
      occluder.dispose();
      pmrem.dispose();
      scene.environment?.dispose?.();
      renderer.dispose();
      glRef.current = null;
    };
  }, []);

  // 4) (re)construir la montura al cambiar de producto o color
  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;
    const frame = buildFrame(product, color?.hex);
    gl.root.add(frame);
    frameRef.current = frame;
    return () => {
      gl.root.remove(frame);
      frame.userData.dispose?.();
      if (frameRef.current === frame) frameRef.current = null;
    };
  }, [product, color?.hex]);

  // 5) bucle de render
  useEffect(() => {
    const setTrackingOnce = (on) => {
      if (trackingRef.current === on) return;
      trackingRef.current = on;
      setTracking(on);
    };

    // reutilizables, para no crear objetos por fotograma
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const tmpPos = new THREE.Vector3();
    const tmpScale = new THREE.Vector3();
    const euler = new THREE.Euler();
    const forward = new THREE.Vector3();
    const smoothQuat = new THREE.Quaternion();
    let haveQuat = false;

    const loop = () => {
      if (!runningRef.current) return;
      rafRef.current = requestAnimationFrame(loop);

      const gl = glRef.current, v = videoRef.current, frame = frameRef.current;
      const { w: W, h: H } = stageSizeRef.current;
      if (!gl || !v || !W || !H) return;
      if (!v.videoWidth || v.readyState < 2) return;

      const now = performance.now();

      const isNewFrame = v.currentTime !== lastFrameTimeRef.current;
      if (lmRef.current && isNewFrame) {
        lastFrameTimeRef.current = v.currentTime;
        try {
          const res = lmRef.current.detectForVideo(v, now);
          const lms = res?.faceLandmarks?.[0];
          if (lms) {
            // object-fit: cover → escala/offset del vídeo tal como se muestra.
            const vAsp = v.videoWidth / v.videoHeight, dAsp = W / H;
            let sx, sy, ox = 0, oy = 0;
            if (vAsp > dAsp) { sy = H; sx = H * vAsp; ox = (W - sx) / 2; }
            else { sx = W; sy = W / vAsp; oy = (H - sy) / 2; }
            // Espejado (selfie) en x; y hacia arriba para three.js; la z de
            // MediaPipe viene en la misma escala que x, y negativa hacia cámara.
            const project = (lm) => ({
              x: ox + (1 - lm.x) * sx,
              y: H - (oy + lm.y * sy),
              z: -lm.z * sx,
            });

            const rE = project(lms[33]), lE = project(lms[263]);
            const canthalPx = Math.hypot(rE.x - lE.x, rE.y - lE.y);
            const pxPerMm = (canthalPx / OUTER_CANTHAL_MM) * tuneRef.current.scale;

            // Orientación: la matriz rígida de MediaPipe. Como espejamos la
            // imagen, hay que espejar también la rotación → se niegan el giro
            // (Y) y el ladeo (Z), el cabeceo (X) se mantiene.
            const mtx = res.facialTransformationMatrixes?.[0]?.data;
            if (mtx) {
              m4.fromArray(mtx);                       // column-major, igual que three
              m4.decompose(tmpPos, quat, tmpScale);
              euler.setFromQuaternion(quat, "YXZ");
              // El vídeo va espejado, así que el giro se invierte. Si en la
              // prueba con cámara la montura gira al revés que la cabeza, es
              // este signo: el interruptor del panel lo cambia sin recompilar.
              euler.y = tuneRef.current.flipYaw ? euler.y : -euler.y;
              euler.z = -euler.z;
              quat.setFromEuler(euler);
              if (!haveQuat) { smoothQuat.copy(quat); haveQuat = true; }
              else smoothQuat.slerp(quat, SMOOTHING);
            }

            const next = {
              cx: (rE.x + lE.x) / 2,
              cy: (rE.y + lE.y) / 2,
              cz: (rE.z + lE.z) / 2,
              pxPerMm,
            };
            const prev = poseRef.current;
            const ema = (a, b) => a + (b - a) * SMOOTHING;
            poseRef.current = prev ? {
              cx: ema(prev.cx, next.cx), cy: ema(prev.cy, next.cy),
              cz: ema(prev.cz, next.cz), pxPerMm: ema(prev.pxPerMm, next.pxPerMm),
            } : next;

            gl.occluder.expand = tuneRef.current.expand;
            gl.occluder.expandUp = tuneRef.current.expandUp;
            gl.occluder.updateFromLandmarks(lms, project);
            gl.occluder.visible = true;
            lastSeenRef.current = now;
            setTrackingOnce(true);

            if (DEBUG && now - lastLogRef.current > 1000) {
              lastLogRef.current = now;
              const d = frameDimensions(product);
              // Ancho dibujado ÷ ancho real de la cara entre sienes. Debería
              // rondar 1.0: es la comprobación objetiva de que la escala es
              // correcta, sin depender de la impresión visual.
              const sideR = project(lms[234]), sideL = project(lms[454]);
              const facePx = Math.hypot(sideR.x - sideL.x, sideR.y - sideL.y);
              const gw = d.totalWidth * pxPerMm * sizeRef.current;
              setLive({
                gwOverFace: +(gw / facePx).toFixed(3),
                yaw: +(euler.y * 180 / Math.PI).toFixed(1),
                pitch: +(euler.x * 180 / Math.PI).toFixed(1),
                roll: +(euler.z * 180 / Math.PI).toFixed(1),
                construction: d.construction,
              });
              console.log("[tryon3d]", JSON.stringify({
                sku: product.sku, shape: product?.attributes?.shape,
                eye: d.eye, bridge: d.bridge, temple: d.temple,
                frameWidthMm: +d.totalWidth.toFixed(1),
                canthalPx: +canthalPx.toFixed(1), pxPerMm: +pxPerMm.toFixed(3),
                frameWidthPx: +(d.totalWidth * pxPerMm * sizeRef.current).toFixed(1),
                yawDeg: +(euler.y * 180 / Math.PI).toFixed(1),
                pitchDeg: +(euler.x * 180 / Math.PI).toFixed(1),
                rollDeg: +(euler.z * 180 / Math.PI).toFixed(1),
                hasMatrix: !!mtx, lmCount: lms.length,
              }));
            }
          }
        } catch (err) { if (DEBUG) console.warn("[tryon] frame error", err); }
      }

      const pose = poseRef.current;
      const fresh = pose && (now - lastSeenRef.current) < LOST_FACE_GRACE_MS;
      if (!fresh) {
        if (pose) { poseRef.current = null; lastFrameTimeRef.current = -1; haveQuat = false; }
        setTrackingOnce(false);
        gl.occluder.visible = false;
      }

      if (frame) {
        if (fresh) {
          // mm → px, con el ajuste manual del usuario encima.
          const s = pose.pxPerMm * sizeRef.current;
          frame.scale.setScalar(s);
          frame.quaternion.copy(smoothQuat);
          // Adelantar la montura respecto de la superficie de la cara, en la
          // dirección a la que mira la cabeza.
          forward.set(0, 0, 1).applyQuaternion(smoothQuat)
            .multiplyScalar(tuneRef.current.forwardMm * s);
          frame.position.set(
            pose.cx + forward.x,
            pose.cy + forward.y + yOffRef.current * H,
            pose.cz + forward.z
          );
        } else {
          // Sin cara: la montura de frente, centrada, a tamaño razonable.
          const d = frameDimensions(product);
          const s = (W * 0.55 * sizeRef.current) / d.totalWidth;
          frame.scale.setScalar(s);
          frame.quaternion.identity();
          frame.position.set(W / 2, H * (0.55 - yOffRef.current), 0);
        }
      }

      gl.renderer.render(gl.scene, gl.camera);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [product]);

  // El oclusor es invisible por diseño (sólo escribe profundidad). Poder verlo
  // en verde es lo que hace evidente si el volumen cubre la cabeza o no.
  useEffect(() => {
    glRef.current?.occluder?.setDebugVisible?.(tune.showOccluder);
  }, [tune.showOccluder]);

  const setTuneKey = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : parseFloat(e.target.value);
    setTune((t) => ({ ...t, [k]: v }));
  };

  return createPortal(
    <div className="tryon" role="dialog" aria-modal="true">
      <div className="tryon-bar">
        <span className="tryon-title">👓 {t("tryon.title")} · {product.name}</span>
        <button className="tryon-x" onClick={onClose} aria-label={t("tryon.close")}>×</button>
      </div>

      <div className="tryon-stage" ref={stageRef}>
        <video ref={videoRef} className="tryon-video" playsInline muted />
        <canvas ref={canvasRef} className="tryon-gl" />

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
      {DEBUG && (
        <div className="tryon-tune">
          <div className="tryon-tune-row">
            <strong>Calibrado</strong>
            {live && (
              <span className="tryon-tune-live">
                ancho/cara <b className={live.gwOverFace > 0.85 && live.gwOverFace < 1.15 ? "ok" : "bad"}>
                  {live.gwOverFace}
                </b>
                {" · "}giro {live.yaw}° · cabeceo {live.pitch}° · ladeo {live.roll}°
                {" · "}{live.construction}
              </span>
            )}
          </div>
          <label>
            Escala <b>{tune.scale.toFixed(2)}×</b>
            <input type="range" min="0.8" max="1.4" step="0.01"
                   value={tune.scale} onChange={setTuneKey("scale")} />
          </label>
          <label>
            Profundidad <b>{tune.forwardMm} mm</b>
            <input type="range" min="0" max="30" step="0.5"
                   value={tune.forwardMm} onChange={setTuneKey("forwardMm")} />
          </label>
          <label>
            Oclusor ancho <b>{tune.expand.toFixed(2)}×</b>
            <input type="range" min="0.9" max="1.3" step="0.01"
                   value={tune.expand} onChange={setTuneKey("expand")} />
          </label>
          <label>
            Oclusor alto <b>{tune.expandUp.toFixed(2)}×</b>
            <input type="range" min="1" max="2.2" step="0.02"
                   value={tune.expandUp} onChange={setTuneKey("expandUp")} />
          </label>
          <label className="tryon-tune-check">
            <input type="checkbox" checked={tune.showOccluder} onChange={setTuneKey("showOccluder")} />
            Ver oclusor
          </label>
          <label className="tryon-tune-check">
            <input type="checkbox" checked={tune.flipYaw} onChange={setTuneKey("flipYaw")} />
            Invertir giro
          </label>
          <button type="button" className="tryon-tune-copy"
                  onClick={() => {
                    const out = JSON.stringify({ ...tune, size, yOff, live }, null, 2);
                    navigator.clipboard?.writeText(out);
                    console.log("[tryon calibrado]", out);
                  }}>
            Copiar valores
          </button>
        </div>
      )}
      <p className="tryon-hint">{t("tryon.hint")}</p>
    </div>,
    document.body
  );
}
