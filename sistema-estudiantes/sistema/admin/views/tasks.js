/* Tareas — Módulo 5: recordatorios internos y próximas acciones */
import { q } from "../../api.js";
import { label } from "../../i18n.js";
import { TASK_KINDS } from "../../core.js";
import { $, $$, html, mount } from "../../ui.js";
import { S, dt, relative, staffName } from "../state.js";
import { selectOptions } from "../widgets.js";
import { taskDialog, setTaskStatus } from "../forms.js";

export function taskItem(t, { showPerson = true } = {}) {
  const overdue = t.status === "open" && new Date(t.due_at) < new Date();
  return html`<div class="task ${t.status !== "open" ? "done" : ""}">
    <input type="checkbox" data-done="${t.id}" ${t.status === "done" ? "checked" : ""} aria-label="Marcar como hecha: ${t.title}">
    <div>
      <b>${t.title}</b>
      <span class="small muted" style="display:block">${label("task", t.kind)}
        ${showPerson && t.student_id ? html` · <a href="#/persona/${t.student_id}">${t.full_name || "ver ficha"}</a>` : ""}
        ${t.assigned_to ? " · " + staffName(t.assigned_to) : ""}</span>
      <span class="small ${overdue ? "overdue" : "muted"}" style="display:block">${t.status === "done" ? "Hecha " + relative(t.completed_at) : (overdue ? "Vencida: " : "Para ") + dt(t.due_at)}</span>
      ${t.notes ? html`<span class="small" style="display:block;margin-top:4px;white-space:pre-wrap">${t.notes}</span>` : ""}
    </div>
    <span class="acts">${t.status === "open" ? html`<button class="btn btn-soft btn-sm" type="button" data-edit-task="${t.id}">Editar</button>
      <button class="btn btn-soft btn-sm" type="button" data-cancel-task="${t.id}">Cancelar</button>` : ""}</span>
  </div>`;
}

/** Conecta los botones de una lista de tareas. */
export function bindTaskList(root, getTasks, reload) {
  root.addEventListener("change", (e) => {
    const cb = e.target.closest("[data-done]");
    if (!cb) return;
    const t = getTasks().find((x) => x.id === cb.dataset.done);
    setTaskStatus(t, cb.checked ? "done" : "open", reload);
  });
  root.addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit-task]");
    if (ed) return taskDialog({ task: getTasks().find((x) => x.id === ed.dataset.editTask), onSaved: reload });
    const cc = e.target.closest("[data-cancel-task]");
    if (cc) return setTaskStatus(getTasks().find((x) => x.id === cc.dataset.cancelTask), "cancelled", reload);
  });
}

export async function render(el, params, ctx) {
  let filter = params.f || "pending";
  let kind = "";
  let mine = false;
  let tasks = [];

  mount(el, html`
    <div class="toolbar">
      <div class="filters" role="group" aria-label="Filtrar tareas" style="margin:0">
        ${[["pending", "Pendientes"], ["overdue", "Vencidas"], ["today", "Hoy"], ["done", "Hechas"]].map(([v, t]) =>
          html`<button class="filter-chip" type="button" data-f="${v}" aria-pressed="${filter === v}">${t}</button>`)}
      </div>
      <select class="input" id="tk-kind-filter" aria-label="Tipo">${selectOptions(TASK_KINDS.map((k) => ({ value: k, label: label("task", k) })), "", { empty: "Todos los tipos" })}</select>
      <label class="switch"><input type="checkbox" id="tk-mine"> Solo mías</label>
      <span style="flex:1"></span>
      <button class="btn btn-primary" type="button" id="new-task">Nueva tarea</button>
    </div>
    <section id="task-list"></section>`);

  async function load() {
    const box = $("#task-list", el);
    const now = new Date();
    const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
    tasks = await q((c) => {
      let qb = c.from("sms_tasks_v").select("*");
      if (filter === "done") qb = qb.in("status", ["done", "cancelled"]).order("completed_at", { ascending: false, nullsFirst: false });
      else {
        qb = qb.eq("status", "open").order("due_at");
        if (filter === "overdue") qb = qb.lt("due_at", now.toISOString());
        if (filter === "today") qb = qb.lte("due_at", endToday.toISOString());
      }
      if (kind) qb = qb.eq("kind", kind);
      if (mine) qb = qb.eq("assigned_to", S.me.user_id);
      return qb.limit(300);
    });
    mount(box, tasks.length ? html`${tasks.map((t) => taskItem(t))}`
      : html`<div class="empty-state"><b>${filter === "done" ? "Aún no hay tareas hechas." : "No hay tareas con este filtro."}</b>
          Programa tareas desde aquí o desde la ficha de cada persona (pestaña Tareas).</div>`);
  }

  bindTaskList($("#task-list", el), () => tasks, () => { ctx.refreshCounts(); load(); });
  el.addEventListener("click", (e) => {
    const fb = e.target.closest("[data-f]");
    if (fb) {
      filter = fb.dataset.f;
      $$("[data-f]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === fb)));
      return load();
    }
    if (e.target.closest("#new-task")) taskDialog({ onSaved: () => { ctx.refreshCounts(); load(); } });
  });
  $("#tk-kind-filter", el).addEventListener("change", (e) => { kind = e.target.value; load(); });
  $("#tk-mine", el).addEventListener("change", (e) => { mine = e.target.checked; load(); });
  await load();
}
