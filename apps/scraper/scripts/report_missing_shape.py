#!/usr/bin/env python
"""
Genera docs/tryon-shape-gaps.md: los SKUs sin `shape`, con enlaces para verificar.

`shape` es lo que decide la silueta de la lente en el probador 3D
(`frameGeometry.js`). Los SKUs que no lo traen caen todos en la misma silueta
genérica, así que es el hueco de datos que más se nota visualmente.

El dato NO se puede scrapear: el proveedor sólo clasifica 464 de sus 550
productos — sus facetas `pa_shape` suman exactamente esos 464. No es un fallo de
extracción, es que en origen no existe. Por eso el informe lleva la URL de cada
ficha: hay que clasificarlos a ojo (o con el clasificador visual) y el enlace es
para comprobar el hueco y decidir la forma mirando la foto.

    python scripts/report_missing_shape.py
"""

from __future__ import annotations

import html
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
CATALOG = ROOT / "apps" / "capri-storefront" / "public" / "catalog.json"
OUT = ROOT / "docs" / "tryon-shape-gaps.md"
STORE_API = "https://caprioptics.com/wp-json/wc/store/v1/products"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"}


def safe_url(url: str) -> str:
    """Algunas rutas del catálogo llevan espacios sin codificar y rompen el
    enlace markdown (p. ej. 'SLIMFOLD CASE 1-3.jpg'). Se re-codifica sólo la
    ruta, respetando los %XX que ya vienen escapados."""
    if not url:
        return ""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(
        parts._replace(path=urllib.parse.quote(parts.path, safe="/%"))
    )


def get(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def all_products() -> dict[str, dict]:
    """SKU (minúsculas) → ficha del proveedor, para sacar el permalink real.
    Construir la URL a mano desde el SKU falla con los que llevan espacios."""
    out: dict[str, dict] = {}
    page = 1
    while True:
        data = get(f"{STORE_API}?per_page=100&page={page}")
        for p in data:
            out[str(p["name"]).strip().lower()] = p
        if len(data) < 100:
            break
        page += 1
        time.sleep(0.2)
    return out


def shape_tagged() -> set[str]:
    """SKUs que el proveedor SÍ clasifica, vía facetas — la prueba de que a los
    demás no les falta por un fallo nuestro."""
    attrs = {a["name"]: a for a in get(f"{STORE_API}/attributes")}
    shape = attrs.get("Shape")
    if not shape:
        return set()
    tagged: set[str] = set()
    for term in get(f"{STORE_API}/attributes/{shape['id']}/terms"):
        page = 1
        while True:
            data = get(
                f"{STORE_API}?attributes[0][attribute]={shape['taxonomy']}"
                f"&attributes[0][slug]={term['slug']}&per_page=100&page={page}"
            )
            for p in data:
                tagged.add(str(p["name"]).strip().lower())
            if len(data) < 100:
                break
            page += 1
            time.sleep(0.2)
    return tagged


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    print("Leyendo catálogo del proveedor…", file=sys.stderr)
    supplier = all_products()
    tagged = shape_tagged()
    print(f"  {len(supplier)} fichas · {len(tagged)} con forma clasificada", file=sys.stderr)

    raw = json.loads(CATALOG.read_text(encoding="utf-8"))
    products = raw if isinstance(raw, list) else raw.get("products", [])
    missing = [p for p in products if not (p.get("attributes") or {}).get("shape")]

    rows = []
    causes = Counter()
    for p in missing:
        a = p.get("attributes") or {}
        key = str(p.get("sku", "")).strip().lower()
        info = supplier.get(key, {})

        # Sin calibre no es una montura: son estuches, lectores, fit-overs y
        # gafas de seguridad. A esos no les falta la forma — no aplican.
        if not a.get("eye_size"):
            cause = "No es montura"
        elif key in tagged:
            # No debería ocurrir: significaría que el proveedor sí lo clasifica
            # y lo estamos perdiendo al sincronizar.
            cause = "REVISAR: el proveedor sí lo clasifica"
        else:
            cause = "Sin clasificar en origen"
        causes[cause] += 1

        rows.append({
            "sku": p.get("sku", ""),
            "name": p.get("name", ""),
            "brand": p.get("brand", ""),
            "cause": cause,
            "url": safe_url(info.get("permalink", "")),
            "image": safe_url((p.get("colors") or [{}])[0].get("image", "")),
            "eye": a.get("eye_size", "—"),
            "bridge": a.get("bridge_size", "—"),
            "style": a.get("style", "—"),
            "b": a.get("b_measurement", "—"),
        })

    rows.sort(key=lambda r: (r["cause"], r["brand"], r["sku"]))

    lines: list[str] = []
    w = lines.append
    w("# Try-on · SKUs sin `shape`")
    w("")
    w(f"**{len(missing)} de {len(products)} productos** ({len(missing)/len(products)*100:.0f}%) "
      "no tienen el atributo `shape`, que es lo que decide la silueta de la lente")
    w("en el probador 3D ([frameGeometry.js](../apps/capri-storefront/src/components/tryon/frameGeometry.js)).")
    w("Sin él, todos caen en la misma silueta genérica `DEFAULT_SHAPE`.")
    w("")
    w("> Generado por `apps/scraper/scripts/report_missing_shape.py`. Vuelve a")
    w("> ejecutarlo cuando cambie el catálogo.")
    w("")
    w("## Por qué falta")
    w("")
    w("**No es un fallo de extracción.** El proveedor sólo clasifica la forma de")
    w(f"{len(tagged)} de sus {len(supplier)} productos: las facetas de `pa_shape` suman")
    w("exactamente esa cifra, y ninguno de los de abajo aparece en ninguna de ellas.")
    w("El dato no existe en origen, así que no hay nada que volver a scrapear.")
    w("")
    w("## Cómo comprobarlo")
    w("")
    w("Abre la ficha del producto de la tabla y busca la tabla de atributos: no hay")
    w("fila `Shape`. Para verlo en crudo, pega esto en el navegador cambiando el SKU:")
    w("")
    w("```")
    w("https://caprioptics.com/wp-json/wc/store/v1/products?search=DC248")
    w("```")
    w("")
    w("En `attributes` verás `Eye size`, `Bridge size`, `Material`… y ningún `Shape`.")
    w("Compáralo con un SKU que sí lo tenga para ver la diferencia.")
    w("")
    w("## Resumen por causa")
    w("")
    w("| Causa | SKUs | Qué hacer |")
    w("|---|---:|---|")
    for cause, n in causes.most_common():
        action = {
            "No es montura": "**Excluir del probador** — estuches, lectores, fit-overs y gafas de seguridad",
            "Sin clasificar en origen": "Clasificar a ojo con la foto, o con el clasificador visual",
            "REVISAR: el proveedor sí lo clasifica": "Bug de sincronización — revisar `sync.py`",
        }.get(cause, "")
        w(f"| {cause} | {n} | {action} |")
    w("")

    for cause, _ in causes.most_common():
        group = [r for r in rows if r["cause"] == cause]
        w(f"## {cause} ({len(group)})")
        w("")
        w("| SKU | Nombre | Marca | Calibre | Puente | Style | B | Ficha | Foto |")
        w("|---|---|---|---|---|---|---|---|---|")
        for r in group:
            ficha = f"[ver]({r['url']})" if r["url"] else "—"
            foto = f"[img]({r['image']})" if r["image"] else "—"
            name = html.escape(str(r["name"]))
            w(f"| `{r['sku']}` | {name} | {r['brand']} | {r['eye']} | {r['bridge']} "
              f"| {r['style']} | {r['b']} | {ficha} | {foto} |")
        w("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Escrito {OUT}")
    for cause, n in causes.most_common():
        print(f"   {cause:40s} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
