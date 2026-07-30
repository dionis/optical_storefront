#!/usr/bin/env python
"""
Mide la precisión de un clasificador visual de forma de armazón.

Por qué existe: 86 de los 550 SKUs del catálogo no tienen `shape`, y el
proveedor tampoco lo publica para ellos (sus facetas pa_shape suman exactamente
los 464 que sí lo tienen). No hay nada que scrapear, así que la forma hay que
inferirla o clasificarla a mano.

Antes de invertir en el clasificador, este script mide si vale la pena — y puede
hacerlo con rigor poco habitual: **los 464 productos que el proveedor sí etiqueta
son un conjunto de validación con verdad conocida**. Se toma una muestra
estratificada, se clasifica con Claude a partir de la foto, y se compara.

Salida: precisión global, por clase, por nivel de confianza declarado, los pares
que más se confunden, y el coste real en tokens.

    export ANTHROPIC_API_KEY=sk-ant-...
    python scripts/measure_shape_classifier.py --per-class 8 --effort medium

El desglose por confianza es el dato que decide la estrategia: si las
predicciones de confianza alta son muy precisas, se pueden aplicar en automático
y mandar a revisión humana sólo el resto.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRAPER_ROOT = HERE.parent
CATALOG = SCRAPER_ROOT.parent / "capri-storefront" / "public" / "catalog.json"
TRUTH_CACHE = HERE / ".shape_truth.json"
ENV_FILE = SCRAPER_ROOT / ".env"

STORE_API = "https://caprioptics.com/wp-json/wc/store/v1/products"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"}

# Los 11 términos del atributo pa_shape del proveedor, con su nombre en el
# catálogo. El slug es la etiqueta que pedimos al modelo.
SHAPES = {
    "aviator": "Aviador",
    "cat-eye": "Ojo de gato",
    "geometric": "Geométrico",
    "modified-oval": "Óvalo modificado",
    "modified-round": "Ronda modificada",
    "navigator": "Navegador",
    "oval": "Oval",
    "rectangle": "Rectángulo",
    "round": "Redondo",
    "shield": "Shield",
    "square": "Cuadrado",
}

SYSTEM_PROMPT = """You classify eyeglass frame shapes for an optical catalog.

You will see one product photo of an eyeglass frame, shot at a 3/4 angle on a \
white background. Classify the shape of the LENS RIMS (the front of the frame), \
ignoring the temple arms and the camera angle.

Use exactly one of these labels:
- aviator: teardrop lenses, wider at top, double bridge, typically metal
- cat-eye: outer top corners swept upward
- geometric: angular non-standard polygon (hexagonal, octagonal)
- modified-oval: oval softened with flatter top or bottom
- modified-round: round softened toward a squarer outline
- navigator: squared aviator silhouette, flat top, tapered bottom
- oval: clean ellipse, clearly wider than tall
- rectangle: straight top and bottom, clearly wider than tall, sharp-ish corners
- round: circular or near-circular
- shield: single continuous wraparound lens
- square: roughly equal width and height, four distinct corners

Judge the true geometry of the frame, not the perspective distortion. Report \
"low" confidence when two labels are genuinely close (rectangle vs square, \
round vs modified-round are the usual pairs)."""

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "shape": {"type": "string", "enum": list(SHAPES)},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "runner_up": {"type": "string", "enum": list(SHAPES)},
    },
    "required": ["shape", "confidence", "runner_up"],
    "additionalProperties": False,
}

# Gemini rechaza `additionalProperties`, que no está en su subconjunto de JSON
# Schema. El resto de la forma es idéntico.
GEMINI_SCHEMA = {k: v for k, v in RESULT_SCHEMA.items() if k != "additionalProperties"}

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_DEFAULT_MODEL = "gemini-3.6-flash"


def load_env_file(path: Path) -> int:
    """Vuelca `KEY=VALUE` de un .env al entorno del proceso.

    El scraper NO carga .env por su cuenta — `scraper/config.py` lee `os.getenv`
    directamente y `python-dotenv` no es dependencia del proyecto; el entorno
    real llega por el shell o por `env_file` de docker-compose. Como el .env del
    scraper existe y es el sitio donde uno espera poner la clave, lo leemos aquí
    con un parser mínimo en vez de sumar una dependencia.

    Las variables ya presentes en el entorno GANAN sobre el fichero, que es la
    semántica habitual de dotenv: exportar en la shell debe poder pisar el .env.
    """
    if not path.exists():
        return 0
    loaded = 0
    # utf-8-sig: algunos editores de Windows dejan BOM, y con él la primera
    # clave del fichero saldría con un carácter invisible delante.
    for raw in path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        line = raw.strip().lstrip("﻿")
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        # .rstrip() se come el \r de los finales de línea CRLF de Windows, que
        # si no viaja dentro del valor y la API rechaza la cabecera.
        value = value.strip().rstrip("\r")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value
            loaded += 1
    return loaded


def http_json(url: str) -> tuple[dict | list, dict]:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "ignore")), dict(r.headers)


def build_truth() -> dict[str, str]:
    """SKU (minúsculas) → slug de forma, desde las facetas pa_shape del proveedor."""
    if TRUTH_CACHE.exists():
        return json.loads(TRUTH_CACHE.read_text(encoding="utf-8"))

    truth: dict[str, str] = {}
    for slug in SHAPES:
        page = 1
        while True:
            url = (
                f"{STORE_API}?attributes[0][attribute]=pa_shape"
                f"&attributes[0][slug]={slug}&per_page=100&page={page}"
            )
            data, _ = http_json(url)
            for product in data:
                truth[str(product["name"]).strip().lower()] = slug
            if len(data) < 100:
                break
            page += 1
            time.sleep(0.3)
        print(f"  {slug:16s} {sum(1 for v in truth.values() if v == slug):4d}", file=sys.stderr)

    TRUTH_CACHE.write_text(json.dumps(truth, indent=0), encoding="utf-8")
    return truth


def fetch_image(url: str, max_edge: int) -> tuple[str, str]:
    """Descarga y reduce la foto. Para clasificar forma no hace falta full-res, y
    reducir recorta mucho el coste en tokens de imagen."""
    from PIL import Image

    # Algunas URLs del catálogo traen espacios literales sin codificar y urllib
    # las rechaza con "URL can't contain control characters". Re-codificamos sólo
    # la ruta, dejando intactos los %XX que ya vienen escapados.
    parts = urllib.parse.urlsplit(url)
    url = urllib.parse.urlunsplit(
        parts._replace(path=urllib.parse.quote(parts.path, safe="/%"))
    )

    # El CDN del proveedor corta alguna conexión suelta bajo carga
    # (RemoteDisconnected). Reintentar dos veces basta y evita perder muestras
    # por un fallo de red que no tiene nada que ver con la clasificación.
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))

    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if max(img.size) > max_edge:
        scale = max_edge / max(img.size)
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.standard_b64encode(buf.getvalue()).decode("ascii"), "image/jpeg"


def gemini_key() -> str:
    return (
        os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_API_KEY", "")
    ).strip()


def gemini_list_models() -> list[str]:
    """Modelos disponibles para la clave. Los IDs de Gemini cambian a menudo, así
    que conviene descubrirlos en vez de fiarse de una constante."""
    import httpx

    r = httpx.get(
        f"{GEMINI_BASE}/models",
        headers={"x-goog-api-key": gemini_key()},
        timeout=30,
    )
    r.raise_for_status()
    out = []
    for m in r.json().get("models", []):
        if "generateContent" in m.get("supportedGenerationMethods", []):
            out.append(m["name"].removeprefix("models/"))
    return sorted(out)


def classify_gemini(image_b64: str, media_type: str, model: str) -> tuple[dict, dict]:
    """Clasifica vía REST. No usamos el SDK google-genai para no sumar una
    dependencia: httpx ya es dependencia del scraper."""
    import httpx

    body = {
        # Las instrucciones van en el propio turno en vez de en
        # `systemInstruction`: para una clasificación de un solo turno da igual,
        # y evita depender de un campo que no verifiqué contra la doc actual.
        "contents": [
            {
                "parts": [
                    {"inline_data": {"mime_type": media_type, "data": image_b64}},
                    {"text": SYSTEM_PROMPT + "\n\nClassify this frame's shape."},
                ]
            }
        ],
        "generationConfig": {
            "responseFormat": {
                "text": {"mimeType": "application/json", "schema": GEMINI_SCHEMA}
            }
        },
    }
    r = httpx.post(
        f"{GEMINI_BASE}/models/{model}:generateContent",
        headers={"x-goog-api-key": gemini_key(), "Content-Type": "application/json"},
        json=body,
        timeout=120,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()

    candidates = data.get("candidates") or []
    if not candidates:
        # Bloqueo por filtros de seguridad: no hay candidato que leer.
        raise RuntimeError(f"sin candidatos: {json.dumps(data.get('promptFeedback', {}))[:200]}")
    parts = candidates[0].get("content", {}).get("parts") or []
    text = next((p["text"] for p in parts if "text" in p), "")
    if not text:
        raise RuntimeError(f"respuesta sin texto (finishReason={candidates[0].get('finishReason')})")

    meta = data.get("usageMetadata", {})
    usage = {
        "input": meta.get("promptTokenCount", 0),
        "output": meta.get("candidatesTokenCount", 0),
    }
    return json.loads(text), usage


def classify(client, image_b64: str, media_type: str, effort: str) -> tuple[dict, dict]:
    message = client.messages.create(
        model="claude-opus-5",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        output_config={
            "effort": effort,
            "format": {"type": "json_schema", "schema": RESULT_SCHEMA},
        },
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": "Classify this frame's shape."},
                ],
            }
        ],
    )
    # Las clasificaciones rechazadas por los clasificadores de seguridad llegan
    # con stop_reason "refusal" y content vacío: hay que mirarlo antes de indexar.
    if message.stop_reason == "refusal":
        raise RuntimeError("refusal")
    text = next(b.text for b in message.content if b.type == "text")
    usage = {
        "input": message.usage.input_tokens,
        "output": message.usage.output_tokens,
    }
    return json.loads(text), usage


def main() -> int:
    # El .env se lee ANTES de construir el parser: así LLM_PROVIDER y LLM_MODEL
    # pueden actuar como valores por defecto de los flags, y quien ya configuró
    # el proveedor en el .env no tiene que repetirlo en la línea de comandos.
    load_env_file(ENV_FILE)
    env_provider = os.environ.get("LLM_PROVIDER", "").strip().lower()
    if env_provider not in ("anthropic", "gemini"):
        env_provider = "anthropic"
    env_model = os.environ.get("LLM_MODEL", "").strip() or GEMINI_DEFAULT_MODEL

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--per-class", type=int, default=8, help="muestras por forma (def. 8)")
    ap.add_argument(
        "--provider", default=env_provider, choices=["anthropic", "gemini"],
        help=f"qué modelo mide; por defecto LLM_PROVIDER del .env (ahora: {env_provider})",
    )
    ap.add_argument("--gemini-model", default=env_model,
                    help=f"por defecto LLM_MODEL del .env (ahora: {env_model})")
    ap.add_argument("--list-models", action="store_true", help="lista los modelos de Gemini y sale")
    ap.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"],
                    help="sólo aplica a --provider anthropic")
    ap.add_argument("--max-edge", type=int, default=800, help="lado mayor de la imagen en px")
    # 2 hilos: con 4 la primera medición perdió 39 de 76 peticiones contra el
    # límite de tasa. Súbelo sólo si tu cuenta tiene margen holgado.
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    # La consola de Windows suele venir en cp1252 y revienta con UnicodeEncodeError
    # al imprimir los caracteres de caja o cualquier acento en un mensaje de error,
    # perdiendo el informe entero a mitad. errors="replace" degrada el carácter
    # en vez de tirar la salida.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    if args.provider == "gemini":
        var_names = ("GEMINI_API_KEY", "GOOGLE_API_KEY")
        key = gemini_key()
    else:
        var_names = ("ANTHROPIC_API_KEY",)
        key = os.environ.get("ANTHROPIC_API_KEY", "").strip()

    if not key:
        joined = " o ".join(var_names)
        print(f"ERROR: --provider {args.provider} necesita {joined}, y no la encuentro.",
              file=sys.stderr)
        print(f"  Buscado en el entorno y en {ENV_FILE}", file=sys.stderr)

        # La confusión más probable: tener configurado un proveedor y pedir el
        # otro. Decirlo directamente ahorra el viaje de ida y vuelta.
        other = "anthropic" if args.provider == "gemini" else "gemini"
        other_key = (
            os.environ.get("ANTHROPIC_API_KEY", "").strip() if other == "anthropic"
            else gemini_key()
        )
        if other_key:
            print(f"  PERO sí tienes clave de {other}. ¿Querías --provider {other}?",
                  file=sys.stderr)
            print(f"  (o pon LLM_PROVIDER={other} en el .env y no hace falta el flag)",
                  file=sys.stderr)
        elif ENV_FILE.exists():
            lines = ENV_FILE.read_text(encoding="utf-8-sig", errors="ignore").splitlines()
            commented = [
                v for v in var_names
                if any(l.strip().startswith("#") and v in l for l in lines)
            ]
            if commented:
                print(f"  El .env tiene {', '.join(commented)} pero COMENTADA — quita la '#'.",
                      file=sys.stderr)
            else:
                print("  El .env existe pero no tiene ninguna de esas variables.", file=sys.stderr)
        else:
            print("  Ese .env no existe. Créalo o exporta la variable en la shell.", file=sys.stderr)
        return 2

    if args.list_models:
        if args.provider != "gemini":
            print("--list-models sólo aplica a --provider gemini", file=sys.stderr)
            return 2
        for name in gemini_list_models():
            print(name)
        return 0

    client = None
    if args.provider == "anthropic":
        import anthropic

        # El SDK sólo reintenta 2 veces por defecto. Con varias peticiones en
        # paralelo eso se agota enseguida contra el límite de tasa y la excepción
        # sube — que fue lo que invalidó la primera medición (39 de 76 perdidas).
        client = anthropic.Anthropic(max_retries=8)

    print("Construyendo verdad de referencia desde el proveedor…", file=sys.stderr)
    truth = build_truth()

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    products = catalog if isinstance(catalog, list) else catalog.get("products", [])

    # Muestra estratificada: hasta N por forma, sobre los que el proveedor etiqueta.
    by_shape: dict[str, list] = defaultdict(list)
    for p in products:
        key = str(p.get("sku", "")).strip().lower()
        if key in truth and p.get("colors"):
            by_shape[truth[key]].append(p)

    rng = random.Random(args.seed)
    sample: list[tuple[dict, str]] = []
    for slug, items in by_shape.items():
        rng.shuffle(items)
        for p in items[: args.per_class]:
            sample.append((p, slug))

    print(f"Muestra: {len(sample)} productos sobre {len(by_shape)} formas\n", file=sys.stderr)

    def run(entry):
        product, expected = entry
        url = product["colors"][0]["image"]
        try:
            b64, mt = fetch_image(url, args.max_edge)
            if args.provider == "gemini":
                result, usage = classify_gemini(b64, mt, args.gemini_model)
            else:
                result, usage = classify(client, b64, mt, args.effort)
            return product["sku"], expected, result, usage, None
        except Exception as exc:  # noqa: BLE001 — una foto rota no debe abortar la medición
            return product["sku"], expected, None, None, f"{type(exc).__name__}: {exc}"

    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, row in enumerate(pool.map(run, sample), 1):
            rows.append(row)
            print(f"\r  {i}/{len(sample)}", end="", file=sys.stderr)
    print("\n", file=sys.stderr)

    ok = err = 0
    per_class = defaultdict(lambda: {"n": 0, "ok": 0, "sent": 0})
    by_conf = defaultdict(lambda: {"n": 0, "ok": 0})
    confusion = Counter()
    errors = Counter()
    error_examples: dict[str, str] = {}
    tokens_in = tokens_out = 0

    for _sku, expected, _r, _u, _e in rows:
        per_class[expected]["sent"] += 1

    for sku, expected, result, usage, error in rows:
        if error:
            err += 1
            kind = error.split(":", 1)[0]
            errors[kind] += 1
            error_examples.setdefault(kind, error)
            continue
        tokens_in += usage["input"]
        tokens_out += usage["output"]
        got, conf = result["shape"], result["confidence"]
        hit = got == expected
        ok += hit
        per_class[expected]["n"] += 1
        per_class[expected]["ok"] += hit
        by_conf[conf]["n"] += 1
        by_conf[conf]["ok"] += hit
        if not hit:
            confusion[(expected, got)] += 1

    total = sum(c["n"] for c in per_class.values())

    # El desglose de errores va ANTES de cualquier salida temprana: si no se
    # clasificó nada, el motivo es justo lo único que importa imprimir.
    if errors:
        print("─" * 68)
        print("  ERRORES  ← por qué se perdieron muestras")
        print("─" * 68)
        for kind, n in errors.most_common():
            print(f"    ×{n:<3d} {kind}")
            print(f"          {error_examples[kind][:400]}")
        print()

    # Saldo agotado es un caso frecuente y con una acción muy concreta: merece
    # su propio mensaje en vez de la lista genérica de causas.
    if any("credit balance is too low" in e for e in error_examples.values()):
        print("═" * 68)
        print("  SIN CRÉDITO EN LA CUENTA DE ANTHROPIC")
        print("═" * 68)
        print("  No es un fallo del script: la API rechaza cada petición por saldo.")
        print("  Recarga en console.anthropic.com → Plans & Billing y vuelve a correrlo.")
        print(f"  Esta muestra ({len(rows)} imágenes) cuesta del orden de $0.55.")
        print("═" * 68)
        return 1

    if not total:
        print("Ninguna clasificación completada. Causas habituales:")
        print("  · límite de tasa o de gasto de la cuenta — mira el error de arriba")
        print("  · clave sin crédito o revocada (authentication_error / permission_error)")
        print("  · sin salida a internet hacia api.anthropic.com")
        print("Prueba con --per-class 1 --workers 1 para aislar el fallo con una sola llamada.")
        return 1

    bar = "═" * 68
    print(bar)
    print("  PRECISIÓN DEL CLASIFICADOR VISUAL DE FORMA")
    print(bar)
    if args.provider == "gemini":
        print(f"  modelo {args.gemini_model} (gemini) · imagen {args.max_edge}px")
    else:
        print(f"  modelo claude-opus-5 · effort={args.effort} · imagen {args.max_edge}px")
    print(f"  enviadas {len(rows)}   clasificadas {total}   fallidas {err}")
    print(f"  PRECISIÓN GLOBAL      {ok}/{total} = {ok / total * 100:.1f}%")

    # Una tasa de fallo alta no reparte por igual: los errores llegan a ráfagas
    # y se llevan clases enteras, así que la precisión queda sesgada, no sólo
    # ruidosa. Mejor gritarlo que dejar que el número se use.
    fail_rate = err / len(rows) if rows else 0
    empty = [s for s in per_class if per_class[s]["n"] == 0]
    if fail_rate > 0.1 or empty:
        print()
        print("  " + "!" * 64)
        print(f"  MEDICIÓN NO FIABLE — falló el {fail_rate * 100:.0f}% de la muestra.")
        if empty:
            print(f"  {len(empty)} formas sin NINGÚN dato: {', '.join(SHAPES[s] for s in empty)}")
        print("  No tomes decisiones con esta precisión. Mira los errores abajo,")
        print("  baja --workers y vuelve a correrlo.")
        print("  " + "!" * 64)
    print()

    print("─" * 68)
    print("  Por forma (verdad del proveedor)")
    print("─" * 68)
    for slug in sorted(per_class, key=lambda s: -per_class[s]["sent"]):
        c = per_class[slug]
        pct = c["ok"] / c["n"] * 100 if c["n"] else 0
        lost = c["sent"] - c["n"]
        flag = "  ← SIN DATOS" if c["n"] == 0 else (f"  ({lost} perdidas)" if lost else "")
        print(f"    {SHAPES[slug]:20s} {c['ok']:2d}/{c['n']:<2d}  {pct:5.1f}%{flag}")
    print()

    print("─" * 68)
    print("  Por confianza declarada  ← decide si se puede auto-aplicar")
    print("─" * 68)
    for conf in ("high", "medium", "low"):
        c = by_conf[conf]
        if not c["n"]:
            continue
        pct = c["ok"] / c["n"] * 100
        print(f"    {conf:8s} {c['ok']:3d}/{c['n']:<3d}  {pct:5.1f}%   ({c['n'] / total * 100:.0f}% de la muestra)")
    print()

    if confusion:
        print("─" * 68)
        print("  Confusiones más frecuentes")
        print("─" * 68)
        for (exp, got), n in confusion.most_common(10):
            print(f"    {SHAPES[exp]:20s} → clasificado {SHAPES[got]:20s} ×{n}")
        print()

    print("─" * 68)
    print(f"  Tokens: {tokens_in:,} entrada · {tokens_out:,} salida")
    if args.provider == "anthropic":
        # Precios de claude-opus-5 por millón de tokens.
        cost = tokens_in / 1e6 * 5.0 + tokens_out / 1e6 * 25.0
        print(f"  Coste de la muestra: ${cost:.3f}   →  86 SKUs ≈ ${cost / total * 86:.2f}")
    else:
        # No fijo precios de Gemini: cambian por modelo y no los verifiqué.
        # Consúltalos en ai.google.dev/pricing y multiplica por los tokens de arriba.
        print(f"  Por muestra: {tokens_in / total:.0f} entrada · {tokens_out / total:.1f} salida")
        print("  Coste: mira ai.google.dev/pricing para este modelo y multiplica.")
    print(bar)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
