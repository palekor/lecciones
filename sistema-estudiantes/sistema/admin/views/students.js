/* Estudiantes — Módulo 5: seguimiento académico y comercial */
import { q } from "../../api.js";
import { label } from "../../i18n.js";
import { STUDENT_STATUSES, countryName, countryList, normalizePhone, isValidEmail, normalizeEmail } from "../../core.js";
import { $, html, raw, mount, toast } from "../../ui.js";
import { S, d, dt, isOverdue } from "../state.js";
import { badge, exportCSV, safeTerm, selectOptions, openDialog, userError, apiErrorText } from "../widgets.js";

const PAGE = 50;

function buildQuery(c, f, all = false) {
  let qb = c.from("sms_students_v").select("*").is("anonymized_at", null);
  if (f.status && f.status !== "all") qb = qb.eq("status", f.status);
  if (f.f === "renewals") {
    const today = new Date().toISOString().slice(0, 10);
    const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    qb = qb.eq("status", "active").gte("plan_renews_at", today).lte("plan_renews_at", week);
  }
  if (f.f === "overdue") qb = qb.gt("payments_overdue", 0);
  if (f.plan) qb = qb.eq("plan_id", f.plan);
  const t = safeTerm(f.q);
  if (t) qb = qb.or(`full_name.ilike.*${t}*,email.ilike.*${t}*`);
  qb = f.sort === "name" ? qb.order("full_name") : f.sort === "renewal" ? qb.order("plan_renews_at", { ascending: true, nullsFirst: false }) : qb.order("updated_at", { ascending: false });
  return all ? qb.limit(5000) : qb.range(f.offset, f.offset + PAGE - 1);
}

const CSV = [
  { label: "Nombre", key: "full_name" }, { label: "Correo", key: "email" }, { label: "WhatsApp", key: "whatsapp" },
  { label: "País", value: (r) => countryName(r.country) }, { label: "Estado", value: (r) => label("student", r.status) },
  { label: "Plan", key: "plan_name" }, { label: "Inicio del plan", key: "plan_started_at" }, { label: "Renovación", key: "plan_renews_at" },
  { label: "Paso actual", key: "current_step" }, { label: "Pasos completados", key: "steps_completed" },
  { label: "Sesiones realizadas", key: "sessions_completed" }, { label: "Próxima sesión", value: (r) => dt(r.next_session_at) },
  { label: "Próximo seguimiento", value: (r) => dt(r.next_follow_up_at) }, { label: "Nivel", value: (r) => label("level", r.english_level) },
  { label: "Objetivo", value: (r) => label("objective", r.objective) }
];

export async function render(el, params, ctx) {
  const f = { status: params.f ? "all" : (params.status || "active"), f: params.f || "", plan: "", q: "", sort: "recent", offset: 0 };
  let rows = [];
  const steps = S.steps.filter((s) => s.active).length;

  mount(el, html`
    ${params.f === "renewals" ? html`<p class="form-alert info">Mostrando estudiantes activos que renuevan en los próximos 7 días. <a href="#/estudiantes">Ver todos</a></p>` : ""}
    ${params.f === "overdue" ? html`<p class="form-alert info">Mostrando estudiantes con pagos vencidos. <a href="#/estudiantes">Ver todos</a></p>` : ""}
    <div class="filters" role="group" aria-label="Filtrar por estado">
      ${[...STUDENT_STATUSES.map((s) => [s, label("student", s)]), ["all", "Todos"]].map(([v, t]) =>
        html`<button class="filter-chip" type="button" data-status="${v}" aria-pressed="${f.status === v}">${t}</button>`)}
    </div>
    <form class="toolbar" id="st-filters" role="search">
      <input class="input search" name="q" type="search" placeholder="Buscar por nombre o correo" aria-label="Buscar">
      <select class="input" name="plan" aria-label="Plan">${selectOptions(S.plans.map((p) => ({ value: p.id, label: p.name })), "", { empty: "Todos los planes" })}</select>
      <select class="input" name="sort" aria-label="Ordenar">${selectOptions([{ value: "recent", label: "Actividad reciente" }, { value: "name", label: "Nombre" }, { value: "renewal", label: "Próxima renovación" }], "recent")}</select>
      <button class="btn btn-soft" type="button" id="csv">Exportar CSV</button>
      <button class="btn btn-primary" type="button" id="new">Nuevo estudiante</button>
    </form>
    <div class="rows" id="rows"></div>`);

  const list = $("#rows", el);
  async function load(reset = true) {
    if (reset) { f.offset = 0; rows = []; }
    const res = await q((c) => buildQuery(c, f));
    rows = reset ? res : rows.concat(res);
    mount(list, rows.length ? html`
      <div class="row head" style="--cols: 2fr 1fr 1.2fr 1.4fr 1.2fr"><span>Estudiante</span><span>Estado</span><span>Plan</span><span>Ruta</span><span>Próxima sesión</span></div>
      ${rows.map((r) => html`<a class="row" href="#/persona/${r.id}" style="--cols: 2fr 1fr 1.2fr 1.4fr 1.2fr">
        <span class="name">${r.full_name}${r.payments_overdue ? html`<span class="flag err">Pago vencido</span>` : ""}<span class="sub">${r.email}</span></span>
        ${badge("student", r.status)}
        <span><span class="cell-label">Plan:</span>${r.plan_name || "—"}${r.plan_renews_at ? html`<span class="sub ${isOverdue(r.plan_renews_at + "T23:59:59") ? "overdue" : ""}">Renueva ${d(r.plan_renews_at + "T12:00:00")}</span>` : ""}</span>
        <span><span class="cell-label">Ruta:</span>${r.steps_completed}/${steps} pasos
          <span class="progress-bar" style="display:block;margin-top:4px;max-width:160px"><i style="width:${steps ? (100 * r.steps_completed / steps).toFixed(0) : 0}%"></i></span></span>
        <span><span class="cell-label">Próxima:</span>${r.next_session_at ? dt(r.next_session_at) : "—"}</span>
      </a>`)}
      ${res.length === PAGE ? html`<button class="more" type="button" id="more">Cargar más</button>` : ""}`
      : html`<div class="empty-state"><b>No hay estudiantes con estos filtros.</b>Convierte un lead desde su ficha o crea uno con “Nuevo estudiante”.</div>`);
    const more = $("#more", el);
    if (more) more.addEventListener("click", () => { f.offset += PAGE; load(false); });
  }

  const form = $("#st-filters", el);
  let timer;
  form.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { f.q = form.elements.q.value; f.plan = form.elements.plan.value; f.sort = form.elements.sort.value; load(); }, e.target.name === "q" ? 300 : 0);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  el.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => {
    f.status = b.dataset.status; f.f = "";
    el.querySelectorAll("[data-status]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load();
  }));
  $("#csv", el).addEventListener("click", async () => {
    const all = await q((c) => buildQuery(c, f, true));
    exportCSV("students", `estudiantes-${new Date().toISOString().slice(0, 10)}.csv`, all, CSV);
  });
  $("#new", el).addEventListener("click", () => {
    const { priority, rest } = countryList("es");
    openDialog({
      title: "Nuevo estudiante",
      submitLabel: "Crear ficha",
      body: html`
        <p class="small muted">Para personas que llegaron por otro canal (WhatsApp, referidos). Si ya se registró en la web, búscala en Leads para no duplicarla.</p>
        <div class="field"><label for="n-name">Nombre completo</label><input class="input" id="n-name" name="full_name" maxlength="120" required></div>
        <div class="grid2">
          <div class="field"><label for="n-email">Correo</label><input class="input" id="n-email" name="email" type="email" required></div>
          <div class="field"><label for="n-wa">WhatsApp con indicativo</label><input class="input" id="n-wa" name="whatsapp" placeholder="+57 300 123 4567"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="n-country">País</label><select class="input" id="n-country" name="country"><option value="">—</option>
            ${[...priority, ...rest].map((c) => html`<option value="${c.code}" ${raw(c.code === "CO" ? "selected" : "")}>${c.name}</option>`)}</select></div>
          <div class="field"><label for="n-status">Estado</label><select class="input" id="n-status" name="status">${selectOptions(STUDENT_STATUSES.map((s) => ({ value: s, label: label("student", s) })), "active")}</select></div>
        </div>
        <div class="field"><label for="n-plan">Plan</label><select class="input" id="n-plan" name="plan_id">${selectOptions(S.plans.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })), "", { empty: "Sin plan" })}</select></div>
        <p class="small muted">Recuerda contarle cómo tratamos sus datos y enviarle la política: ${S.settings.privacy_policy_url || ""}</p>`,
      onSubmit: async (fm) => {
        const v = (n) => fm.elements[n].value.trim();
        if (v("full_name").length < 2) throw userError("Escribe el nombre completo.");
        if (!isValidEmail(v("email"))) throw userError("Revisa el correo.");
        const wa = v("whatsapp") ? normalizePhone(v("whatsapp")) : null;
        if (v("whatsapp") && !wa) throw userError("El WhatsApp debe incluir indicativo.");
        const email = normalizeEmail(v("email"));
        const exists = await q((c) => c.from("sms_students").select("id,full_name").eq("email", email).maybeSingle());
        if (exists) throw userError(`Ya existe una ficha con ese correo: ${exists.full_name}.`);
        const status = v("status");
        const rowsIns = await q((c) => c.from("sms_students").insert({
          full_name: v("full_name").replace(/\s+/g, " "), email, whatsapp: wa, country: v("country") || null,
          status, plan_id: v("plan_id") || null, source: "admin",
          plan_started_at: status === "active" ? new Date().toISOString().slice(0, 10) : null,
          converted_at: status === "active" ? new Date().toISOString() : null
        }).select("id"));
        toast("Ficha creada.", "ok");
        location.hash = "#/persona/" + rowsIns[0].id;
      }
    });
  });
  await load();
}
