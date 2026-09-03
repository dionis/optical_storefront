// ─────────────────────────────────────────────────────────────────────────────
// Medición óptica EN EL NAVEGADOR (sin IA), con el criterio del laboratorio.
//
// Calcula, a partir de la foto FRONTAL del cliente:
//   · PD binocular y PD monocular (OD/OS) — distancia pupilar,
//   · altura de corredor (fitting height para progresivos),
//   · altura de bifocal,
// usando tres cosas:
//   1) el IRIS como "regla invisible": el diámetro horizontal visible del iris
//      humano promedia 11.7 mm en adultos y es muy estable, así que da la escala
//      px→mm sin pedirle al cliente que sostenga ninguna tarjeta.
//   2) los landmarks faciales de MediaPipe FaceLandmarker (incluye iris).
//   3) las dimensiones reales de la MONTURA (sistema boxing): A = calibre (ancho
//      de lente), DBL = puente, B = alto de lente. A/DBL/B vienen del catálogo.
//
// La IA (Gemini) SOLO hace el montaje fotorrealista de las gafas; estos números
// NO dependen de ella. Sigue siendo una estimación (una foto no sustituye al
// pupilómetro en tienda), pero es NUESTRA medición geométrica reproducible.
//
// Método de la altura de corredor (boxing):
//   - Se ancla la montura por el puente sobre el caballete de la nariz.
//   - Se asume el puente ≈ centro vertical de la caja de lente (aprox. estándar),
//     de modo que el borde inferior de la lente queda B/2 por debajo del asiento.
//   - Altura de corredor = distancia vertical (en mm, vía escala del iris) desde
//     el centro de la pupila hasta ese borde inferior de la lente.
//   Este anclaje es ajustable (ver ANCHOR_BRIDGE_FROM_TOP) si se quiere afinar.
// ─────────────────────────────────────────────────────────────────────────────

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.6";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Diámetro horizontal visible del iris (media adulta), en mm. Es la "regla".
const HVID_MM = 11.7;
// Fracción de B a la que queda el asiento del puente respecto al TOP de la lente.
// 0.5 = el puente está en el centro vertical de la caja (aprox. estándar). Subir
// hacia 0.35-0.45 si la montura monta más alta; ajustable sin tocar el resto.
const ANCHOR_BRIDGE_FROM_TOP = 0.5;

// Índices de landmarks (FaceLandmarker, 478 puntos con iris refinado).
const IRIS_L_CENTER = 468, IRIS_L_R = 469, IRIS_L_L = 471; // ojo en un lado
const IRIS_R_CENTER = 473, IRIS_R_R = 474, IRIS_R_L = 476; // ojo en el otro
const CANTHUS_INNER_A = 133, CANTHUS_INNER_B = 362;        // cantos internos
const NOSE_BRIDGE = [168, 6, 197, 195];                    // cresta nasal = línea media sagital
const NOSE_SADDLE = 6;                                     // caballete (asiento)
const LID_LOWER_A = 145, LID_LOWER_B = 374;                // párpados inferiores
const FACE_SIDE_R = 234, FACE_SIDE_L = 454;                // contorno lateral del rostro (ancho)

let _lmPromise = null;
async function getLandmarker() {
  if (!_lmPromise) {
    _lmPromise = (async () => {
      const vision = await import(/* @vite-ignore */ MP);
      const fileset = await vision.FilesetResolver.forVisionTasks(MP + "/wasm");
      return vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL },
        runningMode: "IMAGE",
        numFaces: 1,
      });
    })().catch((e) => {
      _lmPromise = null; // permite reintentar si la carga falló (red, CDN…)
      throw e;
    });
  }
  return _lmPromise;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("img-load"));
    im.src = dataUrl;
  });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);

// "51-53 mm" | "16-17 mm" | "41-50 mm" | "140 mm" → punto medio en mm (o null).
export function midMM(range) {
  if (range == null) return null;
  const nums = String(range).match(/\d+(?:[.,]\d+)?/g);
  if (!nums || !nums.length) return null;
  const vals = nums.map((n) => parseFloat(n.replace(",", ".")));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * PD (binocular + monocular OD/OS) a partir de landmarks YA detectados.
 * Función PURA y síncrona: la usan measureFromFrontal (una foto) y el bucle de
 * captura (muchos fotogramas, para promediar). Devuelve null si no hay iris.
 *
 * Robustez de la ESCALA (clave para que el PD salga bien):
 *  - El iris es la "regla" (HVID 11.7 mm horizontal). Con la cabeza girada, el
 *    iris del ojo que gira se ACORTA y falsea la escala; por eso NO se promedia
 *    a ciegas: si los dos iris difieren >8 % (hay giro) se usa el MAYOR (el menos
 *    escorzado, más cercano al diámetro real); si concuerdan, se promedia.
 *  - El PD se mide sobre el eje que une los iris (corrige inclinación/roll) y la
 *    línea media sale de la cresta nasal (más fiable que el punto medio de ojos).
 *  - Con giro (yaw) alto, el reparto OD/OS no es fiable → se devuelve null en los
 *    monoculares (el binocular, más robusto, se conserva).
 *
 * @returns {null | {pdTotal,pdRight,pdLeft,mmPerPx,irisPx,roll,yaw,irisAsym,irisA,irisB}}
 */
export function pdFromLandmarks(L, W, H) {
  if (!L || L.length < 478) return null;
  const P = (i) => ({ x: L[i].x * W, y: L[i].y * H });
  const irisA = P(IRIS_L_CENTER), irisB = P(IRIS_R_CENTER);
  const diamA = dist(P(IRIS_L_R), P(IRIS_L_L));
  const diamB = dist(P(IRIS_R_R), P(IRIS_R_L));
  if (!(diamA > 1) || !(diamB > 1)) return null;

  const dHi = Math.max(diamA, diamB), dLo = Math.min(diamA, diamB);
  const irisAsym = (dHi - dLo) / dHi;                 // 0 = frontal perfecto
  const irisPx = irisAsym > 0.08 ? dHi : (diamA + diamB) / 2;
  const mmPerPx = HVID_MM / irisPx;

  const irisMid = { x: (irisA.x + irisB.x) / 2, y: (irisA.y + irisB.y) / 2 };
  const axLen = Math.hypot(irisB.x - irisA.x, irisB.y - irisA.y) || 1;
  const ux = (irisB.x - irisA.x) / axLen, uy = (irisB.y - irisA.y) / axLen;
  const proj = (p) => (p.x - irisMid.x) * ux + (p.y - irisMid.y) * uy;

  const bproj = NOSE_BRIDGE.map((i) => proj(P(i))).sort((a, b) => a - b);
  const bridgeMid = bproj[Math.floor(bproj.length / 2)];
  const canthiMid = proj({
    x: (P(CANTHUS_INNER_A).x + P(CANTHUS_INNER_B).x) / 2,
    y: (P(CANTHUS_INNER_A).y + P(CANTHUS_INNER_B).y) / 2,
  });
  const midOff = (bridgeMid * 2 + canthiMid) / 3;

  const pdTotal = axLen * mmPerPx;
  let pdRight = Math.abs(proj(irisA) - midOff) * mmPerPx;
  let pdLeft = Math.abs(proj(irisB) - midOff) * mmPerPx;

  const rollRaw = Math.abs(Math.atan2(irisB.y - irisA.y, irisB.x - irisA.x) * 180 / Math.PI);
  const roll = Math.min(rollRaw, Math.abs(180 - rollRaw));
  // Señal de giro combinada: nariz descentrada + asimetría de iris (más fiable).
  const yawNose = Math.abs(P(1).x - irisMid.x) / axLen;
  const yaw = Math.max(yawNose, irisAsym);
  if (yaw > 0.10) { pdRight = null; pdLeft = null; }

  return { pdTotal, pdRight, pdLeft, mmPerPx, irisPx, roll, yaw, irisAsym, irisA, irisB };
}

/**
 * Mide PD y alturas desde la foto FRONTAL.
 *
 * @param {string} frontDataUrl  data URL de la foto frontal.
 * @param {{eye?:string, bridge?:string, b?:string}} frame  dimensiones de la
 *        montura (rangos del catálogo): eye = calibre A, bridge = puente DBL,
 *        b = alto de lente B (b_measurement).
 * @returns {Promise<object>} { ok, pdTotal, pdRight, pdLeft, corridor, bifocal, ... }
 */
export async function measureFromFrontal(frontDataUrl, frame = {}) {
  if (!frontDataUrl) return { ok: false, error: "no-image" };
  let lm, img;
  try {
    lm = await getLandmarker();
    img = await loadImage(frontDataUrl);
  } catch (e) {
    return { ok: false, error: "load-failed", detail: String(e && e.message) };
  }

  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  let res;
  try {
    res = lm.detect(img);
  } catch (e) {
    return { ok: false, error: "detect-failed", detail: String(e && e.message) };
  }
  const L = res && res.faceLandmarks && res.faceLandmarks[0];
  if (!L || L.length < 478) return { ok: false, error: "no-face" };

  const P = (i) => ({ x: L[i].x * W, y: L[i].y * H });

  // PD + escala robusta (misma lógica que usa el bucle de captura para promediar).
  const pd = pdFromLandmarks(L, W, H);
  if (!pd) return { ok: false, error: "no-iris" };
  const { irisA, irisB, irisPx, mmPerPx } = pd;
  const pdTotal = pd.pdTotal;
  let pdRight = pd.pdRight, pdLeft = pd.pdLeft;

  // Alturas (necesitan B). A/DBL se devuelven como referencia aunque no se usen aquí.
  const A = midMM(frame.eye);
  const DBL = midMM(frame.bridge);
  const B = midMM(frame.b);

  const pupilY = (irisA.y + irisB.y) / 2;
  const saddleY = P(NOSE_SADDLE).y;

  let corridor = null, bifocal = null;
  if (B) {
    const Bpx = B / mmPerPx;
    // Borde inferior de la caja de lente respecto al asiento del puente.
    const lensBottomY = saddleY + Bpx * (1 - ANCHOR_BRIDGE_FROM_TOP);
    corridor = (lensBottomY - pupilY) * mmPerPx;
    const lidY = (P(LID_LOWER_A).y + P(LID_LOWER_B).y) / 2;
    bifocal = (lensBottomY - lidY) * mmPerPx;
    // Guardas de cordura: nunca negativas ni absurdas para un rostro humano.
    if (corridor != null) corridor = Math.min(40, Math.max(8, corridor));
    if (bifocal != null) bifocal = Math.min(35, Math.max(5, bifocal));
  }

  // ── Calidad / confianza de la medición ──────────────────────────────────
  // Una foto no es un pupilómetro; qué tan fiable es la medida depende de:
  //   · resolución del iris (px): más grande = escala más precisa;
  //   · inclinación de la cabeza (roll): la línea inter-iris debe ir horizontal;
  //   · giro (yaw): la nariz debe quedar centrada entre los iris (si no, el PD
  //     se acorta por perspectiva);
  //   · simetría del iris: iris muy distintos = ángulo o detección dudosa.
  // Con eso damos un nivel (high/medium/low) y un error estimado del PD en mm,
  // para que el cliente repita la toma si sale baja y el óptico sepa el margen.
  // Señales de pose ya calculadas de forma robusta en pdFromLandmarks (el reparto
  // OD/OS ya se anuló allí si el giro es alto).
  const irisAsym = pd.irisAsym, rollTilt = pd.roll, yawOff = pd.yaw;

  let score = 1;
  const reasons = [];
  if (irisPx < 28) { score -= irisPx < 18 ? 0.4 : 0.18; reasons.push("far"); }
  if (rollTilt > 8) { score -= rollTilt > 14 ? 0.3 : 0.15; reasons.push("tilt"); }
  if (yawOff > 0.06) { score -= yawOff > 0.11 ? 0.35 : 0.18; reasons.push("angle"); }
  if (irisAsym > 0.12 && !reasons.includes("angle")) { score -= 0.15; reasons.push("angle"); }
  score = Math.max(0, Math.min(1, score));
  const level = score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low";
  // Error estimado del PD (mm): jitter de ~2 px en las pupilas + penalización por
  // baja calidad. Heurístico y conservador, no una garantía metrológica.
  const estErrorMm = round1(mmPerPx * 2 + (1 - score) * 2.2);

  // ── Aviso de encaje (montura vs. ancho del rostro) ──────────────────────
  // El ancho frontal de la montura ≈ 2·A (calibre) + DBL (puente). Lo comparamos
  // con el ancho del rostro (contorno lateral) para avisar si la montura le queda
  // ANCHA o ESTRECHA. Es orientativo (no sustituye al óptico), y solo si hay A y DBL.
  let fit = null;
  if (A != null && DBL != null) {
    const faceWidthMM = dist(P(FACE_SIDE_R), P(FACE_SIDE_L)) * mmPerPx;
    const frameFrontMM = 2 * A + DBL;
    const diff = frameFrontMM - faceWidthMM;   // + = montura más ancha que la cara
    const fitLevel = diff > 8 ? "wide" : diff < -6 ? "narrow" : "good";
    fit = {
      level: fitLevel,
      faceWidthMM: round1(faceWidthMM),
      frameFrontMM: round1(frameFrontMM),
      diffMM: round1(diff),
    };
  }

  return {
    ok: true,
    pdTotal: round1(pdTotal),
    pdRight: round1(pdRight),
    pdLeft: round1(pdLeft),
    corridor: round1(corridor),
    bifocal: round1(bifocal),
    frame: { A, DBL, B },
    mmPerPx,
    scaleSource: "iris",
    // "suitable" para progresivos: ≥ 18 mm (corredor estándar).
    suitable: corridor == null ? null : corridor >= 18,
    minRequired: 18,
    // Calidad de la medición.
    quality: { level, score: Math.round(score * 100) / 100, estErrorMm, reasons },
    // Aviso de encaje montura↔rostro (orientativo).
    fit,
  };
}
