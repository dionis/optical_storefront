// Dónde se usa: campos de dirección del panel (tiendas, perfil de la persona,
// cliente de una venta). Es un <input> normal: se puede escribir a mano siempre,
// y al elegir una sugerencia (Google Maps, ver data/addressAutocomplete.js) avisa
// con las partes de la dirección.
import { useEffect, useRef } from "react";
import { attachAddressAutocomplete } from "../data/addressAutocomplete.js";

/** `onPick(parts)`: { address_1, city, state, postal_code, country, country_code }. */
export default function AddressInput({ onPick, ...inputProps }) {
  const ref = useRef(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => attachAddressAutocomplete(ref.current, (parts) => pick.current(parts)), []);
  // El desplegable se coloca respecto a este contenedor, y no al formulario.
  return (
    <span className="addr-host">
      <input ref={ref} {...inputProps} />
    </span>
  );
}
