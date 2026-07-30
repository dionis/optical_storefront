# Pendientes y logística — Óptica El Rancho / RUBI_LENS

> Documento de requisitos y roadmap: funciones pendientes de implementar y la
> logística de envíos/tiempos del negocio. Se actualiza cuando Daniel lo pide.
> Última actualización: **2026-07-30** · rama `frontend`.
> Fuente: lista provista por Daniel. Los importes y tiempos son los que él indicó;
> lo marcado como **"por definir"** falta confirmarlo.

---

## 1. Funcionalidades pendientes (frontend / experiencia de compra)

### 1.1 Autocompletado de dirección con Google Maps
- Integrar autocompletado de direcciones en el checkout con **Google Places / Maps Autocomplete API**.
- Objetivo: el cliente empieza a escribir y se autocompleta la dirección → menos errores de envío.
- Requiere **API key de Google** (Places API) + facturación activa en Google Cloud.
- Seguridad: la key debe ir **restringida por dominio**; nunca commitear la key real (va en `.env`).

### 1.2 Infografía de materiales del cristal (adelgazamiento)
- Sección educativa que explique los **índices/materiales** y muestre, con imágenes,
  **cómo va bajando el grueso del cristal** según el material/índice.
- Referencia visual: buscar en **Pinterest** → "lens thickness / índice 1.50 vs 1.61 vs 1.67 vs 1.74".
- Formato sugerido: comparativa visual del grueso del borde + descripción por material.

### 1.3 Fotocromático (explicación visual)
- Sección/infografía que explique los lentes **fotocromáticos** (se oscurecen con el sol).
- Referencia visual: **Pinterest** → "photochromic lenses before/after".

### 1.4 Seguimiento de orden (ambas partes)
- Estado de la orden visible **para el cliente y para la tienda/admin**.
- Estados sugeridos: recibida → en fabricación → enviada (lab→hub) → consolidada → enviada al cliente → entregada.

### 1.5 Notificación de estado al cliente
- Avisar al cliente en cada cambio de estado (email y/o SMS/WhatsApp).
- Depende del backend (Medusa) para disparar los eventos → **coordinar con Dionis**.

### 1.6 Tracking para el cliente
- Mostrar al cliente el **número de rastreo (UPS)** y el enlace de seguimiento cuando exista.

---

## 2. Tiempos de proceso
- **Fabricación de los lentes: 5 días** (antes del envío).

---

## 3. Logística de envíos (costos y tiempos)

**Flujo inferido:** los **lentes** salen del **laboratorio** y los **marcos** de **CAPRI**;
ambos llegan a **Osmany** (punto de consolidación) y desde ahí sale el envío final
(nacional USA o a Cuba). *(Confirmar el flujo con Daniel.)*

| Tramo | Origen → Destino | Servicio | Costo | Tiempo |
|---|---|---|---|---|
| Lentes | Laboratorio → Osmany | UPS Express | **$2.75** | 3 días |
| Marcos | CAPRI → Osmany | UPS Express | **$1.00** | 3 días |
| Nacional USA | (Osmany) → cliente USA | UPS | **$3.00** | 3 días |
| Cuba | (Osmany) → Cuba (consignataria) | Consignataria | **por definir** | por definir |

**Notas:**
- Costo y tiempo del **envío a Cuba (consignataria)**: **pendientes de definir**.
- Confirmar si el costo al cliente es la **suma de tramos** o una **tarifa fija**.
- "Osmany" se toma como **hub de consolidación**; confirmar el rol exacto.

---

## 4. Preguntas abiertas / por confirmar
- API key de Google Maps: quién la provee y presupuesto.
- Canal de notificaciones: ¿email, SMS o WhatsApp? (impacta backend y costos).
- Tarifa y tiempo de la consignataria a Cuba.
- Tracking: ¿se toma automático de la **API de UPS** o se pega manual en el admin?
