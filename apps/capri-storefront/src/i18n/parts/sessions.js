// Sesiones del panel: «cerrar sesión en todos mis equipos» (StaffProfile.jsx,
// DELETE /admin/team/me/sessions), cierre remoto desde Equipo (Team.jsx,
// DELETE /admin/team/:id/sessions) y la acción de auditoría `session.revoke`
// (backend lib/session-control.ts). Los vetos llegan como adm.err.team.<reason>
// y comparten código con restablecer contraseña (forbidden_role, self_password).
export default {
  es: {
    "adm.profile.sessions.all": "Cerrar sesión en todos mis equipos",
    "adm.profile.sessions.help": "Cierra tu sesión en cualquier otro navegador o tableta donde hayas entrado, esta incluida. Volverás a la pantalla de inicio de sesión.",
    "adm.profile.sessions.confirmTitle": "¿Cerrar sesión en todos tus equipos?",
    "adm.profile.sessions.confirmBody": "Todas tus sesiones abiertas dejarán de servir, también esta. Vuelve a entrar con tu contraseña de siempre.",
    "adm.team.sessions.kick": "Cerrar sus sesiones",
    "adm.team.sessions.help": "Cierra su sesión en todos los equipos donde haya entrado. La cuenta sigue activa: vuelve a entrar con su contraseña.",
    "adm.team.sessions.confirm": "¿Cerrar las sesiones de {email}?",
    "adm.team.sessions.body": "Sus pestañas abiertas quedarán fuera en la siguiente petición. No pierde el acceso: vuelve a entrar con su contraseña de siempre.",
    "adm.team.sessions.done": "Sesiones de {email} cerradas en todos sus equipos.",
    "adm.err.team.sessionsFailed": "No se pudieron cerrar las sesiones.",
    "adm.audit.action.session.revoke": "Sesiones cerradas en todos los equipos",
  },
  en: {
    "adm.profile.sessions.all": "Sign out on all my devices",
    "adm.profile.sessions.help": "Signs you out of every other browser or tablet you signed in on, this one included. You will return to the sign-in screen.",
    "adm.profile.sessions.confirmTitle": "Sign out on all your devices?",
    "adm.profile.sessions.confirmBody": "Every open session stops working, this one too. Sign in again with your usual password.",
    "adm.team.sessions.kick": "Sign out their sessions",
    "adm.team.sessions.help": "Signs them out of every device they signed in on. The account stays active: they sign in again with their password.",
    "adm.team.sessions.confirm": "Sign {email} out everywhere?",
    "adm.team.sessions.body": "Their open tabs are refused on their next request. They keep their access: they sign in again with their usual password.",
    "adm.team.sessions.done": "{email} signed out on all their devices.",
    "adm.err.team.sessionsFailed": "Could not sign out the sessions.",
    "adm.audit.action.session.revoke": "Signed out on all devices",
  },
};
