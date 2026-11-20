# Autocompletado de direcciones con Google Maps

Al escribir una dirección se proponen direcciones reales de EE. UU. y, al elegir una, se rellena el campo. Funciona en el checkout de la tienda y en el panel: **Tiendas** (alta y edición), **perfil de la persona**, **ficha de vendedor** y **cliente de una venta** en el punto de venta.

La clave vive solo en el storefront (`VITE_GOOGLE_MAPS_KEY`): se compila en el navegador, así que su protección es la restricción por dominio, no el secreto. El backend no la usa.

## Habilitarlo

1. **Proyecto y facturación.** En [Google Cloud Console](https://console.cloud.google.com/), crea o elige un proyecto y asócialo a una cuenta de facturación. Sin ella, Google rechaza las llamadas.
2. **Activar dos API** (APIs y servicios → Biblioteca):
   - **Maps JavaScript API**
   - **Places API (New)**: la nueva, no la «Places API» a secas.
3. **Crear la clave** (APIs y servicios → Credenciales → Crear credenciales → Clave de API).
4. **Restringir la clave** (obligatorio: sin restricción, cualquiera podría usarla a tu cargo).
   - *Restricciones de aplicaciones* → **Sitios web**, con los dominios desde los que se usa el panel y la tienda:
     - `https://www.rubilens.com/*`
     - `https://rubilens.com/*`
     - el dominio de la preview de la rama de staging en Vercel, por ejemplo `https://<proyecto>-git-develop-optical-storepos-<equipo>.vercel.app/*`
     - `http://localhost:5198/*` solo si también se usa en desarrollo
   - *Restricciones de API* → **Restringir clave**, dejando solo Maps JavaScript API y Places API (New).
5. **Poner un tope de gasto.** En Facturación → Presupuestos y alertas, crea un presupuesto con avisos. En APIs y servicios → Places API (New) → Cuotas puedes limitar las peticiones por día.
6. **Cargar la clave en Vercel.** Proyecto → Settings → Environment Variables: `VITE_GOOGLE_MAPS_KEY` = la clave, en los entornos que la usen (Preview incluye la rama de staging y `www.rubilens.com`, que es un dominio de rama).
7. **Volver a desplegar.** Las variables `VITE_*` se fijan al compilar: sin un despliegue nuevo la clave no llega al navegador.
8. **Comprobar.** Abre Tiendas → Añadir una tienda y escribe al menos 3 letras de una dirección. Al pie del desplegable debe decir **Google Maps**.

## Por código postal

En el punto de venta y en el checkout, al escribir el ZIP completo se rellenan ciudad y estado sin tocar la calle. Si Google da varias opciones, se elige en el desplegable. En Tiendas, en el perfil y en la ficha de vendedor, escribir el ZIP en el campo de dirección también propone la zona.

Un ZIP puede abarcar varias ciudades: Google propone una y se puede corregir a mano. Con OpenStreetMap solo se rellena el estado, porque suele no conocer la ciudad o da la de al lado.

## Si algo falla

| Al pie del desplegable | Significa |
|---|---|
| `Google Maps` | Funciona con Google |
| `© OpenStreetMap` | No hay clave, o Google la rechazó: se usa el respaldo abierto |
| No aparece desplegable | Menos de 3 letras (4 con OpenStreetMap) o sin resultados; el campo sigue admitiendo escribir a mano |

Si sale `© OpenStreetMap` con la clave ya puesta, abre la consola del navegador (F12): aparece `[address] Google Places unavailable…` con el motivo, junto al error de Google (`RefererNotAllowedMapError` = falta el dominio en el paso 4, `ApiNotActivatedMapError` = falta una API del paso 2). OpenStreetMap solo propone direcciones con calle: si escribes solo una ciudad no sugiere nada.

## Qué tener en cuenta

- **Coste:** se paga por uso, con precios en la página de Google Maps Platform. Las sugerencias se agrupan en una sesión por dirección elegida (`AutocompleteSessionToken`), en lugar de cobrar cada pulsación.
- **Atribución:** Google exige identificar la fuente cuando las sugerencias se muestran sin mapa. Por eso el desplegable lleva «Google Maps»; no se debe quitar ni traducir.
- **Solo EE. UU.:** las búsquedas se limitan a direcciones de EE. UU. (`includedRegionCodes` en `src/data/addressAutocomplete.js`).
- **Sin clave:** lo que se escribe en estos campos va al servicio público Photon (OpenStreetMap), también en el punto de venta con la dirección del cliente. Con clave va a Google. En ambos casos solo viaja el texto de la dirección.
