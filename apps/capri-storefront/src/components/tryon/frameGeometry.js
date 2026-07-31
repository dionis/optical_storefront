import * as THREE from "three";

// Construye una montura 3D real a partir de las medidas físicas del catálogo.
//
// Por qué es procedural y no un glTF por SKU: las fotos del proveedor son tomas
// en perspectiva 3/4 (el frente ocupa sólo ~55% del ancho de la imagen), así que
// no sirven como overlay, y no existe una vista frontal que scrapear. Pero el
// catálogo SÍ trae las medidas reales — calibre, puente, varilla, forma y
// material — que es exactamente lo que define la geometría de una montura.
//
// Todo se modela en MILÍMETROS y se centra en el puente; el consumidor escala.
// Para montar un glTF real de un SKU concreto basta con sustituir buildFrame()
// por el loader: el resto del pipeline (pose, oclusión, escala) no cambia.

// Perfiles de lente por `attributes.shape`.
//   h     alto de la lente en fracción del calibre
//   n     "cuadratura" de la superelipse: 2 = elipse pura, ↑ = más rectangular
//   lift  eleva la esquina externa superior (ojo de gato)
//   taper estrecha la mitad inferior (navegador)
const SHAPES = {
  "cuadrado":            { h: 0.80, n: 4.2, lift: 0.00, taper: 0.02 },
  "rectángulo":          { h: 0.72, n: 5.0, lift: 0.00, taper: 0.02 },
  "rectangulo":          { h: 0.72, n: 5.0, lift: 0.00, taper: 0.02 },
  "redondo":             { h: 0.98, n: 2.0, lift: 0.00, taper: 0.00 },
  "ronda modificada":    { h: 0.92, n: 2.4, lift: 0.00, taper: 0.00 },
  "óvalo modificado":    { h: 0.80, n: 2.2, lift: 0.00, taper: 0.00 },
  "ovalo modificado":    { h: 0.80, n: 2.2, lift: 0.00, taper: 0.00 },
  "ojo de gato":         { h: 0.80, n: 2.8, lift: 0.38, taper: 0.16 },
  "navegador":           { h: 0.78, n: 3.4, lift: 0.05, taper: 0.16 },
  "geométrico":          { h: 0.80, n: 7.0, lift: 0.03, taper: 0.10 },
  "geometrico":          { h: 0.80, n: 7.0, lift: 0.03, taper: 0.10 },
  // Faltaban: el catálogo vivo las usa (aviador 16 SKUs, oval 5, shield 1) y
  // caían todas en DEFAULT_SHAPE con una silueta que no era la suya.
  "aviador":             { h: 0.86, n: 2.6, lift: 0.06, taper: 0.26 },
  "aviator":             { h: 0.86, n: 2.6, lift: 0.06, taper: 0.26 },
  "oval":                { h: 0.62, n: 2.0, lift: 0.00, taper: 0.00 },
  "óvalo":               { h: 0.62, n: 2.0, lift: 0.00, taper: 0.00 },
  "shield":              { h: 0.76, n: 4.0, lift: 0.02, taper: 0.06 },
  // Estas dos no están en el catálogo vivo pero sí en el seed empaquetado
  // (products.js), que actúa de respaldo — por eso se quedan.
  "combo":               { h: 0.82, n: 2.8, lift: 0.04, taper: 0.04 },
  "marco completo":      { h: 0.80, n: 3.6, lift: 0.00, taper: 0.02 },
};
const DEFAULT_SHAPE = { h: 0.82, n: 3.0, lift: 0.02, taper: 0.03 };

// "54-56 mm" → 55
export function parseMm(value, fallback = null) {
  const nums = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return fallback;
  return nums.reduce((acc, n) => acc + parseFloat(n), 0) / nums.length;
}

// `attributes.style` describe cómo se sujeta la lente, no su silueta. Es un eje
// independiente de `shape`: una montura redonda puede ser al aire o de aro
// completo. Sin esto, los 41 SKUs Semi/3-Piece Rimless del catálogo salían con
// un marco que no existe.
//   full     aro cerrado alrededor de la lente
//   semi     aro sólo por arriba; el borde inferior va al aire
//   rimless  sin aro: la lente se atornilla al puente y a las varillas
function constructionFor(style) {
  const s = String(style || "").toLowerCase();
  if (s.includes("3-piece") || s === "rimless") return "rimless";
  if (s.includes("semi")) return "semi";
  // "Full frame", "Full Rim", "Combo" (combinación de materiales, no al aire)
  // y "Sunglasses" son todas de aro cerrado. Sin dato → full, que es el 82%.
  return "full";
}

export function frameDimensions(product) {
  const a = product?.attributes || {};
  const eye = parseMm(a.eye_size, 52);
  const bridge = parseMm(a.bridge_size, 18);
  const temple = parseMm(a.temple_length, 142);
  const shape = SHAPES[String(a.shape || "").toLowerCase()] || DEFAULT_SHAPE;
  // El alto de lente ahora sale del dato real del proveedor (B Measurement,
  // 84% del catálogo). La fracción por forma queda de respaldo: es lo que se
  // usaba para todos, así que quien no traiga el dato no empeora.
  const lensH = parseMm(a.b_measurement, null) ?? eye * shape.h;
  return {
    eye, bridge, temple, shape, lensH,
    construction: constructionFor(a.style),
    // Ancho total del frente: dos lentes + puente + los aros exteriores.
    totalWidth: 2 * eye + bridge + 8,
  };
}

const SEGMENTS = 112;

// Contorno de lente como SUPERELIPSE: |x/a|^n + |y/b|^n = 1.
// n=2 da una elipse perfecta y n alto un rectángulo redondeado, con lo que una
// sola familia cubre todas las formas del catálogo. La versión anterior usaba
// Bézier con puntos de control calculados a mano y degeneraba —con radio grande
// el control coincidía con el extremo y la curva colapsaba en un rombo.
function lensPoints(w, h, { n, lift, taper }, side, segments = SEGMENTS) {
  const hw = w / 2, hh = h / 2;
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    let x = hw * Math.sign(ct) * Math.abs(ct) ** (2 / n);
    let y = hh * Math.sign(st) * Math.abs(st) ** (2 / n);
    // estrecha la mitad inferior
    if (y < 0 && taper) x *= 1 - taper * (-y / hh);
    // eleva sólo la esquina superior EXTERNA (la que se aleja del puente).
    // El peso se anula tanto hacia el puente como en el ecuador: sin el factor
    // `up`, el punto exacto de y=0 no se elevaba y su vecino sí, dejando un
    // escalón de varios milímetros en el contorno.
    if (y > 0 && lift) {
      const outward = Math.max(0, (side > 0 ? x : -x) / hw);
      const up = y / hh;
      y += lift * h * outward * outward * up;
    }
    pts.push(new THREE.Vector2(x, y));
  }
  return pts;
}

function shapeFromPoints(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i].x, pts[i].y);
  s.closePath();
  return s;
}

// x del contorno exterior a una altura y dada — para enganchar la varilla
// exactamente en el borde del aro y no flotando fuera de él.
function rimEdgeXSafe(w, h, { n }, y) {
  const hw = w / 2, hh = h / 2;
  const k = Math.min(1, Math.abs(y) / hh);
  return hw * (1 - k ** n) ** (1 / n);
}

// Aro: la silueta exterior menos la interior, extruida → un marco con grosor.
function rimMesh(dim, side, rimW, depth, material) {
  const { eye, lensH, shape } = dim;
  const outer = shapeFromPoints(lensPoints(eye, lensH, shape, side));
  const inner = lensPoints(eye - 2 * rimW, lensH - 2 * rimW, shape, side).reverse();
  outer.holes.push(new THREE.Path(inner));
  const geo = new THREE.ExtrudeGeometry(outer, {
    depth, bevelEnabled: true, bevelThickness: rimW * 0.30,
    bevelSize: rimW * 0.25, bevelSegments: 2, curveSegments: 12,
  });
  // Sólo centramos en Z: en XY la silueta ya nace centrada, y un center()
  // completo desplazaría las formas asimétricas como el ojo de gato.
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, material);
}

// Aro semi al aire: sólo el tramo superior del contorno, como tubo. El borde
// inferior de la lente queda visto — en la montura real lo sujeta un hilo de
// nylon, demasiado fino para modelarlo a esta escala.
function semiRimMesh(dim, side, rimW, material) {
  const { eye, lensH, shape } = dim;
  const pts = lensPoints(eye, lensH, shape, side);
  // lensPoints recorre t de 0 a 2π desde (hw, 0), así que la mitad con y >= 0
  // ya viene ordenada de un extremo al otro pasando por arriba.
  const upper = pts.filter((p) => p.y >= -lensH * 0.04);
  if (upper.length < 4) return null;
  const curve = new THREE.CatmullRomCurve3(
    upper.map((p) => new THREE.Vector3(p.x, p.y, 0))
  );
  const geo = new THREE.TubeGeometry(curve, upper.length, rimW * 0.55, 8, false);
  return new THREE.Mesh(geo, material);
}

// Cristal. Con aro cerrado la lente va encajada dentro y se encoge el grosor
// del marco; al aire, la lente ES la silueta completa y hay que subirle un poco
// la opacidad, porque sin marco alrededor era prácticamente invisible.
function lensMesh(dim, side, rimW) {
  const { eye, lensH, shape, construction } = dim;
  const inset = construction === "rimless" ? 0 : rimW;
  const geo = new THREE.ShapeGeometry(
    shapeFromPoints(lensPoints(eye - 2 * inset, lensH - 2 * inset, shape, side)), 12
  );
  return new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true,
    opacity: construction === "full" ? 0.12 : 0.22,
    roughness: 0.05,
    metalness: 0, transmission: 0.9, thickness: 0.5, side: THREE.DoubleSide,
    depthWrite: false,
  }));
}

// Varilla: nace en el borde externo del aro, corre hacia atrás (−Z) y cae tras
// la oreja. TubeGeometry sobre una curva Catmull-Rom.
function templeMesh(dim, side, material, thickness) {
  const { eye, bridge, temple, lensH, shape } = dim;
  const y0 = lensH * 0.26;          // la bisagra va arriba, no al centro
  // Enganchar la varilla en el BORDE REAL del aro a esa altura. Antes se
  // colocaba en el ancho máximo (que sólo ocurre en y=0), y quedaba flotando
  // separada del marco.
  const x0 = side * ((eye + bridge) / 2 + rimEdgeXSafe(eye, lensH, shape, y0));
  const back = temple * 0.78;       // tramo recto hasta la oreja
  const drop = temple * 0.20;       // caída tras la oreja
  // La varilla ABRE hacia fuera para salvar la sien y corre pegada al lateral
  // de la cabeza; sólo se cierra al enganchar detrás de la oreja. Si la curva
  // fuese hacia dentro, quedaría dentro del volumen de la cabeza y el oclusor
  // se la tragaría entera.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x0, y0, 0),                                          // bisagra
    new THREE.Vector3(x0 + side * 2, y0 + 0.4, -temple * 0.10),            // sale casi recta
    new THREE.Vector3(x0 + side * 4, y0 * 0.85, -back * 0.55),             // roza la sien
    new THREE.Vector3(x0 + side * 3, y0 * 0.40, -back),                    // oreja
    new THREE.Vector3(x0 + side * 1, y0 * 0.20 - drop, -back - drop * 0.4),// cae detrás
  ]);
  const geo = new THREE.TubeGeometry(curve, 40, thickness / 2, 10, false);
  return new THREE.Mesh(geo, material);
}

// Puente entre las dos lentes. Va del borde INTERNO de un aro al del otro: la
// versión anterior lo calculaba con una fórmula que se pasaba de largo, y el
// tubo cabalgaba por encima de las lentes asomando dentro del cristal.
function bridgeMesh(dim, material, rimW) {
  const { eye, bridge, lensH, shape } = dim;
  const yb = lensH * 0.20;
  const xb = (eye + bridge) / 2 - rimEdgeXSafe(eye, lensH, shape, yb);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-xb, yb, 0),
    new THREE.Vector3(-xb * 0.55, yb + lensH * 0.06, rimW * 0.25),
    new THREE.Vector3(0, yb + lensH * 0.09, rimW * 0.35),
    new THREE.Vector3(xb * 0.55, yb + lensH * 0.06, rimW * 0.25),
    new THREE.Vector3(xb, yb, 0),
  ]);
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 28, rimW * 0.50, 8, false), material
  );
}

// El material del catálogo decide si la montura es metálica o de acetato.
function frameMaterial(product, hex) {
  const mats = (product?.attributes?.material || []).map((m) => String(m).toLowerCase());
  const isMetal = mats.some((m) => /metal|acero|titanio|memoria/.test(m));
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex || "#222831"),
    metalness: isMetal ? 0.95 : 0.06,
    roughness: isMetal ? 0.28 : 0.42,
    clearcoat: isMetal ? 0.25 : 0.85,
    clearcoatRoughness: 0.25,
  });
}

/**
 * Devuelve un THREE.Group con la montura completa, en milímetros, centrada en
 * el puente y mirando a +Z. `dispose()` libera geometrías y materiales.
 */
export function buildFrame(product, hex) {
  const dim = frameDimensions(product);
  const mats = (product?.attributes?.material || []).map((m) => String(m).toLowerCase());
  const isMetal = mats.some((m) => /metal|acero|titanio|memoria/.test(m));
  // El acetato es notablemente más grueso que el metal.
  const rimW = isMetal ? 1.8 : 4.2;
  const depth = isMetal ? 2.0 : 4.5;
  const templeTh = isMetal ? 1.6 : 3.6;

  const material = frameMaterial(product, hex);
  const group = new THREE.Group();
  const offset = (dim.eye + dim.bridge) / 2;   // centro de lente ← → puente

  for (const side of [-1, 1]) {
    // El aro depende de `style`, no de la forma: full lo cierra, semi sólo por
    // arriba, y al aire no lleva ninguno.
    let rim = null;
    if (dim.construction === "full") {
      rim = rimMesh(dim, side, rimW, depth, material);
    } else if (dim.construction === "semi") {
      rim = semiRimMesh(dim, side, rimW, material);
    }
    if (rim) {
      rim.position.set(side * offset, 0, 0);
      group.add(rim);
    }

    const glass = lensMesh(dim, side, rimW);
    glass.position.set(side * offset, 0, depth * 0.1);
    group.add(glass);

    group.add(templeMesh(dim, side, material, templeTh));
  }
  group.add(bridgeMesh(dim, material, rimW));

  group.userData.dimensions = dim;
  group.userData.dispose = () => {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  };
  return group;
}
