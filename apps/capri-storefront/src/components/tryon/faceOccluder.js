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
export const DEFAULT_EXPAND = 1.0;

// El anillo FACE_OVAL termina a media frente — el landmark 10 no es la
// coronilla — así que el cráneo queda fuera del volumen. Hay que estirar hacia
// ARRIBA, y sólo hacia arriba: un `expand` uniforme también ensancharía los
// laterales y volvería a tragarse las varillas, que es el equilibrio que
// acabamos de encontrar. Por eso los dos ejes van separados.
export const DEFAULT_EXPAND_UP = 1.35;

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
  mesh.expandUp = DEFAULT_EXPAND_UP;  // hacia la frente y el cráneo

  // Al calibrar hace falta VERLO: si el volumen no cubre bien la cabeza las
  // varillas asoman, y a ciegas eso no se distingue de un fallo de profundidad.
  mesh.setDebugVisible = (on) => {
    material.colorWrite = on;
    material.wireframe = on;
    material.color.set(0x00ff88);
    material.needsUpdate = true;
  };

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
      o = back(i) * 3;
      positions[o] = ex; positions[o + 1] = ey; positions[o + 2] = p.z - depth;
    }
    const o = (2 * N + 1) * 3;
    positions[o] = cx; positions[o + 1] = cy; positions[o + 2] = cz - depth;

    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return true;
  };

  mesh.dispose = () => { geometry.dispose(); material.dispose(); };
  return mesh;
}
