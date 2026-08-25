# 3D samples — 7 armazones reales, todas sus fotos

Dataset de prueba para generar assets 3D en otro proyecto. Siete armazones reales
del catálogo del proveedor, cada uno con **todas las fotos que el proveedor
publica** y **un JSON con todas sus características**.

```
3d-samples/
├── index.json                    # manifiesto + convenciones de ejes/unidades
├── frames/<id>.json              # 7 descriptores completos
├── images/<id>/<color>.jpg       # 18 fotos originales, agrupadas por modelo
└── build-samples.mjs             # generador (re-ejecutable, para añadir más modelos)
```

## Cuántas fotos hay por modelo, y de qué

**Una por color.** Es todo lo que existe: 18 fotos para estos 7 modelos.

| id | SKU | fotos | colores |
|----|-----|-------|---------|
| `dc384` | DC384 | 3 | Black / Crystal / Light Brown |
| `up327` | UP 327 | 3 | Black Tan / Blue Burgundy / Burgundy Black |
| `dc186` | DC186 | 3 | Black Gold / Crystal Blue / Crystal Gold |
| `pt98` | PT 98 | 2 | Gold / Gunmetal |
| `fx114` | FX114 | 3 | Black / Blue / Gunmetal |
| `sl906` | SL906 | 1 | Gold Black |
| `dc391` | DC391 | 3 | Black Gold / Gold / Gunmetal |

Dos cosas que conviene saber antes de planificar la reconstrucción, comprobadas
abriendo las 18 imágenes una por una:

- **Varias fotos no son varios ángulos.** Las 18 están tomadas desde el mismo 3/4 (≈ −35° de guiñada, ≈ 15° de cabeceo, varillas abiertas). Cambia el color, no el punto de vista: no hay paralaje y por tanto no hay fotogrametría clásica. Sirven como referencias de textura y acabado sobre una misma geometría.
- **`sl906` es la excepción**: su único JPEG contiene **dos tomas apiladas** — 3/4 arriba y casi frontal abajo. Hay que partirlo antes de meterlo en un pipeline de vista única; la inferior es la buena para medir proporciones.

En la web del proveedor cada producto muestra más URLs de imagen
(`-300x123`, `-1024x419`, `-2048x838`…), pero son **recortes de WordPress del
mismo disparo**. El generador los descarta a propósito: añaden píxeles, nunca un
ángulo nuevo.

## Los 7 y por qué esos

La selección cubre los tipos de construcción que un pipeline 3D tiene que
resolver de forma distinta — no son siete rectángulos de acetato.

| id | Marca | Forma | Montaje | Materiales |
|----|-------|-------|---------|------------|
| `dc384` | Di Caprio | rectangle | full rim | acetato grueso |
| `up327` | Four You | cat eye | full rim | plástico inyectado, dos tonos |
| `dc186` | Di Caprio | round | full rim | frente acetato + varillas metal |
| `pt98` | Peachtree | aviator | full rim | alambre metálico + barra superior |
| `fx114` | Flexure | square | semi rimless | metal arriba + hilo de nailon abajo |
| `sl906` | Simplylite | modified round | 3-piece rimless | titanio, lentes taladradas |
| `dc391` | Di Caprio | square (navigator) | full rim | metal + varillas de plástico |

## Qué hay en cada JSON

- `catalog_attributes_raw` — tal cual viene del catálogo del proveedor, en español, sin tocar.
- `classification` — lo mismo normalizado a inglés (`lens_shape`, `rim_type`, `materials`, `gender`).
- `measurements_mm` — calibre, puente, varilla y altura de lente parseados a `{min, max, nominal}`, más `derived_total_front_width`.
- `observed_construction` — aro, puente, plaquetas, bisagra y marcas, leídos de las fotos. Describe el armazón, así que vale para todos sus colores.
- `geometry_hints_3d` — grosores, curva base, inclinación pantoscópica, tipo de bisagra y de plaquetas.
- `reference_images` — **todas** las fotos del modelo: archivo, color, tamaño, relación de aspecto, y `view_layout` con cuántas tomas contiene el JPEG y si eso está **verificado a ojo** (`verified: true`) o deducido de la relación de aspecto.
- `limitations` — lo que este dataset **no** puede darte.

### Los cuatro niveles de confianza

Cada bloque dice de dónde sale. No los mezcles:

| nivel | significado |
|-------|-------------|
| `supplier_published` | copiado del catálogo del proveedor |
| `observed_in_photos` | leído a ojo de las fotos de referencia |
| `estimated` | calculado con una fórmula que va escrita en el propio campo |
| `heuristic` | valor típico de ese tipo de construcción, **no medido** — punto de partida, nunca especificación |

Los grosores de aro, la curva base y la inclinación de `geometry_hints_3d` son
todos `heuristic`: salen de cómo se construye habitualmente un armazón de ese
material, no de haber medido este.

## Límites que conviene saber antes de empezar

- **Sin baseline multivista** (ver arriba): un solo ángulo para todo el conjunto.
- **Sin calibración de cámara** y con vista en perspectiva: no se pueden convertir píxeles a milímetros. Escala el modelo terminado con `measurements_mm`.
- **La talla publicada es un rango**, no la del ejemplar fotografiado: un mismo número de modelo cubre varias tallas. `nominal` es el objetivo, el rango es la tolerancia.
- **La parte trasera nunca se ve**: interior de varillas, cara posterior del frente y bisagra por dentro hay que inventarlos.
- **`fx114` y `sl906` no tienen silueta cerrada sin la lente** — en semi-al-aire y al-aire el borde visible es el de la lente, así que la lente es parte del asset.

## Regenerar o ampliar

```bash
node 3d-samples/build-samples.mjs
```

Lee `apps/capri-storefront/public/catalog.json` (550 armazones, 1440 fotos en
total) y no vuelve a descargar lo que ya está en `images/`. Para añadir modelos,
mete otra entrada en `SELECTION` con el SKU y lo observado en su foto; si no
añades el modelo a `VERIFIED`, sus imágenes salen con
`view_layout.verified: false` y el reparto de tomas deducido de la relación de
aspecto — una pista revisable, no una afirmación.

## Derechos

Las fotos son del proveedor (caprioptics.com). Prototipado interno; no están
autorizadas para redistribución.
