/* Componentes del panel: etiquetas, diálogos, selector de persona, CSV. */
import { q, rpc } from "../api.js";
import { label } from "../i18n.js";
import { toCSV } from "../core.js";
import { $, esc, html, raw, mount, toast, download, setBusy } from "../ui.js";

export function badge(group, code, text) {
  return html`<span class="badge b-${code}">${text || label(group, code)}</span>`;
}

export function apiErrorText(e) {
  if (!e) return "Algo salió mal.";
  switch (e.code) {
    case "forbidden": return "No tienes permiso para esta acción.";
    case "overlap": return "Ese horario se cruza con otra sesión activa.";
    case "duplicate": return "Ya existe un registro con ese dato (por ejemplo, el mismo correo).";
    case "check": return "Algún dato no cumple el formato esperado. Revisa los campos.";
    case "invalid": return "Hay un dato inválido: " + (e.message || "");
    case "not_found": return "No se encontró el registro.";
    case "network": return "Sin conexión con el servidor. Inténtalo de nuevo.";
    default:
      if (/last_owner/.test(e.message)) return "Debe quedar al menos un dueño activo.";
      if (/owner_only/.test(e.message)) return "Solo un dueño puede cambiar a otro dueño.";
      return "Algo salió mal: " + (e.message || "");
  }
}

/**
 * Diálogo con formulario. onSubmit(form) debe devolver una promesa;
 * si se resuelve, el diálogo se cierra. Si lanza, muestra el error.
 */
export function openDialog({ title, body, submitLabel = "Guardar", danger = false, onSubmit, onOpen, wide = false }) {
  const dlg = document.createElement("dialog");
  dlg.className = "dlg";
  if (wide) dlg.style.width = "min(760px, calc(100vw - 24px))";
  mount(dlg, html`
    <form method="dialog" novalidate>
      <header><h2>${title}</h2><button class="icon-btn" value="cancel" type="button" data-close aria-label="Cerrar">✕</button></header>
      <div class="dlg-body">${body}<p class="form-alert err" data-alert role="alert" hidden></p></div>
      <footer>
        <button class="btn btn-soft btn-sm" type="button" data-close>Cancelar</button>
        ${onSubmit ? html`<button class="btn ${danger ? "btn-dark" : "btn-primary"} btn-sm" type="submit" data-submit>${submitLabel}</button>` : ""}
      </footer>
    </form>`);
  document.body.appendChild(dlg);
  const form = dlg.querySelector("form");
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const alertBox = form.querySelector("[data-alert]");
    alertBox.hidden = true;
    const btn = form.querySelector("[data-submit]");
    setBusy(btn, true, "Guardando…");
    try {
      const keep = await onSubmit(form);
      if (keep !== false) close();
    } catch (err) {
      alertBox.textContent = err && err.userMessage ? err.userMessage : apiErrorText(err);
      alertBox.hidden = false;
    } finally {
      setBusy(btn, false);
    }
  });
  dlg.showModal();
  if (onOpen) onOpen(form, dlg);
  const first = form.querySelector(".dlg-body input:not([type=hidden]), .dlg-body select, .dlg-body textarea");
  if (first) first.focus();
  return { dlg, form, close };
}

export function userError(msg) {
  const e = new Error(msg);
  e.userMessage = msg;
  return e;
}

export function confirmDialog({ title, text, confirmLabel = "Confirmar", danger = false, requireText }) {
  return new Promise((resolve) => {
    let done = false;
    const { dlg } = openDialog({
      title, submitLabel: confirmLabel, danger,
      body: html`<p>${text}</p>${requireText ? html`
        <div class="field"><label for="confirm-text">Escribe <b>${requireText}</b> para confirmar</label>
        <input class="input" id="confirm-text" autocomplete="off"></div>` : ""}`,
      onSubmit: async (form) => {
        if (requireText && form.querySelector("#confirm-text").value.trim() !== requireText) {
          throw userError(`Escribe exactamente: ${requireText}`);
        }
        done = true;
        resolve(true);
      }
    });
    dlg.addEventListener("close", () => { if (!done) resolve(false); });
  });
}

/** Limpia un texto de búsqueda para usarlo dentro de un filtro or() de PostgREST. */
export function safeTerm(v) {
  return String(v || "").replace(/[%,()*"\\:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Selector de persona (busca por nombre, correo o WhatsApp). */
export function studentPicker(container, onPick) {
  mount(container, html`
    <div class="field"><label for="pick-q">Persona</label>
      <input class="input" id="pick-q" placeholder="Busca por nombre, correo o WhatsApp" autocomplete="off">
      <div class="pick-list" id="pick-list" role="listbox" hidden></div>
      <p class="small muted" id="pick-chosen"></p>
    </div>`);
  const input = $("#pick-q", container);
  const list = $("#pick-list", container);
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const term = safeTerm(input.value);
      if (term.length < 2) { list.hidden = true; return; }
      const rows = await q((c) => c.from("sms_students")
        .select("id,full_name,email,whatsapp,status")
        .is("anonymized_at", null)
        .or(`full_name.ilike.*${term}*,email.ilike.*${term}*,whatsapp.ilike.*${term.replace(/\D/g, "") || term}*`)
        .order("full_name").limit(12));
      list.hidden = false;
      mount(list, rows.length
        ? html`${rows.map((r) => html`<button type="button" role="option" data-id="${r.id}" data-name="${r.full_name}">
            <b>${r.full_name}</b> <span class="small muted">${r.email}</span> ${badge("student", r.status)}</button>`)}`
        : html`<p class="small muted" style="padding:10px 12px;margin:0">Sin resultados.</p>`);
    }, 250);
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    list.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("#pick-chosen", container).textContent = "Seleccionado: " + b.dataset.name;
    onPick({ id: b.dataset.id, name: b.dataset.name });
  });
}

export async function exportCSV(entity, filename, rows, columns) {
  if (!rows.length) return toast("No hay filas para exportar.", "err");
  download(filename, toCSV(rows, columns));
  try { await rpc("sms_log_export", { p_entity: entity, p_count: rows.length }); } catch (e) { /* el registro de auditoría no bloquea la descarga */ }
  toast(`Exportadas ${rows.length} filas.`, "ok");
}

export function selectOptions(list, selected, { empty } = {}) {
  return html`${empty !== undefined ? html`<option value="">${empty}</option>` : ""}${list.map((o) =>
    html`<option value="${o.value}" ${raw(String(o.value) === String(selected ?? "") ? "selected" : "")}>${o.label}</option>`)}`;
}

export { esc, raw };

/** "Lun, Mié · Noche · después de las 7" */
export function availabilityText(av) {
  if (!av || typeof av !== "object") return "";
  const parts = [];
  if (Array.isArray(av.days) && av.days.length) parts.push(av.days.map((x) => label("day", x)).join(", "));
  if (Array.isArray(av.times) && av.times.length) parts.push(av.times.map((x) => label("time", x)).join(", "));
  if (av.notes) parts.push(av.notes);
  return parts.join(" · ");
}
