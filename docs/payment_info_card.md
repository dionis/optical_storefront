## 7. Tarjetas de Prueba para Validación (Square Sandbox)

Para validar el flujo de pago en el entorno de desarrollo (Sandbox) sin realizar transacciones reales, se deben utilizar las tarjetas de prueba oficiales de Square.

### Listado de Tarjetas de Prueba

| Marca de Tarjeta | Número de Tarjeta | Código de Seguridad (CVV) | Código Postal (ZIP) |
| :--- | :--- | :--- | :--- |
| **Visa** | `4111 1111 1111 1111` | `111` | `94103` (o cualquiera válido) |
| **Mastercard** | `5105 1051 0510 5100` | `111` | `94103` (o cualquiera válido) |
| **American Express** | `3400 0000 0000 009` | `1111` | `94103` (o cualquiera válido) |
| **Discover** | `6011 0000 0000 0004` | `111` | `94103` (o cualquiera válido) |

### Parámetros Requeridos para Pruebas:
*   **Fecha de Expiración:** Cualquier combinación de mes y año en el futuro (ej. `12/30`).
*   **Código Postal (ZIP Code):** Requerido en transacciones de prueba de USD, CAD o GBP. Se recomienda usar **`94103`** (código postal oficial de la sede de Square) para evitar rechazos del validador de la API.
*   **Comportamiento esperado:** Al procesar un pago exitoso con estas credenciales, los tickets correspondientes se consolidarán bajo el estado `SOLD` en Supabase y el mapa de Seats.io marcará los asientos como comprados de forma permanente.

## 8. Tarjetas de Prueba para Validación (Stripe Sandbox)

Para validar el flujo de pago con la pasarela **Stripe** en modo de prueba (`pk_test_...` / `sk_test_...`), se deben utilizar las siguientes tarjetas oficiales de Stripe. No se realizan cargos reales.

### Tarjeta Principal (Aprobación Garantizada)

| Campo | Valor |
| :--- | :--- |
| **Número** | `4242 4242 4242 4242` |
| **Fecha de Expiración** | Cualquier fecha futura (ej. `12/34`) |
| **CVC** | Cualquier 3 dígitos (ej. `123`) |
| **ZIP** | Cualquier 5 dígitos (ej. `10001`) |

### Listado Completo de Tarjetas de Prueba

| Marca | Número | Resultado Esperado |
| :--- | :--- | :--- |
| **Visa** | `4242 4242 4242 4242` | Pago aprobado |
| **Visa (debit)** | `4000 0566 5566 5556` | Pago aprobado |
| **Mastercard** | `5555 5555 5555 4444` | Pago aprobado |
| **American Express** | `3714 496353 98431` | Pago aprobado (CVC: `1234`) |
| **Discover** | `6011 1111 1111 1117` | Pago aprobado |
| **Visa** | `4000 0000 0000 0002` | Siempre declinada |
| **Visa** | `4000 0000 0000 9995` | Fondos insuficientes |
| **Visa** | `4000 0025 0000 3155` | Requiere autenticación 3D Secure |
| **Visa** | `4000 0000 0000 3220` | 3D Secure 2 — autenticación requerida |

### Parámetros Requeridos para Pruebas (Stripe):
*   **Fecha de Expiración:** Cualquier mes/año en el futuro (ej. `12/34`).
*   **CVC:** Cualquier número de 3 dígitos para Visa/Mastercard, 4 dígitos para Amex (ej. `1234`).
*   **ZIP:** Cualquier código postal de 5 dígitos (ej. `10001`). No es obligatorio pero puede pedirlo el formulario.
*   **Comportamiento esperado:** Al procesar un pago exitoso, los tickets pasarán a estado `SOLD` en Supabase y los asientos quedarán marcados como comprados en Seats.io.

## 9. Credenciales y Tarjetas de Prueba para Validación (PayPal Sandbox)

Para validar el flujo de pago con la pasarela **PayPal** en modo sandbox (`api-m.sandbox.paypal.com`), existen dos modalidades de prueba: con tarjeta de crédito directa (Expanded Checkout) y con cuenta Personal de sandbox (flujo de aprobación en popup).

### A. Tarjetas de Prueba (pago directo con tarjeta)

Usa cualquiera de estas con fecha futura y cualquier CVV de 3 dígitos:

| Marca | Número de Tarjeta | CVV | Observación |
| :--- | :--- | :--- | :--- |
| **Visa** | `4032034473137613` | `571` | Generada por PayPal |
| **Visa** | `4012888888881881` | Cualquier 3 dígitos | Estática oficial |
| **Mastercard** | `5425233430109903` | Cualquier 3 dígitos | |
| **American Express** | `371449635398431` | `1234` (4 dígitos) | |
| **Diners Club** | `36461510000039` | Cualquier 3 dígitos | |

*   **Fecha de Expiración:** Cualquier mes/año en el futuro (ej. `12/2030`).
*   **Nombre en la tarjeta:** Cualquier nombre (ver sección de rechazo para triggers especiales).
*   **País:** `US`.

### B. Flujo de Aprobación con Cuenta Personal Sandbox (botones PayPal)

Cuando el usuario hace clic en el botón **PayPal** y se abre el popup de aprobación, se debe iniciar sesión con una **cuenta Personal sandbox**. Estas cuentas se gestionan en:

👉 **[developer.paypal.com → Sandbox → Accounts](https://developer.paypal.com/developer/accounts/)**

Al registrarse como desarrollador PayPal, se crean automáticamente dos cuentas sandbox:

| Tipo | Formato del Email | Rol en la Transacción |
| :--- | :--- | :--- |
| **Business** | `sb-XXXX@business.example.com` | Merchant (recibe el pago) |
| **Personal** | `sb-XXXX@personal.example.com` | Comprador (aprueba en el popup) |

Para obtener o cambiar la contraseña de cada cuenta:
1. Ir a **Sandbox → Accounts** en el Developer Dashboard.
2. Hacer clic en el ícono de la cuenta → **View/Edit Account**.
3. En la pestaña **Profile** → **Change password**.

### C. Simular Rechazos y Errores de Tarjeta

Usar la tarjeta Visa `4012 8888 8888 1881` con fecha futura y colocar el trigger en el **campo "Nombre en la tarjeta"**:

| Trigger (en el campo Nombre) | Código | Error Simulado |
| :--- | :--- | :--- |
| `CCREJECT-REFUSED` | `0500` | Tarjeta rechazada (DO_NOT_HONOR) |
| `CCREJECT-IF` | `5120` | Fondos insuficientes |
| `CCREJECT-EC` | `5400` | Tarjeta expirada |
| `CCREJECT-SF` | `9500` | Fraude detectado (no reintentar) |
| `CCREJECT-CVV_F` | `00N7` | Fallo de CVV |
| `CCREJECT-LS` | `9520` | Tarjeta perdida o robada (no reintentar) |
| `CCREJECT-BANK_ERROR` | `5100` | Declinada genérica |
| `CCREJECT-IRC` | `5180` | Tarjeta inválida o restringida (no reintentar) |
