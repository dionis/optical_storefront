# Plan de Agentes — Backend e integración (Óptica El Rancho)

Reparto del trabajo del backend en **agentes especializados**. Para cada uno: su **rol**, el
**entorno** donde trabaja, **qué se espera** (entregables concretos) y **de qué depende**. Están
pensados para ejecutarse en el orden de las dependencias; varios pueden ir en paralelo.

> Regla de trabajo de todos los agentes: **primero leer lo que ya existe en local** (el repo, el
> frontend, estas notas) y **solo después complementar** con lo que falte. No romper el backend de
> Dionis ni el frontend ya entregado; trabajar por ramas y PRs pequeños.

---

## Agente 1 — Arquitecto de Backend
- **Rol:** define el modelo de datos y los contratos de API de todo el sistema.
- **Entorno:** repo backend (`apps/backend`, Medusa v2 / Node) + estas notas.
- **Qué se espera:**
  - Esquema de datos: **usuarios, sesiones, favoritos, pedidos, líneas de pedido, reseñas,
    precios/overrides, estados de envío, eventos de analítica**.
  - Especificación de endpoints (OpenAPI) con entradas/salidas en JSON.
  - Documento corto de decisiones (qué se guarda dónde y por qué).
- **Depende de:** nada. **Bloquea a:** todos los demás.

## Agente 2 — Autenticación y Seguridad
- **Rol:** registro, login, sesión, recuperación de contraseña, 2FA y roles (cliente vs admin).
- **Entorno:** módulo de auth del backend.
- **Qué se espera:**
  - Endpoints: registro, login, logout, refresco de sesión, reset de contraseña.
  - **2FA (TOTP)** con endpoint de verificación (para conectar `VITE_ADMIN_2FA_URL`).
  - Rol **administrador** que protege ventas y precios.
- **Depende de:** Agente 1.

## Agente 3 — Comercio (Pedidos, Favoritos, Reseñas)
- **Rol:** persistencia y lógica de las acciones del cliente.
- **Entorno:** backend (módulos de pedidos/clientes) + BD.
- **Qué se espera:**
  - Favoritos por usuario (añadir/quitar/listar).
  - Pedidos: crear al finalizar compra, listar por cliente, ver detalle.
  - Reseñas: crear, listar por cliente, **editar y borrar** las propias.
- **Depende de:** Agentes 1 y 2.

## Agente 4 — Precios y Catálogo
- **Rol:** guardar los precios que edita el dueño y exponer el catálogo con esos precios.
- **Entorno:** backend + el servicio de catálogo ya existente (`sync-catalog.mjs`).
- **Qué se espera:**
  - Guardar/leer overrides de precio (marcos, materiales, tratamientos, uso, envío, accesorios).
  - Que el catálogo publicado incluya el precio final vigente.
- **Depende de:** Agentes 1 y 2 (solo el admin cambia precios).

## Agente 5 — Seguimiento de Envíos
- **Rol:** estados de pedido y (opcional) integración con transportista.
- **Entorno:** backend + webhook/API del transportista.
- **Qué se espera:**
  - Actualizar estado del pedido (preparación → enviado → en camino → entregado) y número de guía.
  - Endpoint para que el cliente consulte el seguimiento.
- **Depende de:** Agente 3 (pedidos).

## Agente 6 — Analítica
- **Rol:** recibir eventos de uso y calcular las métricas del panel.
- **Entorno:** backend/analítica.
- **Qué se espera:**
  - Ingesta de eventos: acceso, vista de producto, añadir al carrito, compra.
  - Agregaciones por rango de tiempo (para KPIs, embudo, top productos/marcas).
- **Depende de:** Agente 1.

## Agente 7 — Integración Frontend
- **Rol:** conectar el frontend ya entregado a los endpoints reales y **quitar el modo demo**.
- **Entorno:** `apps/capri-storefront` (rama `frontend`).
- **Qué se espera:**
  - Cablear los “seams” (ver apéndice de `TAREAS-BACKEND-DIONIS.md`): auth, favoritos, pedidos,
    reseñas, precios, analítica, seguimiento.
  - Quitar datos demo y banderas de demostración.
  - Mantener todo responsive y bilingüe.
- **Depende de:** Agentes 2–6 (según la función que conecte).

## Agente 8 — QA y Seguridad
- **Rol:** pruebas de punta a punta y revisión de seguridad antes de producción.
- **Entorno:** todo el sistema (frontend + backend).
- **Qué se espera:**
  - Pruebas de los flujos: registro/login/2FA, compra, favoritos, reseñas, seguimiento, precios.
  - Revisión de seguridad (contraseñas, sesiones, permisos admin, datos personales).
  - Checklist de despliegue.
- **Depende de:** Agente 7.

---

## Cómo encajan (resumen)
1. **Agente 1** define todo. →
2. **Agentes 2, 6** (auth y analítica) pueden arrancar en paralelo. →
3. **Agentes 3, 4** (comercio y precios) sobre la base de auth. →
4. **Agente 5** (envíos) sobre pedidos. →
5. **Agente 7** conecta el frontend a medida que cada pieza esté lista. →
6. **Agente 8** valida y prepara el despliegue.
