// Auto-recorte del blanco. Detecta el "bounding box" del contenido (lo que NO es
// casi-blanco) de cada imagen de montura y calcula un transform (escala + origen)
// para que ese contenido llene su recuadro, recortando el máximo de blanco y
// viéndose lo más grande posible. Cada imagen puede traer distinto margen, así que
// se mide una por una. Requiere que la imagen se pueda leer por canvas (CORS);
// Supabase lo permite. Si la imagen queda "tainted" o falla, devuelve null y el
// visor cae a su tamaño normal (nunca rompe).

const _cache = new Map(); // src -> {fx0,fy0,fx1,fy1,natAspect} | null

export function getCachedBBox(src) {
  return _cache.get(src);
}

// Mide (una sola vez por src) el bounding box del contenido, en fracciones 0..1.
export function measureBBox(src) {
  if (!src) return Promise.resolve(null);
  if (_cache.has(src)) return Promise.resolve(_cache.get(src));
  return new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const W = 160;
        const H = Math.max(1, Math.round((W * im.naturalHeight) / im.naturalWidth));
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(im, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
            // Contenido = pixel visible que NO es casi-blanco.
            if (a > 12 && !(r > 243 && g > 243 && b > 243)) {
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        let bb = null;
        if (x1 >= x0 && y1 >= y0) {
          bb = { fx0: x0 / W, fy0: y0 / H, fx1: (x1 + 1) / W, fy1: (y1 + 1) / H, natAspect: im.naturalWidth / im.naturalHeight };
        }
        _cache.set(src, bb);
        resolve(bb);
      } catch (e) {
        _cache.set(src, null); // tainted/CORS → sin recorte
        resolve(null);
      }
    };
    im.onerror = () => { _cache.set(src, null); resolve(null); };
    im.src = src;
  });
}

// Dado el tamaño del recuadro (boxW x boxH) y el bbox, calcula el transform que
// ajusta el contenido para llenar el recuadro. `mirror` = la imagen se voltea con
// scaleX(-1) por dentro, así que el centro visible en X se invierte. `fill` deja un
// pequeño margen. La escala se limita a [1, 2.6] para no encoger ni pixelar.
export function fitTransform(boxW, boxH, bb, mirror, fill = 0.94) {
  if (!bb || !boxW || !boxH) return null;
  const A = bb.natAspect || 1;
  let rw, rh;
  if (A >= boxW / boxH) { rw = boxW; rh = boxW / A; } else { rh = boxH; rw = boxH * A; }
  const cw = rw * (bb.fx1 - bb.fx0);
  const ch = rh * (bb.fy1 - bb.fy0);
  if (cw <= 0 || ch <= 0) return null;
  const cx = (boxW - rw) / 2 + ((bb.fx0 + bb.fx1) / 2) * rw;
  const cy = (boxH - rh) / 2 + ((bb.fy0 + bb.fy1) / 2) * rh;
  let oxPct = (cx / boxW) * 100;
  const oyPct = (cy / boxH) * 100;
  if (mirror) oxPct = 100 - oxPct;
  let S = Math.min(boxW / cw, boxH / ch) * fill;
  S = Math.max(1, Math.min(2.6, S));
  return { transform: `scale(${S.toFixed(3)})`, transformOrigin: `${oxPct.toFixed(2)}% ${oyPct.toFixed(2)}%` };
}
