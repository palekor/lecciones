/* Leads (directorio de contactos) y lista de espera — Módulo 2 */
import { q, rpc } from "../../api.js";
import { label, options } from "../../i18n.js";
import { LEAD_STATUSES, OPEN_LEAD_STATUSES, URGENCIES, DAYS, TIMES, countryName, countryList, waLink, fillTemplate, zonedLocalToISO } from "../../core.js";
import { $, html, raw, mount, toast } from "../../ui.js";
import { S, d, dt, relative, isOverdue } from "../state.js";
import { badge, exportCSV, safeTerm, selectOptions, availabilityText, apiErrorText, confirmDialog, openDialog, userError } from "../widgets.js";

const PAGE = 50;
const COLS = "1.7fr 1.1fr 1.2fr .9fr 1fr 1.1fr 1.1fr";

function buildQuery(c, f, { all = false } = {}) {
  let qb = c.from("sms_leads_v").select("*");
  if (f.mode === "waitlist") qb = qb.eq("status", "waitlist");
  else if (f.status === "attention") qb = qb.eq("needs_attention", true);
  else if (f.status === "open" || !f.status) qb = qb.in("status", OPEN_LEAD_STATUSES);
  else if (f.status !== "all") qb = qb.eq("status", f.status);
  const t = safeTerm(f.q);
  if (t) qb = qb.or(`full_name.ilike.*${t}*,email.ilike.*${t}*,whatsapp.ilike.*${t.replace(/\D/g, "") || t}*`);
  if (f.objective) qb = qb.eq("objective", f.objective);
  if (f.urgency) qb = qb.eq("urgency", f.urgency);
  if (f.day) qb = qb.contains("availability", { days: [f.day] });
  if (f.time) qb = qb.contains("availability", { times: [f.time] });
  if (f.from) qb = qb.gte("registered_at", zonedLocalToISO(f.from + "T00:00", S.tz));
  if (f.to) qb = qb.lt("registered_at", new Date(new Date(zonedLocalToISO(f.to + "T00:00", S.tz)).getTime() + 86400000).toISOString());
  if (f.mode === "waitlist") qb = qb.order("waitlist_position", { ascending: true });
  else if (f.sort === "oldest") qb = qb.order("registered_at", { ascending: true });
  else if (f.sort === "followup") qb = qb.order("next_follow_up_at", { ascending: true, nullsFirst: false });
  else if (f.sort === "last_contact") qb = qb.order("last_contact_at", { ascending: true, nullsFirst: true });
  else if (f.sort === "expected") qb = qb.order("expected_start", { ascending: true, nullsFirst: false });
  else if (f.sort === "priority") qb = qb.order("priority_boost", { ascending: false }).order("registered_at", { ascending: true });
  else qb = qb.order("registered_at", { ascending: false });
  return all ? qb.limit(5000) : qb.range(f.offset || 0, (f.offset || 0) + PAGE - 1);
}

const CSV_COLUMNS = [
  { label: "Nombre", key: "full_name" }, { label: "Correo", key: "email" }, { label: "WhatsApp", key: "whatsapp" },
  { label: "País", value: (r) => countryName(r.country) }, { label: "Zona horaria", key: "timezone" }, { label: "Ocupación", key: "occupation" },
  { label: "Estado", value: (r) => label("lead", r.status) }, { label: "Posición lista", key: "waitlist_position" }, { label: "Prioridad manual", key: "priority_boost" },
  { label: "Urgencia", value: (r) => label("urgency", r.urgency) }, { label: "Incorporación estimada", key: "expected_start" },
  { label: "Nivel", value: (r) => label("level", r.english_level) }, { label: "Objetivo", value: (r) => label("objective", r.objective) },
  { label: "Formato", value: (r) => label("format", r.preferred_format) }, { label: "Disponibilidad", value: (r) => availabilityText(r.availability) },
  { label: "Fuente", key: "source" }, { label: "Registro", value: (r) => dt(r.registered_at) },
  { label: "Último contacto", value: (r) => dt(r.last_contact_at) }, { label: "Próximo seguimiento", value: (r) => dt(r.next_follow_up_at) },
  { label: "Próxima acción", key: "next_action" }, { label: "Próxima sesión", value: (r) => dt(r.next_session_at) },
  { label: "Marketing autorizado", value: (r) => (r.consent_marketing ? "Sí" : "No") }
];

function waiting(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return days < 1 ? "Esperando desde hoy" : `Esperando ${days} día${days === 1 ? "" : "s"}`;
}

function flags(r) {
  return html`${r.possible_duplicate_of ? html`<span class="flag">Posible duplicado</span>` : ""}${r.needs_review ? html`<span class="flag">Revisar</span>` : ""}${r.needs_attention ? html`<span class="flag err">Atención</span>` : ""}`;
}

function rowHTML(r, mode) {
  if (mode === "waitlist") {
    return html`<div class="row" style="--cols: 46px 1.6fr 1.4fr 1.2fr 150px">
      <b style="font-size:20px;color:var(--plum)">${r.waitlist_position}</b>
      <a class="name" href="#/persona/${r.student_id}" style="color:inherit;text-decoration:none">${r.full_name}${flags(r)}
        <span class="sub">${waiting(r.waitlist_joined_at || r.registered_at)} · registro ${d(r.registered_at)}</span></a>
      <span><span class="cell-label">Busca:</span>${label("objective", r.objective)}<span class="sub">${[label("format", r.preferred_format), r.urgency ? "Urgencia: " + label("urgency", r.urgency) : "", r.expected_start ? "Incorporación: " + d(r.expected_start + "T12:00:00") : ""].filter(Boolean).join(" · ")}</span></span>
      <span class="small"><span class="cell-label">Disponible:</span>${availabilityText(r.availability) || "—"}</span>
      <span style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-soft btn-sm" type="button" data-prio="${r.id}" data-delta="1" aria-label="Subir prioridad de ${r.full_name}" title="Subir prioridad">▲</button>
        <button class="btn btn-soft btn-sm" type="button" data-prio="${r.id}" data-delta="-1" aria-label="Bajar prioridad de ${r.full_name}" title="Bajar prioridad">▼</button>
        ${r.whatsapp ? html`<button class="btn btn-primary btn-sm" type="button" data-invite="${r.id}">Invitar</button>` : ""}
      </span>
    </div>`;
  }
  const fu = r.next_follow_up_at ? html`<span class="${isOverdue(r.next_follow_up_at) ? "overdue" : ""}"><span class="cell-label">Seguimiento:</span>${dt(r.next_follow_up_at)}</span>` : html`<span class="muted hide-sm">—</span>`;
  return html`<a class="row" href="#/persona/${r.student_id}" style="--cols: ${COLS}">
    <span class="name">${r.full_name}${flags(r)}<span class="sub">${r.email}</span><span class="sub">${r.whatsapp || ""}</span></span>
    ${badge("lead", r.status)}
    <span><span class="cell-label">Objetivo:</span>${label("objective", r.objective) || "—"}<span class="sub">${[label("level", r.english_level), countryName(r.country)].filter(Boolean).join(" · ")}</span></span>
    <span><span class="cell-label">Registro:</span>${d(r.registered_at)}</span>
    <span><span class="cell-label">Último contacto:</span>${r.last_contact_at ? relative(r.last_contact_at) : html`<span class="muted">Nunca</span>`}</span>
    ${fu}
    <span><span class="cell-label">Próxima sesión:</span>${r.next_session_at ? dt(r.next_session_at) : html`<span class="muted hide-sm">—</span>`}</span>
  </a>`;
}

function addContactDialog(onDone) {
  const { priority, rest } = countryList("es");
  openDialog({
    title: "Agregar contacto",
    submitLabel: "Agregar",
    body: html`
      <p class="small muted" style="margin-top:0">Para personas que te escribieron por WhatsApp, redes o referidos. Queda como lead, sin crear duplicados.</p>
      <div class="field"><label for="ac-name">Nombre completo</label><input class="input" id="ac-name" name="full_name" maxlength="120" required></div>
      <div class="grid2">
        <div class="field"><label for="ac-email">Correo</label><input class="input" id="ac-email" name="email" type="email" required></div>
        <div class="field"><label for="ac-wa">WhatsApp con indicativo</label><input class="input" id="ac-wa" name="whatsapp" placeholder="+57 300 123 4567"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="ac-country">País</label><select class="input" id="ac-country" name="country"><option value="">—</option>
          ${[...priority, ...rest].map((c) => html`<option value="${c.code}" ${raw(c.code === "CO" ? "selected" : "")}>${c.name}</option>`)}</select></div>
        <div class="field"><label for="ac-status">Estado inicial</label><select class="input" id="ac-status" name="lead_status">
          ${selectOptions(["contacted", "awaiting_response", "contact_pending", "new", "waitlist"].map((s) => ({ value: s, label: label("lead", s) })), "contacted")}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="ac-obj">Objetivo</label><select class="input" id="ac-obj" name="objective">${selectOptions(options("objective"), "", { empty: "—" })}</select></div>
        <div class="field"><label for="ac-level">Nivel</label><select class="input" id="ac-level" name="english_level">${selectOptions(options("level"), "", { empty: "—" })}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="ac-urg">Urgencia</label><select class="input" id="ac-urg" name="urgency">${selectOptions(options("urgency"), "", { empty: "—" })}</select></div>
        <div class="field"><label for="ac-occ">Ocupación</label><input class="input" id="ac-occ" name="occupation" maxlength="120"></div>
      </div>
      <div class="field"><label for="ac-note">Nota <span class="opt">(opcional)</span></label><textarea class="input" id="ac-note" name="note" maxlength="2000"></textarea></div>
      <p class="small muted">Recuerda informarle cómo tratamos sus datos (enlace de la política en Ajustes) antes de guardar información adicional.</p>`,
    onSubmit: async (f) => {
      const v = (n) => f.elements[n].value.trim();
      const r = await rpc("sms_admin_create_contact", { p: {
        full_name: v("full_name"), email: v("email"), whatsapp: v("whatsapp"), country: v("country"), lead_status: v("lead_status"),
        objective: v("objective"), english_level: v("english_level"), urgency: v("urgency"), occupation: v("occupation"), note: v("note")
      } });
      if (r && r.ok) { toast("Contacto agregado.", "ok"); onDone(r.student_id); return; }
      const e = (r && r.errors) || {};
      if (e.email === "duplicate") {
        const go = await confirmDialog({ title: "Ya existe", text: "Ya hay una ficha con ese correo. ¿Quieres abrirla?", confirmLabel: "Abrir ficha" });
        if (go) location.hash = "#/persona/" + r.student_id;
        return false;
      }
      const msgs = { full_name: "Escribe el nombre completo.", email: "Revisa el correo.", whatsapp: "El WhatsApp debe incluir indicativo.", country: "País inválido." };
      throw userError(Object.keys(e).map((k) => msgs[k] || "Revisa: " + k).join(" "));
    }
  });
}

export async function render(el, params, ctx) {
  const mode = params.mode === "waitlist" ? "waitlist" : "all";
  const f = { mode, status: params.status || (mode === "waitlist" ? "waitlist" : "open"), q: params.q || "", objective: "", urgency: "", day: "", time: "", from: "", to: "", sort: params.sort || "recent", offset: 0 };
  let rows = [];
  const dash = await rpc("sms_dashboard");
  const pipe = dash.pipeline || {};
  if (!ctx.isCurrent()) return;

  const order = S.settings.waitlist_order === "joined" ? "fecha de ingreso a la lista" : "fecha de registro";
  mount(el, html`
    ${mode === "waitlist" ? html`<div class="panel" style="margin-bottom:14px">
      <b>Política de orden:</b> primero la <b>prioridad manual</b> (▲ ▼, mayor primero) y luego la <b>${order}</b> (más antiguo primero).
      ${S.isAdmin ? html`<a href="#/ajustes?s=waitlist">Cambiar política</a>` : ""}
      <span class="muted small" style="display:block;margin-top:4px">Esta misma regla define la posición que ve cada persona al unirse. La prioridad es manual y transparente; nunca se calcula a partir de características personales.</span>
    </div>` : html`<div class="filters" role="group" aria-label="Filtrar por estado">
      ${[["open", "Abiertos", OPEN_LEAD_STATUSES.reduce((a, s) => a + (pipe[s] || 0), 0)], ["attention", "Necesitan atención", null],
         ...LEAD_STATUSES.map((s) => [s, label("lead", s), pipe[s] || 0]), ["all", "Todos", Object.values(pipe).reduce((a, b) => a + b, 0)]]
        .map(([v, t, n]) => html`<button class="filter-chip" type="button" data-status="${v}" aria-pressed="${f.status === v}">${t}${n !== null ? html`<span class="n">${n}</span>` : ""}</button>`)}
    </div>`}
    <form class="toolbar" id="lead-filters" role="search">
      <input class="input search" name="q" type="search" placeholder="Buscar por nombre, correo o WhatsApp" value="${f.q}" aria-label="Buscar">
      <select class="input" name="objective" aria-label="Objetivo">${selectOptions(options("objective"), "", { empty: "Todos los objetivos" })}</select>
      <select class="input" name="urgency" aria-label="Urgencia">${selectOptions(options("urgency"), "", { empty: "Cualquier urgencia" })}</select>
      <select class="input" name="day" aria-label="Día disponible">${selectOptions(DAYS.map((x) => ({ value: x, label: "Disponible " + label("day", x) })), "", { empty: "Cualquier día" })}</select>
      <select class="input" name="time" aria-label="Franja disponible">${selectOptions(TIMES.map((x) => ({ value: x, label: label("time", x) })), "", { empty: "Cualquier franja" })}</select>
      <input class="input" name="from" type="date" aria-label="Registrados desde">
      <input class="input" name="to" type="date" aria-label="Registrados hasta">
      ${mode === "waitlist" ? "" : html`<select class="input" name="sort" aria-label="Ordenar">
        ${selectOptions([{ value: "recent", label: "Más recientes" }, { value: "oldest", label: "Más antiguos" }, { value: "followup", label: "Próximo seguimiento" },
          { value: "last_contact", label: "Último contacto (más antiguo)" }, { value: "expected", label: "Incorporación estimada" }, { value: "priority", label: "Prioridad" }], f.sort)}
      </select>`}
      <button class="btn btn-soft" type="button" id="csv">Exportar CSV</button>
      ${mode === "waitlist" ? "" : html`<button class="btn btn-primary" type="button" id="add-contact">Agregar contacto</button>`}
    </form>
    <p class="small muted" id="total" aria-live="polite"></p>
    <div class="rows" id="rows"></div>`);

  const list = $("#rows", el);
  async function load(reset = true) {
    if (reset) { f.offset = 0; rows = []; mount(list, html`<div class="loading" style="padding:16px"><span class="spinner"></span> Cargando…</div>`); }
    const res = await q((c) => buildQuery(c, f));
    rows = reset ? res : rows.concat(res);
    const head = mode === "waitlist"
      ? html`<div class="row head" style="--cols: 46px 1.6fr 1.4fr 1.2fr 150px"><span>#</span><span>Persona</span><span>Busca</span><span>Disponibilidad</span><span></span></div>`
      : html`<div class="row head" style="--cols: ${COLS}"><span>Persona</span><span>Estado</span><span>Objetivo y nivel</span><span>Registro</span><span>Último contacto</span><span>Seguimiento</span><span>Próxima sesión</span></div>`;
    mount(list, rows.length
      ? html`${head}${rows.map((r) => rowHTML(r, mode))}${res.length === PAGE ? html`<button class="more" type="button" id="more">Cargar más</button>` : ""}`
      : html`<div class="empty-state"><b>${mode === "waitlist" ? "La lista de espera está vacía." : "No hay leads con estos filtros."}</b>
          ${mode === "waitlist" ? "Quienes se unan desde /lista-de-espera o desde la confirmación del registro aparecerán aquí." : "Prueba con otro estado o borra la búsqueda."}</div>`);
    $("#total", el).textContent = rows.length ? `${rows.length}${res.length === PAGE ? "+" : ""} resultado${rows.length === 1 ? "" : "s"}` : "";
    const more = $("#more", el);
    if (more) more.addEventListener("click", () => { f.offset += PAGE; load(false); });
  }

  const form = $("#lead-filters", el);
  let timer;
  form.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const k of ["q", "objective", "urgency", "day", "time", "from", "to"]) f[k] = form.elements[k].value;
      if (form.elements.sort) f.sort = form.elements.sort.value;
      load();
    }, e.target.name === "q" ? 300 : 0);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  el.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => {
    f.status = b.dataset.status;
    el.querySelectorAll("[data-status]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load();
  }));
  $("#csv", el).addEventListener("click", async () => {
    const all = await q((c) => buildQuery(c, f, { all: true }));
    exportCSV(mode === "waitlist" ? "waitlist" : "leads", `${mode === "waitlist" ? "lista-de-espera" : "leads"}-${new Date().toISOString().slice(0, 10)}.csv`, all, CSV_COLUMNS);
  });
  const add = $("#add-contact", el);
  if (add) add.addEventListener("click", () => addContactDialog((id) => { ctx.refreshCounts(); location.hash = "#/persona/" + id; }));

  // Acciones de la lista de espera
  list.addEventListener("click", async (e) => {
    const pb = e.target.closest("[data-prio]");
    if (pb) {
      const r = rows.find((x) => x.id === pb.dataset.prio);
      const next = Math.max(-100, Math.min(100, (r.priority_boost || 0) + Number(pb.dataset.delta)));
      try {
        await q((c) => c.from("sms_leads").update({ priority_boost: next }).eq("id", r.id));
        toast(`Prioridad de ${r.full_name}: ${next}`, "ok");
        load();
      } catch (err) { toast(apiErrorText(err), "err"); }
      return;
    }
    const ib = e.target.closest("[data-invite]");
    if (ib) {
      const r = rows.find((x) => x.id === ib.dataset.invite);
      const link = new URL("../reservar/", location.href).href;
      const text = fillTemplate(S.settings.wa_templates && S.settings.wa_templates.invite, { nombre: (r.full_name || "").split(" ")[0], link });
      window.open(waLink(r.whatsapp, text), "_blank", "noopener");
      const ok = await confirmDialog({ title: "¿Enviaste la invitación?", text: `Si enviaste el mensaje a ${r.full_name}, marcamos el lead como "${label("lead", "invitation_sent")}" y sale de la lista.`, confirmLabel: "Sí, marcar como enviada" });
      if (!ok) return;
      try {
        await q((c) => c.from("sms_leads").update({ status: "invitation_sent" }).eq("id", r.id));
        await q((c) => c.from("sms_activity").insert({ student_id: r.student_id, lead_id: r.id, kind: "contact", summary: "Invitación a reservar enviada por WhatsApp", data: { channel: "whatsapp" } }));
        toast("Invitación registrada.", "ok");
        ctx.refreshCounts();
        load();
      } catch (err) { toast(apiErrorText(err), "err"); }
    }
  });

  await load();
}
