// Reglas lente × receta que el servidor hace cumplir en el POS
// (apps/backend/src/lib/pos-lens-rules.ts y lens-quote.ts): el navegador las
// explica antes, pero una pantalla vieja o una petición a mano se encuentran con
// estos `reason`. Parte propia para no chocar con pos-rx.js ni lens-finish.js.
export default {
  es: {
    "adm.err.pos.design_needs_add": "Ese lente (bifocal o progresivo) necesita la adición (ADD) en la receta. Escríbela en los dos ojos o elige visión sencilla.",
    "adm.err.pos.design_no_add": "La receta trae adición (ADD), pero el lente elegido es de visión sencilla. Elige un bifocal o progresivo, o quita la adición.",
    "adm.err.pos.rx_add_mismatch": "La adición (ADD) debe ser la misma en los dos ojos. Revisa la receta.",
    "adm.err.pos.photo_unavailable": "Ese fotocromático no está disponible para ese tipo de lente. Elige otro o quítalo.",
    "adm.err.pos.ar_unavailable": "Ese antirreflejo no corresponde a ese tipo de lente. Elige uno de la lista para ese lente.",
    "adm.err.pos.rx_unconfirmed": "La receta se leyó de la foto y falta confirmarla. Revisa los valores y pulsa «Confirmar».",
  },
  en: {
    "adm.err.pos.design_needs_add": "That lens (bifocal or progressive) needs the ADD on the prescription. Type it for both eyes or pick single vision.",
    "adm.err.pos.design_no_add": "The prescription has an ADD, but the chosen lens is single vision. Pick a bifocal or progressive, or remove the ADD.",
    "adm.err.pos.rx_add_mismatch": "The ADD must be the same in both eyes. Check the prescription.",
    "adm.err.pos.photo_unavailable": "That photochromic is not available for that lens type. Pick another one or remove it.",
    "adm.err.pos.ar_unavailable": "That anti-reflective does not go with that lens type. Pick one from the list for that lens.",
    "adm.err.pos.rx_unconfirmed": "The prescription was read from the photo and has not been confirmed. Check the values and press “Confirm”.",
  },
};
