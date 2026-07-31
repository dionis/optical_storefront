#!/usr/bin/env python
"""
Añade `style` y `b_measurement` al catálogo estático, SIN volver a scrapear.

El proveedor publica dos atributos que el sync actual no guarda y que son
geometría pura para el probador 3D:

  · B Measurement — alto real de la lente. Hoy el generador lo ADIVINA con una
    fracción del calibre (`SHAPES[...].h` en frameGeometry.js).
  · Style — construcción del aro. 41 SKUs son Semi Rimless o 3-Piece Rimless y
    el generador les dibuja un aro completo que no existe: no están mal
    calibrados, están estructuralmente mal.

La clave para no re-descargar el catálogo entero: la Store API permite filtrar
por atributo, y cada consulta devuelve los productos que llevan ese término. Con
6 términos de Style y 5 de B Measurement se mapean los 550 productos en ~20
peticiones, en vez de recorrer 550 fichas.

    python scripts/backfill_geometry_attrs.py            # muestra qué cambiaría
    python scripts/backfill_geometry_attrs.py --write    # aplica al catálogo

Esto arregla el catálogo que ya existe. Para que los sync futuros lo traigan
solos, `scraper/sync.py` debería llamar a `facet_map()` con las mismas dos
taxonomías — es el mismo puñado de peticiones.
"""

from __future__ import annotations

import argparse
import html
import json
import shutil
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG = HERE.parent.parent / "capri-storefront" / "public" / "catalog.json"
STORE_API = "https://caprioptics.com/wp-json/wc/store/v1/products"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"}

# Nombre del atributo en el proveedor → clave con la que se guarda en el catálogo.
WANTED = {
    "Style": "style",
    "B Measurement": "b_measurement",
}


def get(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def facet_map(attribute: dict) -> dict[str, str]:
    """SKU (minúsculas) → valor del término, recorriendo las facetas del atributo.

    Barato por diseño: una consulta por término, no por producto.
    """
    taxonomy = attribute["taxonomy"]
    terms = get(f"{STORE_API}/attributes/{attribute['id']}/terms")
    out: dict[str, str] = {}
    for term in terms:
        page = 1
        while True:
            data = get(
                f"{STORE_API}?attributes[0][attribute]={taxonomy}"
                f"&attributes[0][slug]={term['slug']}&per_page=100&page={page}"
            )
            for product in data:
                # Los nombres de término vienen con entidades HTML ("&lt;21 mm").
                out[str(product["name"]).strip().lower()] = html.unescape(term["name"])
            if len(data) < 100:
                break
            page += 1
            time.sleep(0.2)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="aplica los cambios (por defecto sólo informa)")
    args = ap.parse_args()

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    print("Leyendo facetas del proveedor…", file=sys.stderr)
    attrs = {a["name"]: a for a in get(f"{STORE_API}/attributes")}
    maps: dict[str, dict[str, str]] = {}
    for supplier_name, field in WANTED.items():
        if supplier_name not in attrs:
            print(f"  AVISO: el proveedor ya no publica '{supplier_name}'", file=sys.stderr)
            continue
        maps[field] = facet_map(attrs[supplier_name])
        print(f"  {supplier_name:16s} → {len(maps[field])} SKUs", file=sys.stderr)

    raw = json.loads(CATALOG.read_text(encoding="utf-8"))
    products = raw if isinstance(raw, list) else raw.get("products", [])

    added = Counter()
    changed = Counter()
    values = {field: Counter() for field in maps}

    for product in products:
        key = str(product.get("sku", "")).strip().lower()
        attributes = product.setdefault("attributes", {})
        for field, mapping in maps.items():
            value = mapping.get(key)
            if value is None:
                continue
            values[field][value] += 1
            if field not in attributes:
                added[field] += 1
            elif attributes[field] != value:
                changed[field] += 1
            attributes[field] = value

    bar = "=" * 68
    print(bar)
    print("  BACKFILL DE ATRIBUTOS GEOMÉTRICOS")
    print(bar)
    print(f"  catálogo: {len(products)} productos")
    for field in maps:
        n = sum(values[field].values())
        print(f"    {field:16s} añadido a {n} ({n / len(products) * 100:.0f}%)"
              f"   nuevos={added[field]} modificados={changed[field]}")
    print()

    for field in maps:
        print("-" * 68)
        print(f"  Valores de {field}")
        print("-" * 68)
        for value, n in values[field].most_common():
            print(f"    {value:24s} {n:4d}")
        print()

    rimless = sum(n for v, n in values.get("style", Counter()).items() if "Rimless" in v)
    if rimless:
        print("-" * 68)
        print(f"  {rimless} SKUs sin aro completo — hoy el generador 3D les dibuja")
        print("  un marco que no existe. Capturar el dato no lo arregla solo:")
        print("  hace falta la variante de aro en frameGeometry.js.")
        print("-" * 68)
        print()

    if not args.write:
        print("  (simulacro — nada escrito. Usa --write para aplicar.)")
        print(bar)
        return 0

    backup = CATALOG.with_suffix(".json.bak")
    shutil.copy2(CATALOG, backup)
    CATALOG.write_text(
        json.dumps(raw, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"  Escrito {CATALOG}")
    print(f"  Copia de seguridad en {backup.name}")
    print(bar)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
