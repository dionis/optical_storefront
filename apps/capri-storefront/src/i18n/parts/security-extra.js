// Pestaña Seguridad: comprobaciones añadidas después de translations.js. Las
// etiquetas (`adm.sec.k.*`) y ayudas (`adm.sec.h.*`) se buscan por la clave que
// devuelve GET /admin/security-status (backend lib/security.ts securityAudit).
export default {
  es: {
    "adm.sec.k.db.migrations_applied": "Migraciones de la base de datos aplicadas al arrancar",
    "adm.sec.h.db.migrations_applied": "El servidor arrancó aunque `db:migrate` falló (docker-entrypoint.sh): corre sobre un esquema viejo y las pantallas que necesiten las columnas nuevas darán error. Ejecuta la migración a mano y vuelve a desplegar.",
  },
  en: {
    "adm.sec.k.db.migrations_applied": "Database migrations applied at boot",
    "adm.sec.h.db.migrations_applied": "The server started although `db:migrate` failed (docker-entrypoint.sh): it runs on an old schema and the screens that need the new columns will fail. Run the migration by hand and redeploy.",
  },
};
