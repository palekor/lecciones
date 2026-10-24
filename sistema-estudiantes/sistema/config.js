/* =====================================================================
   ProfGermandario · Sistema de Estudiantes — configuración del cliente

   La llave es la PUBLISHABLE key (la misma de palekor-sync.js): está
   diseñada para ir en el navegador. Lo que protege los datos son las
   reglas RLS y las funciones del archivo
   _sistema/supabase/001_sistema_estudiantes.sql.
   NUNCA pongas aquí una "secret key" o la service_role key.

   Para pruebas/staging se puede sobreescribir con window.SMS_CONFIG
   antes de cargar los módulos.
   ===================================================================== */
const DEFAULTS = {
  supabaseUrl: "https://bbrdmddytqvwpbuuaqsc.supabase.co",
  supabaseKey: "sb_publishable_0rvgSNuKBN-ZTY_Y3n89dg_Kj_FAm4W",
  sdkUrl: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js",
  // Huella SRI del archivo exacto (npm @supabase/supabase-js@2.116.0). Si el CDN
  // entregara otro contenido, el navegador lo bloquea. Cambiar junto con sdkUrl.
  sdkIntegrity: "sha384-iLddHTLokph6Omwoyid4XKxHaWa6w41BnoEj0q5oOrzmYPpHIKt1wyjReA7s//pP",
  // Misma sesión que las demás apps de palekor.github.io/lecciones
  storageKey: "palekor-auth",
  brand: "ProfGermandario",
  whatsapp: "+573197894038",
  siteUrl: "https://palekor.github.io/lecciones/sistema-estudiantes/",
  defaultLang: "es"
};

export const CONFIG = Object.freeze(Object.assign({}, DEFAULTS, (typeof window !== "undefined" && window.SMS_CONFIG) || {}));
