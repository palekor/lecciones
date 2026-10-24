/* =====================================================================
   Utilidades de interfaz compartidas (sin dependencias).
   ===================================================================== */
import { errorText } from "./i18n.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Marca un fragmento como HTML ya seguro (no se escapa). */
export const raw = (s) => ({ __raw: String(s ?? "") });

/** Plantilla que ESCAPA todo lo interpolado salvo raw() o arrays de raw(). */
export function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += render(vals[i]);
  });
  return raw(out);
}
function render(v) {
  if (v === null || v === undefined || v === false) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (typeof v === "object" && "__raw" in v) return v.__raw;
  return esc(v);
}
export function mount(el, frag) {
  el.innerHTML = frag && frag.__raw !== undefined ? frag.__raw : esc(frag);
}

export function toast(msg, kind = "info", ms = 3800) {
  let box = $("#sms-toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "sms-toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast toast-" + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
}

export function setBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    if (busyText) btn.textContent = busyText;
  } else {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

/** Pinta los errores { campo: código } junto a cada campo [data-field]. Devuelve el primero. */
export function showFieldErrors(form, errors) {
  clearFieldErrors(form);
  let first = null;
  for (const [field, code] of Object.entries(errors || {})) {
    const wrap = form.querySelector(`[data-field="${CSS.escape(field)}"]`);
    const text = errorText(field, code);
    if (!wrap) { first = first || { field, text, el: null }; continue; }
    wrap.classList.add("has-error");
    let msg = wrap.querySelector(".field-error");
    if (!msg) {
      msg = document.createElement("p");
      msg.className = "field-error";
      msg.id = "err-" + field;
      wrap.appendChild(msg);
    }
    msg.textContent = text;
    const input = wrap.querySelector("input, select, textarea");
    if (input) { input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", msg.id); }
    if (!first || !first.el) first = { field, text, el: input || wrap };
  }
  return first;
}

/** Quita el error de un campo en cuanto la persona lo corrige (al escribir, no al salir del campo,
 *  para que el contenido no se mueva justo cuando toca otra opción). */
export function clearErrorsOnEdit(form) {
  const clear = (e) => {
    const wrap = e.target.closest && e.target.closest("[data-field]");
    if (!wrap || !wrap.classList.contains("has-error")) return;
    wrap.classList.remove("has-error");
    const m = wrap.querySelector(".field-error");
    if (m) m.remove();
    wrap.querySelectorAll("[aria-invalid]").forEach((i) => { i.removeAttribute("aria-invalid"); i.removeAttribute("aria-describedby"); });
    // Si ya no queda ningún campo con error, se oculta el aviso general del formulario.
    if (!form.querySelector(".has-error")) form.querySelectorAll(".form-alert.err").forEach((a) => { a.hidden = true; });
  };
  form.addEventListener("input", (e) => { if (e.target.matches("input[type=text], input[type=email], input[type=tel], input:not([type]), textarea")) clear(e); });
  form.addEventListener("change", (e) => { if (e.target.matches("select, input[type=radio], input[type=checkbox]")) clear(e); });
}

export function clearFieldErrors(form) {
  $$(".has-error", form).forEach((w) => w.classList.remove("has-error"));
  $$(".field-error", form).forEach((m) => m.remove());
  $$("[aria-invalid]", form).forEach((i) => { i.removeAttribute("aria-invalid"); i.removeAttribute("aria-describedby"); });
}

export function download(filename, content, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** Lee ?ref= o #ref= y lo recuerda en esta pestaña (no viaja en el Referer). */
export function readRef() {
  let ref = null, first = null;
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    ref = h.get("ref");
    if (ref) {
      history.replaceState(null, "", location.pathname + location.search);
      const saved = JSON.parse(sessionStorage.getItem("sms_ref") || "null");
      first = saved && saved.ref === ref ? saved.first_name : null;
      sessionStorage.setItem("sms_ref", JSON.stringify({ ref, first_name: first, at: Date.now() }));
    } else {
      const saved = JSON.parse(sessionStorage.getItem("sms_ref") || "null");
      if (saved && Date.now() - saved.at < 6 * 3600e3) { ref = saved.ref; first = saved.first_name; }
    }
  } catch (e) { /* sin almacenamiento */ }
  return ref && /^[0-9a-f-]{36}$/i.test(ref) ? { ref, first_name: first } : null;
}

export function saveRef(ref, firstName) {
  try { sessionStorage.setItem("sms_ref", JSON.stringify({ ref, first_name: firstName, at: Date.now() })); } catch (e) { /* */ }
}

export function forgetRef() {
  try { sessionStorage.removeItem("sms_ref"); } catch (e) { /* */ }
}
