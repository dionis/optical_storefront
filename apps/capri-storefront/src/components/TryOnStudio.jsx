import TryOn from "./TryOn.jsx";

// Interfaz de CLIENTE (producción) del probador.
//
// "Nace de" TryOn.jsx: reutiliza EXACTAMENTE su motor (cámara + MediaPipe +
// three.js + oclusores) pasando `studio`, que oculta el panel de calibración y
// activa el estilo de tienda (clase .tryon-studio). No duplica el motor, así que
// cualquier mejora del motor beneficia a las dos interfaces a la vez.
//
// El respaldo (TryOn.jsx con calibración) NO se toca y sigue accesible por el
// switch (ver TryOnSwitch.jsx y el README). Esta es la que ve el cliente.
export default function TryOnStudio(props) {
  return <TryOn {...props} studio />;
}
