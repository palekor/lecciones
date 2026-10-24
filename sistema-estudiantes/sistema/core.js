/* =====================================================================
   Lógica pura (sin DOM): validación, normalización, países, fechas, CSV.
   Las reglas replican las del servidor (sms__validate) para dar errores
   inmediatos; el servidor siempre vuelve a validar.
   Probado con: node _sistema/tests/core.test.mjs
   ===================================================================== */

export const LEVELS = ["beginner", "elementary", "intermediate", "advanced", "not_sure"];
export const OBJECTIVES = ["conversation", "professional", "interviews", "academic", "travel", "from_zero", "other"];
export const FORMATS = ["individual", "self_study", "not_sure"];
export const CONTACTS = ["whatsapp", "email", "call"];
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const TIMES = ["morning", "afternoon", "evening"];
export const LEAD_STATUSES = ["new", "contact_pending", "contacted", "awaiting_response", "waitlist", "invitation_sent", "booking_requested", "booking_confirmed", "converted", "not_interested", "archived"];
export const OPEN_LEAD_STATUSES = LEAD_STATUSES.slice(0, 8);
export const URGENCIES = ["asap", "1_3_months", "3_6_months", "exploring"];
export const SKILLS = ["listening", "speaking", "reading", "writing", "vocabulary", "grammar", "pronunciation", "confidence"];
export const CEFR = ["pre_a1", "a1", "a2", "b1", "b2", "c1", "c2"];
export const TASK_KINDS = ["contact", "confirm_booking", "review_progress", "send_resources", "assessment", "renewal", "reactivate", "other"];
export const STUDENT_STATUSES = ["prospect", "active", "paused", "completed", "inactive"];
export const BOOKING_STATUSES = ["requested", "confirmed", "rejected", "cancelled", "completed", "no_show"];
export const SESSION_TYPES = ["diagnostic", "class", "follow_up", "other"];
export const CHANNELS = ["meet", "zoom", "whatsapp", "in_person", "other"];
export const PAYMENT_STATUSES = ["pending", "paid", "refunded", "void"];
export const PAYMENT_METHODS = ["transfer", "nequi", "daviplata", "paypal", "card", "cash", "other"];
export const PROGRESS_STATUSES = ["not_started", "in_progress", "completed"];

/* ---------------- países ---------------- */
// Hispanohablantes y destinos frecuentes primero; luego el resto (ISO 3166-1).
export const PRIORITY_COUNTRIES = ["CO", "MX", "AR", "CL", "PE", "EC", "VE", "BO", "PY", "UY", "CR", "PA", "GT", "HN", "SV", "NI", "DO", "PR", "CU", "ES", "US", "CA"];
const ALL_CODES = ("AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" ");

export const DIAL_CODES = {
  AR: "54", BO: "591", BR: "55", CA: "1", CL: "56", CO: "57", CR: "506", CU: "53", DO: "1", EC: "593", SV: "503",
  ES: "34", US: "1", GT: "502", HN: "504", MX: "52", NI: "505", PA: "507", PY: "595", PE: "51", PR: "1", UY: "598",
  VE: "58", GQ: "240", BZ: "501", HT: "509", JM: "1", TT: "1", GY: "592", SR: "597", CW: "599", AW: "297",
  GB: "44", DE: "49", FR: "33", IT: "39", PT: "351", NL: "31", BE: "32", CH: "41", AT: "43", IE: "353", SE: "46",
  NO: "47", DK: "45", FI: "358", PL: "48", GR: "30", CZ: "420", HU: "36", RO: "40", UA: "380", RU: "7", TR: "90",
  AD: "376", IL: "972", AE: "971", SA: "966", QA: "974", AU: "61", NZ: "64", JP: "81", CN: "86", KR: "82",
  IN: "91", PH: "63", SG: "65", HK: "852", TW: "886", ZA: "27", MA: "212", EG: "20", NG: "234", KE: "254"
};

/** Zonas horarias IANA disponibles en el navegador (con respaldo mínimo). */
export function timeZones() {
  try { if (Intl.supportedValuesOf) return Intl.supportedValuesOf("timeZone"); } catch (e) { /* */ }
  return ["America/Bogota", "America/Mexico_City", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires",
    "America/Caracas", "America/Guayaquil", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/Madrid"];
}

export function countryName(code, lang = "es") {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) || code;
  } catch (e) {
    return code;
  }
}

export function countryList(lang = "es") {
  const coll = new Intl.Collator(lang);
  const rest = ALL_CODES.filter((c) => !PRIORITY_COUNTRIES.includes(c))
    .map((c) => ({ code: c, name: countryName(c, lang) }))
    .sort((a, b) => coll.compare(a.name, b.name));
  return {
    priority: PRIORITY_COUNTRIES.map((c) => ({ code: c, name: countryName(c, lang) })),
    rest
  };
}

/* ---------------- normalización ---------------- */
export function normalizeEmail(v) {
  return String(v ?? "").trim().toLowerCase();
}

export function normalizePhone(v) {
  let s = String(v ?? "").replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return /^\+[1-9][0-9]{7,14}$/.test(s) ? s : null;
}

export function normalizeName(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

export function firstName(v) {
  return normalizeName(v).split(" ")[0] || "";
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/;
const NAME_BAD_RE = /[0-9<>{}@#$%^*=_|\\/:;"]/;

export function isValidEmail(v) {
  const e = normalizeEmail(v);
  return e.length <= 254 && EMAIL_RE.test(e) && !e.includes("..");
}

export function cleanAvailability(a) {
  a = a && typeof a === "object" ? a : {};
  const days = DAYS.filter((d) => Array.isArray(a.days) && a.days.includes(d));
  const times = TIMES.filter((x) => Array.isArray(a.times) && a.times.includes(x));
  const notes = String(a.notes ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) || null;
  const tz = typeof a.tz === "string" && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(a.tz) && a.tz.length <= 64 ? a.tz : null;
  return { days, times, tz, notes };
}

/* ---------------- validación (espejo de sms__validate) ---------------- */
/**
 * @param {object} p  datos del formulario
 * @param {"register"|"waitlist"|"booking"} kind
 * @param {object} cfg  config pública (sms_public_config)
 * @returns {object} { campo: código } — vacío si todo está bien
 */
export function validateIntake(p, kind, cfg = {}) {
  const e = {};
  const needProfile = kind === "register";
  const needRequest = kind === "register" || kind === "waitlist";

  const name = String(p.full_name ?? "").trim();
  if (!name) e.full_name = "required";
  else if (name.length < 2 || name.length > 120) e.full_name = "length";
  else if (NAME_BAD_RE.test(name) || /[\u0000-\u001f]/.test(name) || !/\p{L}/u.test(name)) e.full_name = "format";

  const email = normalizeEmail(p.email);
  if (!email) e.email = "required";
  else if (!isValidEmail(email)) e.email = "format";

  // Solo el indicativo prellenado (p. ej. "+57 ") cuenta como vacío.
  const phone = String(p.whatsapp ?? "").trim();
  if (phone.replace(/\D/g, "").length <= 4) e.whatsapp = "required";
  else if (!normalizePhone(phone)) e.whatsapp = "format";

  const country = String(p.country ?? "").trim().toUpperCase();
  if (!country) e.country = "required";
  else if (!/^[A-Z]{2}$/.test(country)) e.country = "invalid";

  const choice = (field, list, required) => {
    const v = p[field] ?? "";
    if (v === "") { if (required) e[field] = "required"; }
    else if (!list.includes(v)) e[field] = "invalid";
  };
  choice("english_level", LEVELS, needProfile);
  choice("objective", OBJECTIVES, needRequest);
  choice("preferred_format", FORMATS, needRequest);
  choice("preferred_contact", CONTACTS, needProfile);
  choice("urgency", URGENCIES, false);
  if (p.objective === "other" && !String(p.objective_other ?? "").trim()) e.objective_other = "required";
  if (String(p.objective_other ?? "").length > 200) e.objective_other = "length";

  if (p.availability && String(p.availability.notes ?? "").length > 300) e.availability = "length";
  else if (needRequest) {
    const av = cleanAvailability(p.availability);
    if (!((av.days.length && av.times.length) || av.notes)) e.availability = "required";
  }

  const maxLen = { comments: 1000, professional_goals: 1000, referral_source: 120, message: 500, occupation: 120 };
  for (const [k, n] of Object.entries(maxLen)) if (String(p[k] ?? "").length > n) e[k] = "length";

  if (p.consent_privacy !== true) e.consent_privacy = "required";

  if (kind === "register" && Array.isArray(cfg.extra_questions)) {
    for (const q of cfg.extra_questions) {
      const a = p.extra ? p.extra[q.id] : undefined;
      const empty = a === undefined || a === null || (typeof a === "string" && !a.trim()) || (q.type === "checkbox" && a === false);
      if (empty) { if (q.required) e["extra_" + q.id] = "required"; continue; }
      if (q.type === "select" && !(q.options || []).includes(a)) e["extra_" + q.id] = "invalid";
      if ((q.type === "text" && String(a).length > 200) || (q.type === "textarea" && String(a).length > 1000)) e["extra_" + q.id] = "length";
    }
  }
  return e;
}

/* ---------------- fechas ---------------- */
export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Bogota"; } catch (e) { return "America/Bogota"; }
}

export function fmtDate(iso, tz, opts = {}) {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat("es", { timeZone: tz || undefined, day: "numeric", month: "short", year: "numeric", ...opts }).format(d);
}

export function fmtDateTime(iso, tz) {
  return fmtDate(iso, tz, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function fmtTime(iso, tz) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es", { timeZone: tz || undefined, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Clave de día local (YYYY-MM-DD) de un instante en una zona horaria. */
export function dayKey(iso, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Agrupa horarios [{start,end,type}] por día local. */
export function groupSlotsByDay(slots, tz) {
  const map = new Map();
  for (const s of slots || []) {
    const k = dayKey(s.start, tz);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }));
}

/** "2026-10-23T14:30" (hora local de la zona tz) → ISO UTC. */
export function zonedLocalToISO(local, tz) {
  if (!local) return null;
  const [d, t = "00:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  const offset = (ts) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ts));
    const g = (k) => Number(p.find((x) => x.type === k).value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ts;
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts);
  return new Date(ts).toISOString();
}

/** ISO → "YYYY-MM-DDTHH:MM" en la zona tz (para inputs datetime-local). */
export function isoToZonedLocal(iso, tz) {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const g = (k) => p.find((x) => x.type === k).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/* ---------------- CSV (con protección contra inyección de fórmulas) ---------------- */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(typeof c.value === "function" ? c.value(r) : r[c.key])).join(","));
  return "﻿" + [head, ...body].join("\r\n");
}

/* ---------------- utilidades ---------------- */
export function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function waLink(phone, text) {
  const n = String(phone || "").replace(/[^\d]/g, "");
  return `https://wa.me/${n}${text ? "?text=" + encodeURIComponent(text) : ""}`;
}

export function fillTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}
