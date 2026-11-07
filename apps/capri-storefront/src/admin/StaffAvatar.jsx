// Dónde se usa: listas de personas del panel (Equipo). La foto del perfil
// (staff_profile.photo_url) si la hay; si no, o si no carga, las iniciales.
import { useState } from "react";

const initialsOf = (name) =>
  String(name || "?")
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

export default function StaffAvatar({ photo, name, className = "adm-team-avatar" }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return <img className={`${className} adm-avatar-img`} src={photo} alt={name || ""} loading="lazy" onError={() => setBroken(true)} />;
  }
  return <span className={className} aria-hidden="true">{initialsOf(name)}</span>;
}
