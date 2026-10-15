// Sustituto de TryOn.jsx cuando VITE_ENABLE_TRY_ON=false.
//
// El plugin `disable-try-on` de vite.config.js redirige aquí el import dinámico
// del probador. Así three.js queda fuera del grafo de módulos y su chunk (~560
// kB) no llega a construirse, en vez de emitirse y no descargarse nunca.
//
// Los componentes ya no renderizan el probador con el flag apagado, así que
// esto no debería instanciarse; devuelve null por si acaso.
export default function TryOnDisabled() {
  return null;
}
