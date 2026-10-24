/* =====================================================================
   Textos de la interfaz. Español completo; inglés preparado (parcial).
   Uso: t("form.email")  ·  t("errors.required")  ·  label("level", "beginner")
   Para traducir: completar el objeto EN; lo que falte cae al español.
   ===================================================================== */
const ES = {
  level: { beginner: "Principiante", elementary: "Básico", intermediate: "Intermedio", advanced: "Avanzado", not_sure: "No estoy seguro/a" },
  objective: {
    conversation: "Conversación cotidiana", professional: "Inglés profesional", interviews: "Entrevistas de trabajo",
    academic: "Inglés académico", travel: "Viajes", from_zero: "Inglés desde cero", other: "Otro"
  },
  format: { individual: "Sesiones individuales", self_study: "Acompañamiento digital (autoestudio guiado)", not_sure: "Aún no lo sé" },
  urgency: { asap: "Lo antes posible", "1_3_months": "En 1 a 3 meses", "3_6_months": "En 3 a 6 meses", exploring: "Solo estoy explorando" },
  skill: {
    listening: "Comprensión auditiva", speaking: "Expresión oral", reading: "Lectura", writing: "Escritura",
    vocabulary: "Vocabulario", grammar: "Gramática", pronunciation: "Pronunciación", confidence: "Confianza comunicativa"
  },
  cefr: { pre_a1: "Pre-A1", a1: "A1", a2: "A2", b1: "B1", b2: "B2", c1: "C1", c2: "C2" },
  task: {
    contact: "Contactar", confirm_booking: "Confirmar reserva", review_progress: "Revisar progreso", send_resources: "Enviar recursos",
    assessment: "Hacer evaluación", renewal: "Seguimiento de renovación", reactivate: "Contactar estudiante inactivo", other: "Otra"
  },
  taskStatus: { open: "Pendiente", done: "Hecha", cancelled: "Cancelada" },
  outbox: { booking_confirmed: "Confirmación de sesión", booking_cancelled: "Cancelación", booking_rescheduled: "Reprogramación", booking_reminder: "Recordatorio" },
  contact: { whatsapp: "WhatsApp", email: "Correo electrónico", call: "Llamada" },
  day: { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" },
  time: { morning: "Mañana", afternoon: "Tarde", evening: "Noche" },
  lead: {
    new: "Nuevo prospecto", contact_pending: "Contacto pendiente", contacted: "Contactado", awaiting_response: "Pendiente de respuesta",
    waitlist: "En lista de espera", invitation_sent: "Invitado a reservar", booking_requested: "Reserva solicitada",
    booking_confirmed: "Reserva confirmada", converted: "Convertido en estudiante",
    not_interested: "No interesado", archived: "Archivado"
  },
  student: { prospect: "Prospecto", active: "Estudiante activo", paused: "En pausa", completed: "Finalizado", inactive: "Inactivo" },
  booking: { requested: "Por confirmar", confirmed: "Confirmada", rejected: "Rechazada", cancelled: "Cancelada", completed: "Realizada", no_show: "No asistió" },
  session: { diagnostic: "Sesión de diagnóstico", class: "Clase", follow_up: "Seguimiento", other: "Otra" },
  channel: { meet: "Google Meet", zoom: "Zoom", whatsapp: "WhatsApp", in_person: "Presencial", other: "Otro" },
  payment: { pending: "Pendiente", paid: "Pagado", refunded: "Reembolsado", void: "Anulado" },
  method: { transfer: "Transferencia", nequi: "Nequi", daviplata: "Daviplata", paypal: "PayPal", card: "Tarjeta", cash: "Efectivo", other: "Otro" },
  billing: { monthly: "Mensual", yearly: "Anual", one_time: "Pago único" },
  progress: { not_started: "Sin iniciar", in_progress: "En curso", completed: "Completado" },
  role: { owner: "Dueño", admin: "Administrador", staff: "Equipo" },
  errors: {
    required: "Este campo es obligatorio.",
    length: "El texto es demasiado largo.",
    format: "Revisa el formato.",
    invalid: "Elige una opción válida.",
    "full_name.format": "Escribe tu nombre sin números ni símbolos.",
    "full_name.length": "Escribe tu nombre completo (entre 2 y 120 caracteres).",
    "email.format": "Revisa tu correo: debe verse como nombre@dominio.com.",
    "whatsapp.format": "Escribe tu número con indicativo de país, por ejemplo +57 300 123 4567.",
    "availability.required": "Marca al menos un día y una franja, o escríbenos tu disponibilidad.",
    "objective_other.required": "Cuéntanos cuál es tu objetivo.",
    "consent_privacy.required": "Para continuar debes aceptar el tratamiento de tus datos.",
    "consent_privacy.outdated": "El aviso de privacidad se actualizó. Recarga la página para ver la versión vigente.",
    "form.too_fast": "Tómate unos segundos para revisar el formulario y vuelve a enviarlo.",
    "form.rate_limited": "Recibimos varios envíos desde tu conexión. Espera unos minutos e inténtalo de nuevo.",
    "form.invalid": "No pudimos procesar el formulario. Recarga la página e inténtalo de nuevo.",
    "form.in_progress": "Tu envío anterior se está procesando. Espera un momento.",
    "form.waitlist_closed": "La lista de espera está cerrada en este momento. Escríbenos por WhatsApp.",
    "form.booking_closed": "Las reservas en línea están pausadas. Escríbenos por WhatsApp.",
    "slot.required": "Elige un horario.",
    "slot.unavailable": "Ese horario acaba de ocuparse. Elige otro.",
    "slot.taken": "Ese horario acaba de ocuparse. Elige otro.",
    "slot.too_many_pending": "Ya tienes solicitudes pendientes. Te confirmaremos pronto por WhatsApp.",
    "urgency.invalid": "Elige una opción válida.",
    "occupation.length": "Escribe tu ocupación en menos de 120 caracteres.",
    "ref.invalid": "El enlace venció. Completa tus datos para continuar.",
    network: "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.",
    generic: "Algo salió mal. Inténtalo de nuevo en unos minutos."
  }
};

const EN = {
  level: { beginner: "Beginner", elementary: "Elementary", intermediate: "Intermediate", advanced: "Advanced", not_sure: "Not sure" },
  objective: {
    conversation: "Everyday conversation", professional: "Professional English", interviews: "Job interviews",
    academic: "Academic English", travel: "Travel", from_zero: "English from zero", other: "Other"
  },
  format: { individual: "Individual sessions", self_study: "Guided self-study", not_sure: "Not sure yet" },
  contact: { whatsapp: "WhatsApp", email: "Email", call: "Phone call" }
};

const DICTS = { es: ES, en: EN };

function detectLang() {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q && DICTS[q]) { localStorage.setItem("sms_lang", q); return q; }
    const s = localStorage.getItem("sms_lang");
    if (s && DICTS[s]) return s;
  } catch (e) { /* almacenamiento no disponible */ }
  return "es";
}

export const LANG = typeof window !== "undefined" ? detectLang() : "es";

function lookup(dict, path) {
  return path.split(".").reduce((o, k) => (o && typeof o === "object" && k in o ? o[k] : undefined), dict);
}

export function t(path, vars) {
  let s = lookup(DICTS[LANG], path);
  if (s === undefined) s = lookup(ES, path);
  if (s === undefined) return path;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ""));
  return s;
}

const OVERRIDES = {};
/** Nombres personalizados (Ajustes → Nombres de estados). { lead: {code: "texto"}, student: {...} } */
export function setLabelOverrides(map) {
  Object.keys(OVERRIDES).forEach((k) => delete OVERRIDES[k]);
  if (map && typeof map === "object") for (const [g, v] of Object.entries(map)) if (v && typeof v === "object") OVERRIDES[g] = { ...v };
}

export function label(group, code) {
  if (code === null || code === undefined || code === "") return "";
  if (OVERRIDES[group] && OVERRIDES[group][code]) return OVERRIDES[group][code];
  const s = t(group + "." + code);
  return s === group + "." + code ? code : s;
}

export function options(group) {
  const src = lookup(ES, group) || {};
  return Object.keys(src).map((k) => ({ value: k, label: label(group, k) }));
}

/** Mensaje en español para un error de validación devuelto por el servidor. */
export function errorText(field, code) {
  const specific = lookup(ES, "errors")[field + "." + code];
  if (specific) return specific;
  return lookup(ES, "errors")[code] || lookup(ES, "errors").generic;
}
