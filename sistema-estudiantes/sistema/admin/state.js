/* Estado compartido del panel y utilidades de formato. */
import { q, rpc } from "../api.js";
import { fmtDate, fmtDateTime, fmtTime } from "../core.js";
import { setLabelOverrides, label } from "../i18n.js";

export const S = {
  me: null,          // { user_id, email, staff: { role, display_name } }
  settings: {},
  staff: [],
  plans: [],
  steps: [],
  sessionTypes: [],
  get role() { return this.me && this.me.staff ? this.me.staff.role : null; },
  get isAdmin() { return this.role === "owner" || this.role === "admin"; },
  get tz() { return this.settings.timezone || "America/Bogota"; }
};

export async function loadBasics() {
  const [settings, staff, plans, steps, types] = await Promise.all([
    rpc("sms_settings_get"),
    q((c) => c.from("sms_staff").select("user_id,email,display_name,role,active").order("created_at")),
    q((c) => c.from("sms_plans").select("*").order("sort").order("name")),
    q((c) => c.from("sms_journey_steps").select("*").order("step_no")),
    q((c) => c.from("sms_session_types").select("*").order("sort").order("name"))
  ]);
  S.settings = settings || {};
  S.staff = staff || [];
  S.plans = plans || [];
  S.steps = steps || [];
  S.sessionTypes = types || [];
  setLabelOverrides(S.settings.status_labels);
}

export const dt = (iso) => fmtDateTime(iso, S.tz);
export const d = (iso) => fmtDate(iso, S.tz);
export const tm = (iso) => fmtTime(iso, S.tz);

export function staffName(id) {
  const s = S.staff.find((x) => x.user_id === id);
  return s ? (s.display_name || s.email) : "";
}

export function sessionName(code) {
  const t = S.sessionTypes.find((x) => x.code === code);
  return t ? t.name : label("session", code);
}

export function planName(id) {
  const p = S.plans.find((x) => x.id === id);
  return p ? p.name : "";
}

export function relative(iso) {
  if (!iso) return "";
  const diff = (new Date(iso) - Date.now()) / 86400000;
  const r = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (Math.abs(diff) < 1) {
    const h = Math.round(diff * 24);
    return Math.abs(h) < 1 ? "ahora" : r.format(h, "hour");
  }
  return r.format(Math.round(diff), "day");
}

export function isOverdue(iso) {
  return iso && new Date(iso) < new Date();
}

export function money(amount, currency) {
  try {
    return new Intl.NumberFormat("es", { style: "currency", currency: currency || "USD", currencyDisplay: "code", maximumFractionDigits: 2 }).format(amount);
  } catch (e) {
    return `${currency} ${amount}`;
  }
}
