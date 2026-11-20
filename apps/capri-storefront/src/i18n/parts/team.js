// Equipo: desactivar / reactivar a una persona sin borrarla (HU-04, Team.jsx,
// POST /admin/team/:id/status). Los vetos llegan como adm.err.team.<reason> y
// comparten código con Eliminar (super_admin, self, owner_only, forbidden_role).
export default {
  es: {
    "adm.team.deactivate": "Desactivar",
    "adm.team.reactivate": "Reactivar",
    "adm.team.inactiveTag": "Inactivo",
    "adm.team.inactiveSince": "Sin acceso desde {date}",
    "adm.team.deactivateConfirm": "¿Desactivar a {email} ({role})?",
    "adm.team.deactivateBody": "Perderá el acceso al panel al instante y sus sesiones abiertas dejarán de servir. Conserva su rol, su perfil y su historial: podrás reactivarle cuando quieras.",
    "adm.team.deactivated": "{email} desactivado: ya no puede entrar al panel.",
    "adm.team.reactivated": "{email} reactivado con su rol de antes.",
    "adm.err.team.statusFailed": "No se pudo cambiar el estado.",
    "adm.err.team.bad_active": "Estado no válido.",
    "adm.audit.action.user.deactivate": "Usuario desactivado",
    "adm.audit.action.user.reactivate": "Usuario reactivado",
  },
  en: {
    "adm.team.deactivate": "Deactivate",
    "adm.team.reactivate": "Reactivate",
    "adm.team.inactiveTag": "Inactive",
    "adm.team.inactiveSince": "No access since {date}",
    "adm.team.deactivateConfirm": "Deactivate {email} ({role})?",
    "adm.team.deactivateBody": "They lose panel access right away and their open sessions stop working. Their role, profile and history are kept: you can reactivate them at any time.",
    "adm.team.deactivated": "{email} deactivated: they can no longer sign in to the panel.",
    "adm.team.reactivated": "{email} reactivated with their previous role.",
    "adm.err.team.statusFailed": "Could not change the status.",
    "adm.err.team.bad_active": "Invalid status.",
    "adm.audit.action.user.deactivate": "User deactivated",
    "adm.audit.action.user.reactivate": "User reactivated",
  },
};
