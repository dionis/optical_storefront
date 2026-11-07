# Pacientes — ficha e historial de compras (7-nov-2026)

Pestaña **Pacientes** del panel (`?tab=patients`, grupo Comercial; también en el
menú de supervisor y encargado). Dueño, superadmin, supervisor y encargado; un
vendedor no la ve (403 `forbidden_role`) y sigue con la vista del cliente en la caja.

## Datos

- Compras: `sale_fact` (una fila por línea vendida, POS y web), agrupadas por
  `order_id`. Una venta anulada se lista tachada y **no cuenta** en totales.
- Paciente = cliente de Medusa (`customer`); la caja evita duplicados por correo
  y teléfono (`upsertCustomer`). Datos: nombre, teléfono, correo, nacimiento
  (`metadata.birth_date`), primera dirección (`customer_address`), cuenta online.
- Recetas: `opticalHistory` / `lastPrescription` (`pos-data.ts`), con el cambio
  entre recetas (`optical-change.ts`, umbrales de la configuración del POS).

## Rutas

- `GET /admin/patients?q=&store=&sort=recent|total|purchases|avg&limit=` →
  `{ patients, truncated }`. Con `q` (≥ 2) usa la búsqueda de la caja y muestra
  también a quien no compró (ceros). Supervisor/encargado: solo pacientes que
  compraron en sus tiendas; los números de cada paciente son de todo el negocio.
- `GET /admin/patients/:id` → `{ customer, summary, purchases, last_prescription,
  history, exam }`. Fuera de sus tiendas responde 404 (no revela que existe).
  Cada apertura queda en Auditoría (`patient.view`, sin valores).

- `exam=overdue` = **lista de recordatorio**: pacientes cuya última receta hecha
  aquí (no la que usaba) tiene 12 meses o más; se filtra en el servidor, así que
  incluye a los que compraron hace mucho. Cada fila trae `last_rx_on` y `exam`.

## Desde otras pantallas

- El buscador del panel lleva un resultado de paciente a su ficha (Pacientes)
  para quien puede abrirla; un vendedor sigue yendo a sus ventas.
- Seguridad muestra «Dueño del panel definido (STORE_OWNER_EMAIL)».

## Reglas (`src/lib/patient-history.ts`, `PATIENT_RULES`)

- Promedio = total de compras válidas / número de compras válidas.
- Categoría: Nuevo (1 compra), Recurrente (≥ 2), VIP (≥ 3 compras o ≥ $800).
- Inactivo: 24 meses o más sin comprar.
- Próximo examen: 12 meses después de la fecha de la última receta (o de cuando
  se registró). Vencido si ya pasó.

## Pantalla (`Patients.jsx`, `patients.css`, `i18n/parts/patients.js`)

Lista (buscar, ordenar, filtrar por categoría o «Examen vencido»; total y ticket promedio de la
selección) y ficha en acordeones: datos, historial de compras (por tienda,
abre la hoja de la venta), evolución de la graduación y próximo examen. En
tableta vertical y móvil, una columna con «Volver a la lista». Sin exportación
ni impresión de la ficha (dato de salud).

Pruebas: `apps/backend/tests/patient-history.test.ts`.
