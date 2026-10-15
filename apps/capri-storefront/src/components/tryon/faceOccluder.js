import * as THREE from "three";

// Oclusor de cabeza: un volumen invisible que SÓLO escribe profundidad, para
// que las varillas que pasan por detrás del cráneo desaparezcan en lugar de
// dibujarse encima de la mejilla. Es lo que separa un try-on 3D de una
// calcomanía: sin oclusión la montura siempre se lee como superpuesta.
//
// Se construye con el contorno facial de MediaPipe extruido hacia atrás,
// aproximando la cabeza como un prisma cerrado.

// Anillo FACE_OVAL de MediaPipe, ya ordenado (36 puntos, sentido horario).
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

const N = FACE_OVAL.length;
// El óvalo de landmarks ya cae prácticamente en el borde de la cara, a la altura
// de la oreja. Ensancharlo empuja el volumen por FUERA de las varillas y se las
// traga enteras — que es justo lo que pasaba con 1.06. Se deja a 1.0 y el ancho
// extra de cabeza se compensa abriendo la varilla en frameGeometry, no inflando
// el oclusor. Ajustable en caliente (`mesh.expand`) para calibrar sobre una cara.
export const DEFAULT_EXPAND = 1.06;

// El anillo FACE_OVAL termina a media frente — el landmark 10 no es la
// coronilla — así que el cráneo queda fuera del volumen. Hay que estirar hacia
// ARRIBA, y sólo hacia arriba: un `expand` uniforme también ensancharía los
// laterales y volvería a tragarse las varillas, que es el equilibrio que
// acabamos de encontrar. Por eso los dos ejes van separados.
export const DEFAULT_EXPAND_UP = 1.35;

// Ensanchado del volumen hacia atrás, calibrado con cámara junto al resto.
// Ojo al ajustarlo: compite con los oclusores de oreja y gana el más agresivo.
// Subirlo adelanta el corte de la varilla y deja de mandar `earOffset`; si al
// mover "Oreja atrás" no cambia nada, es que está decidiendo este valor.
export const DEFAULT_EXPAND_BACK = 1.21;

export function createFaceOccluder() {
  // 0 = centro frontal · 1..N = anillo frontal · N+1..2N = anillo trasero
  // 2N+1 = centro trasero
  const vertexCount = 2 * N + 2;
  const positions = new Float32Array(vertexCount * 3);
  const indices = [];

  const front = (i) => 1 + i;
  const back = (i) => 1 + N + i;

  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    indices.push(0, front(j), front(i));                    // tapa frontal
    indices.push(back(i), back(j), 2 * N + 1);              // tapa trasera
    indices.push(front(i), front(j), back(j));              // faldón lateral
    indices.push(front(i), back(j), back(i));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);

  // colorWrite:false → no pinta nada, pero sí ocupa el z-buffer.
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;              // debe escribir profundidad ANTES de la montura
  mesh.expand = DEFAULT_EXPAND;       // lateral
  mesh.expandUp = DEFAULT_EXPAND_UP;      // hacia la frente y el cráneo
  mesh.expandBack = DEFAULT_EXPAND_BACK;  // ensanchado hacia la nuca/orejas

  // La visualización va en una malla APARTE que comparte la geometría.
  // Poner `wireframe` en el material del oclusor real lo rompe: en modo alambre
  // sólo se rasterizan las aristas, así que deja de escribir profundidad en el
  // interior y el oclusor deja de ocluir. O sea que al activar "Ver oclusor" se
  // desactivaba justo lo que se quería inspeccionar.
  const debugMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff88, wireframe: true, depthWrite: false, transparent: true, opacity: 0.6,
  });
  const debugMesh = new THREE.Mesh(geometry, debugMaterial);
  debugMesh.frustumCulled = false;
  debugMesh.visible = false;
  mesh.add(debugMesh);
  mesh.setDebugVisible = (on) => { debugMesh.visible = on; };

  /**
   * Recoloca el oclusor con los landmarks del fotograma actual.
   * @param {Array} lms       los 478 landmarks normalizados
   * @param {Function} project (lm) => {x, y, z} en el espacio de la escena
   */
  mesh.updateFromLandmarks = (lms, project) => {
    if (!lms) return false;
    const pts = [];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N; i++) {
      const lm = lms[FACE_OVAL[i]];
      if (!lm) return false;
      const p = project(lm);
      pts.push(p);
      cx += p.x; cy += p.y; cz += p.z;
    }
    cx /= N; cy /= N; cz /= N;

    // Profundidad de la cabeza ≈ su anchura; suficiente para tragarse la
    // varilla del lado opuesto cuando la cara gira.
    let maxR = 0;
    for (const p of pts) maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
    const depth = maxR * 2.0;

    positions[0] = cx; positions[1] = cy; positions[2] = cz;
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      // La proyección deja +Y hacia arriba, así que dy > 0 es la mitad de la
      // frente: sólo esa se estira, para no ensanchar de paso los laterales.
      const dy = p.y - cy;
      const ex = cx + (p.x - cx) * mesh.expand;
      const ey = cy + dy * (dy > 0 ? mesh.expandUp : mesh.expand);
      let o = front(i) * 3;
      positions[o] = ex; positions[o + 1] = ey; positions[o + 2] = p.z;
      // El anillo trasero es MÁS ANCHO que el frontal: así la varilla puede
      // verse por delante y meterse detrás a la altura de la oreja.
      o = back(i) * 3;
      positions[o] = cx + (ex - cx) * mesh.expandBack;
      positions[o + 1] = cy + (ey - cy) * mesh.expandBack;
      positions[o + 2] = p.z - depth;
    }
    const o = (2 * N + 1) * 3;
    positions[o] = cx; positions[o + 1] = cy; positions[o + 2] = cz - depth;

    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return true;
  };

  mesh.dispose = () => { geometry.dispose(); material.dispose(); debugMaterial.dispose(); };
  return mesh;
}

// ── Oclusores de oreja ─────────────────────────────────────────────────────
// El prisma de arriba se abre de forma lineal, así que el punto donde la
// varilla se mete dentro depende del ancho delantero Y del ensanchado trasero:
// dos parámetros que hay que pelear entre sí y que nunca caen justo en la
// oreja. Esto lo ancla al sitio real.
//
// MediaPipe no expone landmarks de oreja, pero 234 y 454 son los extremos
// laterales del óvalo facial y caen prácticamente en el trago. Se planta en
// cada uno una caja que sólo escribe profundidad y se extiende HACIA ATRÁS:
// la varilla se ve hasta llegar ahí y desaparece a partir de ese punto, que es
// exactamente lo que hace una montura real.
export const EAR_INDEX = { right: 234, left: 454 };
// `offset` empuja la caja hacia ATRÁS desde el landmark. Hace falta porque
// 234/454 caen en el borde visible de la mejilla, no en el trago: la malla
// facial de MediaPipe no llega a la oreja, así que el ancla queda adelantada
// y el corte de la varilla se produce antes de tiempo.
export const DEFAULT_EAR = { w: 30, h: 65, d: 130, offset: 17 };   // mm

export function createEarOccluders() {
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const group = new THREE.Group();
  const meshes = [new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material)];
  for (const m of meshes) {
    m.frustumCulled = false;
    m.renderOrder = -1;            // profundidad antes que la montura
    group.add(m);
  }
  group.size = { ...DEFAULT_EAR };

  // Igual que arriba: el alambre va en mallas hijas para no romper la
  // escritura de profundidad de las cajas reales.
  const debugMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8800, wireframe: true, depthWrite: false, transparent: true, opacity: 0.7,
  });
  const debugMeshes = meshes.map((m) => {
    const d = new THREE.Mesh(geometry, debugMaterial);
    d.frustumCulled = false;
    d.visible = false;
    m.add(d);              // hereda posición, rotación y escala del padre
    return d;
  });
  group.setDebugVisible = (on) => { for (const d of debugMeshes) d.visible = on; };

  /**
   * @param {Array} pts       [oreja derecha, oreja izquierda] ya proyectadas
   * @param {THREE.Quaternion} quat  orientación de la cabeza
   * @param {number} pxPerMm  escala del rostro actual
   */
  group.update = (pts, quat, pxPerMm) => {
    const { w, h, d, offset } = group.size;
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    for (let i = 0; i < 2; i++) {
      const m = meshes[i], p = pts[i];
      if (!p) { m.visible = false; continue; }
      m.visible = true;
      m.scale.set(w * pxPerMm, h * pxPerMm, d * pxPerMm);
      m.quaternion.copy(quat);
      // La caja arranca en (landmark + offset) y crece hacia atrás, por eso se
      // desplaza además media profundidad: así su cara delantera cae justo en
      // el punto donde debe cortarse la varilla.
      const shift = (offset + d / 2) * pxPerMm;
      m.position.set(p.x + back.x * shift, p.y + back.y * shift, p.z + back.z * shift);
    }
  };

  group.dispose = () => { geometry.dispose(); material.dispose(); debugMaterial.dispose(); };
  return group;
}
