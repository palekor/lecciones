/* Ficha de persona — leads, estudiante, historial, sesiones, progreso, pagos y privacidad (Módulos 2–5) */
import { q, rpc } from "../../api.js";
import { label, options } from "../../i18n.js";
import {
  LEAD_STATUSES, STUDENT_STATUSES, LEVELS, OBJECTIVES, FORMATS, CONTACTS, DAYS, TIMES, PROGRESS_STATUSES, URGENCIES, SKILLS, CEFR,
  countryName, countryList, timeZones, waLink, fillTemplate, zonedLocalToISO, isoToZonedLocal, normalizePhone, isValidEmail, normalizeEmail
} from "../../core.js";
import { $, $$, html, raw, mount, toast, download } from "../../ui.js";
import { S, dt, d, tm, relative, isOverdue, money, staffName, sessionName } from "../state.js";
import { badge, openDialog, confirmDialog, userError, selectOptions, availabilityText, apiErrorText } from "../widgets.js";
import { bookingDialog, bookingButtons, bookingAction, paymentDialog, contactDialog, taskDialog, assessmentDialog } from "../forms.js";
import { taskItem, bindTaskList } from "./tasks.js";
import { journalTab, accessState, mainCode, presence } from "./journal.js";

const opt = (group, list) => list.map((v) => ({ value: v, label: label(group, v) }));
const SOURCES = { register: "formulario de registro", registro: "formulario de registro", waitlist: "formulario de lista de espera",
  lista_espera: "lista de espera", booking: "reserva web", reserva: "reserva web", admin: "creada en el panel", panel: "abierto en el panel" };
const sourceLabel = (s) => (s ? SOURCES[s] || "fuente: " + s : "—");
const CLOSED = ["converted", "not_interested", "archived"];

export async function render(el, params, ctx) {
  const id = params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) { mount(el, html`<div class="empty-state"><b>Ficha no encontrada.</b></div>`); return; }
  let tab = params.tab || "resumen";
  let data;

  async function load() {
    const [stu, leads, activity, bookings, progress, consents, payments, assessments, tasks, codes, journal] = await Promise.all([
      q((c) => c.from("sms_students_v").select("*").eq("id", id).maybeSingle()),
      q((c) => c.from("sms_leads").select("*").eq("student_id", id).order("registered_at", { ascending: false })),
      q((c) => c.from("sms_activity").select("*").eq("student_id", id).order("created_at", { ascending: false }).limit(200)),
      q((c) => c.from("sms_bookings").select("*").eq("student_id", id).order("starts_at", { ascending: false })),
      q((c) => c.from("sms_progress").select("*").eq("student_id", id)),
      q((c) => c.from("sms_consents").select("*").eq("student_id", id).order("created_at", { ascending: false })),
      S.isAdmin ? q((c) => c.from("sms_payments").select("*").eq("student_id", id).order("created_at", { ascending: false })) : Promise.resolve([]),
      q((c) => c.from("sms_assessments").select("*").eq("student_id", id).order("assessed_on", { ascending: false }).order("created_at", { ascending: false })),
      q((c) => c.from("sms_tasks").select("*").eq("student_id", id).order("due_at")),
      // Si el SQL v1.2 aún no se ejecutó, la ficha funciona igual (sin journal).
      q((c) => c.from("sms_access_codes").select("*").eq("student_id", id).order("created_at", { ascending: false })).catch(() => []),
      q((c) => c.from("sms_journal").select("*").eq("student_id", id).maybeSingle()).catch(() => null)
    ]);
    let dup = null;
    if (stu && stu.possible_duplicate_of) {
      dup = await q((c) => c.from("sms_students").select("id,full_name,email,whatsapp").eq("id", stu.possible_duplicate_of).maybeSingle());
    }
    data = { stu, leads, activity, bookings, progress, consents, payments, assessments, tasks, codes, journal, dup, openLead: leads.find((l) => !CLOSED.includes(l.status)) || null };
  }

  async function refresh(keepTab = true) {
    await load();
    if (!ctx.isCurrent()) return;
    paint(keepTab);
  }

  function paint() {
    const { stu } = data;
    if (!stu) { mount(el, html`<div class="empty-state"><b>Esta ficha no existe o fue fusionada.</b><a href="#/leads">Volver a leads</a></div>`); return; }
    ctx.setTitle("Ficha");
    document.title = stu.full_name + " · Panel ProfGermandario";
    const first = stu.full_name.split(" ")[0];
    const steps = S.steps.filter((s) => s.active);
    const done = data.progress.filter((p) => p.status === "completed").length;
    const code = mainCode(data.codes), acc = accessState(code), pr = presence(data.journal);
    mount(el, html`
      <div class="person-head">
        <div>
          <h2>${stu.full_name}</h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            ${badge("student", stu.status)}
            ${data.openLead ? badge("lead", data.openLead.status) : ""}
            ${stu.plan_name ? html`<span class="badge">${stu.plan_name}</span>` : ""}
            ${stu.anonymized_at ? html`<span class="flag err">Datos eliminados</span>` : ""}
            ${acc ? html`<button class="badge ${acc.cls}" type="button" data-goto="journal" title="${acc.line}" style="border:0;cursor:pointer">Acceso: ${acc.label.toLowerCase()}</button>` : ""}
            ${pr ? html`<button class="badge ${pr.on ? "b-active" : ""}" type="button" data-goto="journal" style="border:0;cursor:pointer">${pr.text}</button>` : ""}
          </div>
        </div>
        <div class="actions">
          ${stu.whatsapp ? html`<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="${waLink(stu.whatsapp, "Hola " + first + ", ")}">WhatsApp</a>` : ""}
          ${stu.email && !stu.anonymized_at ? html`<a class="btn btn-soft btn-sm" href="mailto:${stu.email}">Correo</a>` : ""}
          ${stu.whatsapp ? html`<a class="btn btn-soft btn-sm" href="tel:${stu.whatsapp}">Llamar</a>` : ""}
          <button class="btn btn-soft btn-sm" type="button" data-act="contact">Registrar contacto</button>
          <button class="btn btn-dark btn-sm" type="button" data-goto="journal">🔑 Acceso al journal</button>
        </div>
      </div>
      ${data.dup ? html`<div class="form-alert info" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
          Posible duplicado de <a href="#/persona/${data.dup.id}">${data.dup.full_name} (${data.dup.email})</a>: comparten el WhatsApp.
          <span style="flex:1"></span>
          ${S.isAdmin ? html`<button class="btn btn-dark btn-sm" type="button" data-act="merge">Fusionar en esa ficha</button>` : ""}
          <button class="btn btn-soft btn-sm" type="button" data-act="notdup">No es la misma persona</button></div>` : ""}
      ${stu.needs_review && !data.dup ? html`<div class="form-alert info" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
          Un formulario reciente trajo datos distintos a los de esta ficha. Revísalos en el historial (no se sobrescribió nada).
          <span style="flex:1"></span><button class="btn btn-soft btn-sm" type="button" data-act="reviewed">Marcar como revisado</button></div>` : ""}
      <div class="tabs" role="tablist">
        ${[["resumen", "Resumen"], ["historial", `Historial (${data.activity.length})`], ["sesiones", `Sesiones (${data.bookings.length})`],
           ["progreso", `Progreso (${done}/${steps.length})`], ["evaluaciones", `Evaluaciones (${data.assessments.length})`],
           ["tareas", `Tareas (${data.tasks.filter((t) => t.status === "open").length})`], ["journal", "Journal"],
           ...(S.isAdmin ? [["pagos", `Pagos (${data.payments.length})`]] : []), ["privacidad", "Privacidad"]]
          .map(([k, t]) => html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`)}
      </div>
      <div id="tab-body"></div>`);
    paintTab();
    $$("[data-tab]", el).forEach((b) => b.addEventListener("click", () => {
      tab = b.dataset.tab;
      $$("[data-tab]", el).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      paintTab();
    }));
    $$("[data-goto]", el).forEach((b) => b.addEventListener("click", () => {
      const t = $(`[data-tab="${b.dataset.goto}"]`, el); if (t) t.click();
    }));
  }

  function paintTab() {
    // Contenedor nuevo en cada pestaña: evita acumular manejadores de eventos.
    const old = $("#tab-body", el);
    const body = old.cloneNode(false);
    old.replaceWith(body);
    const journal = (b) => journalTab(b, { stu: data.stu, codes: data.codes, journal: data.journal }, () => refresh(), ctx.isCurrent).catch((e) => toast(apiErrorText(e), "err"));
    ({ resumen, historial, sesiones, progreso, evaluaciones, tareas, journal, pagos, privacidad })[tab](body);
  }

  /* ---------- Resumen ---------- */
  function resumen(body) {
    const { stu, openLead: L } = data;
    const staffOpts = S.staff.filter((s) => s.active).map((s) => ({ value: s.user_id, label: s.display_name || s.email }));
    const planOpts = S.plans.map((p) => ({ value: p.id, label: p.name + (p.active ? "" : " (inactivo)") }));
    const extra = Object.entries(stu.extra_answers || {});
    const qLabel = (k) => ((S.settings.extra_questions || []).find((x) => x.id === k) || {}).label || k;
    mount(body, html`<div class="cols">
      <section class="panel">
        <h2>Proceso comercial</h2>
        ${L ? html`<form class="inline-form" id="lead-form">
            <div class="field"><label for="l-status">Estado del lead</label>
              <select class="input" id="l-status" name="status">${selectOptions(opt("lead", LEAD_STATUSES), L.status)}</select></div>
            <div class="grid2">
              <div class="field"><label for="l-fu">Próximo seguimiento</label>
                <input class="input" id="l-fu" name="next_follow_up_at" type="datetime-local" value="${isoToZonedLocal(L.next_follow_up_at, S.tz)}"></div>
              <div class="field"><label for="l-as">Responsable</label>
                <select class="input" id="l-as" name="assigned_to">${selectOptions(staffOpts, L.assigned_to, { empty: "Sin asignar" })}</select></div>
            </div>
            <div class="grid2">
              <div class="field"><label for="l-urg">Urgencia declarada</label>
                <select class="input" id="l-urg" name="urgency">${selectOptions(opt("urgency", URGENCIES), L.urgency, { empty: "Sin dato" })}</select></div>
              <div class="field"><label for="l-exp">Incorporación estimada</label>
                <input class="input" id="l-exp" name="expected_start" type="date" value="${L.expected_start || ""}"></div>
            </div>
            <div class="field"><label for="l-next">Próxima acción</label>
              <input class="input" id="l-next" name="next_action" maxlength="300" value="${L.next_action || ""}" placeholder="Ej.: enviarle precios del plan Impulso"></div>
            ${L.status === "waitlist" ? html`<div class="field"><label for="l-pr">Prioridad manual en la lista (−100 a 100)</label>
              <input class="input" id="l-pr" name="priority_boost" type="number" min="-100" max="100" value="${L.priority_boost}"></div>` : ""}
            <p class="small muted" style="margin:0">Registrado ${dt(L.registered_at)} (${sourceLabel(L.source)}) · último contacto: ${L.last_contact_at ? relative(L.last_contact_at) : "ninguno"}
              ${L.next_follow_up_at && isOverdue(L.next_follow_up_at) ? html` · <span class="overdue">seguimiento vencido</span>` : ""}</p>
            <div class="btn-row">
              <button class="btn btn-dark btn-sm" type="submit">Guardar</button>
              ${stu.whatsapp ? html`<button class="btn btn-soft btn-sm" type="button" data-act="invite">Invitar por WhatsApp</button>` : ""}
              <button class="btn btn-primary btn-sm" type="button" data-act="convert">Convertir en estudiante</button>
            </div>
          </form>`
        : html`<p class="muted">No hay un proceso abierto${stu.status === "active" ? ": ya es estudiante activo." : "."}</p>
          ${stu.status !== "active" ? html`<button class="btn btn-soft btn-sm" type="button" data-act="newlead">Abrir nuevo proceso</button>` : ""}`}
        ${data.leads.filter((l) => l !== L).length ? html`<p class="small muted" style="margin:14px 0 0">Procesos anteriores: ${data.leads.filter((l) => l !== L).map((l) => `${label("lead", l.status)} (${d(l.registered_at)})`).join(" · ")}</p>` : ""}
      </section>

      <section class="panel">
        <h2>Estudiante y plan</h2>
        <form class="inline-form" id="stu-form">
          <div class="grid2">
            <div class="field"><label for="s-status">Estado</label>
              <select class="input" id="s-status" name="status">${selectOptions(opt("student", STUDENT_STATUSES), stu.status)}</select></div>
            <div class="field"><label for="s-plan">Plan</label>
              <select class="input" id="s-plan" name="plan_id">${selectOptions(planOpts, stu.plan_id, { empty: "Sin plan" })}</select></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="s-ct">Fecha de contratación</label><input class="input" id="s-ct" name="contracted_at" type="date" value="${stu.contracted_at || ""}"></div>
            <div class="field"><label for="s-ps">Inicio del plan</label><input class="input" id="s-ps" name="plan_started_at" type="date" value="${stu.plan_started_at || ""}"></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="s-pe">Fin del plan</label><input class="input" id="s-pe" name="plan_ends_at" type="date" value="${stu.plan_ends_at || ""}"></div>
            <div class="field"><label for="s-pr">Próxima renovación</label><input class="input" id="s-pr" name="plan_renews_at" type="date" value="${stu.plan_renews_at || ""}"></div>
          </div>
          ${S.isAdmin ? html`<div class="grid2">
            <div class="field"><label for="s-ap">Precio acordado (por período)</label><input class="input" id="s-ap" name="agreed_price" type="number" min="0" step="0.01" value="${stu.agreed_price ?? ""}" placeholder="${stu.plan_price ?? ""}"></div>
            <div class="field"><label for="s-ac">Moneda</label><select class="input" id="s-ac" name="agreed_currency">${selectOptions(["USD", "COP", "EUR", "MXN"].map((c) => ({ value: c, label: c })), stu.agreed_currency || stu.plan_currency || "USD")}</select></div>
          </div>
          ${commercialSummary(stu)}` : ""}
          <div class="field"><label for="s-next">Próxima acción comercial</label>
            <input class="input" id="s-next" name="next_action" maxlength="300" value="${stu.next_action || ""}" placeholder="Ej.: ofrecer renovación con plan Dominio"></div>
          <div class="grid2">
            <div class="field"><label for="s-fu">Próximo seguimiento</label><input class="input" id="s-fu" name="next_follow_up_at" type="datetime-local" value="${isoToZonedLocal(stu.next_follow_up_at, S.tz)}"></div>
            <div class="field"><label for="s-as">Responsable</label>
              <select class="input" id="s-as" name="assigned_to">${selectOptions(staffOpts, stu.assigned_to, { empty: "Sin asignar" })}</select></div>
          </div>
          <p class="small muted" style="margin:0">Paso actual de la ruta: <b>${stu.current_step || "—"}</b> · Sesiones realizadas: <b>${stu.sessions_completed}</b>
            ${stu.next_session_at ? html` · Próxima sesión: <b>${dt(stu.next_session_at)}</b>` : ""}
            ${stu.payments_overdue ? html` · <span class="overdue">${stu.payments_overdue} pago(s) vencido(s)</span>` : ""}</p>
          <div class="btn-row"><button class="btn btn-dark btn-sm" type="submit">Guardar</button></div>
        </form>
      </section>

      <section class="panel">
        <h2>Datos y perfil <span class="spacer"></span>${stu.anonymized_at ? "" : html`<button class="btn btn-soft btn-sm" type="button" data-act="edit">Editar</button>`}</h2>
        <dl class="facts">
          <dt>Correo</dt><dd>${stu.email}</dd>
          <dt>WhatsApp</dt><dd>${stu.whatsapp || "—"}</dd>
          <dt>País</dt><dd>${countryName(stu.country) || "—"}</dd>
          <dt>Zona horaria</dt><dd>${stu.timezone ? stu.timezone.replace(/_/g, " ") : "—"}</dd>
          <dt>Ocupación</dt><dd>${stu.occupation || "—"}</dd>
          <dt>Urgencia</dt><dd>${label("urgency", stu.urgency) || "—"}</dd>
          <dt>Contacto preferido</dt><dd>${label("contact", stu.preferred_contact) || "—"}</dd>
          <dt>Nivel</dt><dd>${label("level", stu.english_level) || "—"}</dd>
          <dt>Objetivo</dt><dd>${label("objective", stu.objective) || "—"}${stu.objective_other ? ": " + stu.objective_other : ""}</dd>
          <dt>Formato</dt><dd>${label("format", stu.preferred_format) || "—"}</dd>
          <dt>Disponibilidad</dt><dd>${availabilityText(stu.availability) || "—"}${stu.availability && stu.availability.tz ? html` <span class="small muted">(${stu.availability.tz})</span>` : ""}</dd>
          <dt>Metas profesionales</dt><dd>${stu.professional_goals || "—"}</dd>
          <dt>Comentarios</dt><dd>${stu.comments || "—"}</dd>
          <dt>Cómo nos conoció</dt><dd>${stu.referral_source || "—"}</dd>
          ${extra.map(([k, v]) => html`<dt>${qLabel(k)}</dt><dd>${v === true ? "Sí" : v === false ? "No" : String(v)}</dd>`)}
          <dt>Marketing</dt><dd>${stu.consent_marketing ? "Autorizado" : "No autorizado"}</dd>
          <dt>Ficha creada</dt><dd>${dt(stu.created_at)} (${sourceLabel(stu.source)})</dd>
        </dl>
      </section>
    </div>`);

    const lf = $("#lead-form", body);
    if (lf) lf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const patch = {
        status: lf.elements.status.value,
        next_follow_up_at: lf.elements.next_follow_up_at.value ? zonedLocalToISO(lf.elements.next_follow_up_at.value, S.tz) : null,
        assigned_to: lf.elements.assigned_to.value || null,
        urgency: lf.elements.urgency.value || null,
        expected_start: lf.elements.expected_start.value || null,
        next_action: lf.elements.next_action.value.trim() || null
      };
      if (lf.elements.priority_boost) patch.priority_boost = Math.max(-100, Math.min(100, Number(lf.elements.priority_boost.value) || 0));
      if (patch.status === "converted") return convert();
      try {
        await q((c) => c.from("sms_leads").update(patch).eq("id", L.id));
        toast("Lead actualizado.", "ok");
        ctx.refreshCounts();
        refresh();
      } catch (err) { toast(apiErrorText(err), "err"); }
    });
    const sf = $("#stu-form", body);
    sf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = (n) => sf.elements[n].value;
      try {
        const patch = {
          status: v("status"), plan_id: v("plan_id") || null, plan_started_at: v("plan_started_at") || null,
          plan_renews_at: v("plan_renews_at") || null, assigned_to: v("assigned_to") || null,
          contracted_at: v("contracted_at") || null, plan_ends_at: v("plan_ends_at") || null,
          next_action: v("next_action").trim() || null,
          next_follow_up_at: v("next_follow_up_at") ? zonedLocalToISO(v("next_follow_up_at"), S.tz) : null
        };
        if (S.isAdmin) {
          patch.agreed_price = v("agreed_price") === "" ? null : Number(v("agreed_price"));
          patch.agreed_currency = v("agreed_currency") || null;
        }
        await q((c) => c.from("sms_students").update(patch).eq("id", stu.id));
        toast("Ficha actualizada.", "ok");
        refresh();
      } catch (err) { toast(apiErrorText(err), "err"); }
    });
  }

  /** Acordado / facturado / recibido / saldo (solo admin; pagos en la moneda acordada). */
  function commercialSummary(stu) {
    const cur = stu.agreed_currency || stu.plan_currency || "USD";
    const agreed = stu.agreed_price ?? stu.plan_price;
    const inCur = data.payments.filter((p) => p.currency === cur && p.status !== "void");
    const billed = inCur.filter((p) => p.status !== "refunded").reduce((a, p) => a + Number(p.amount), 0);
    const received = inCur.filter((p) => p.status === "paid").reduce((a, p) => a + Number(p.amount), 0);
    const pending = inCur.filter((p) => p.status === "pending").reduce((a, p) => a + Number(p.amount), 0);
    return html`<div class="money-row">
      <div><b>${agreed != null ? money(agreed, cur) : "—"}</b><span>Acordado por período${stu.agreed_price == null && stu.plan_price != null ? " (precio del plan)" : ""}</span></div>
      <div><b>${money(billed, cur)}</b><span>Facturado (histórico)</span></div>
      <div><b>${money(received, cur)}</b><span>Recibido</span></div>
      <div><b class="${pending ? "overdue" : ""}">${money(pending, cur)}</b><span>Saldo pendiente</span></div>
    </div>`;
  }

  /* ---------- Evaluaciones por habilidad ---------- */
  function evaluaciones(body) {
    const by = {};
    for (const a of data.assessments) (by[a.skill] = by[a.skill] || []).push(a);
    const delta = (a, b) => {
      if (!a || !b || a.score == null || b.score == null) return "";
      const n = a.score - b.score;
      return html`<span class="${n > 0 ? "delta-up" : n < 0 ? "delta-down" : ""}">${n > 0 ? "+" : ""}${n}</span>`;
    };
    mount(body, html`<section class="panel">
      <h2>Evaluaciones por habilidad <span class="spacer"></span><button class="btn btn-primary btn-sm" type="button" data-act="assess">Registrar evaluación</button></h2>
      <p class="small muted" style="margin-top:-6px">Cada habilidad se mide por separado y se compara con su evaluación anterior. No es una certificación de nivel.</p>
      ${data.assessments.length ? html`<div style="overflow-x:auto"><table class="skill-table">
        <thead><tr><th>Habilidad</th><th>Última</th><th>Anterior</th><th>Cambio</th><th>Criterio</th></tr></thead>
        <tbody>${SKILLS.filter((k) => by[k]).map((k) => {
          const [a, b] = by[k];
          return html`<tr><td><b>${label("skill", k)}</b><span class="small muted" style="display:block">${by[k].length} evaluación${by[k].length === 1 ? "" : "es"}</span></td>
            <td>${a.result}${a.score != null ? html` <span class="small muted">(${a.score})</span>` : ""}<span class="small muted" style="display:block">${d(a.assessed_on + "T12:00:00")}</span></td>
            <td>${b ? html`${b.result}${b.score != null ? html` <span class="small muted">(${b.score})</span>` : ""}<span class="small muted" style="display:block">${d(b.assessed_on + "T12:00:00")}</span>` : "—"}</td>
            <td>${delta(a, b) || "—"}</td>
            <td class="small">${a.criterion}${a.comments ? html`<span class="muted" style="display:block">${a.comments}</span>` : ""}</td></tr>`;
        })}</tbody></table></div>
        <details style="margin-top:12px"><summary class="small">Ver historial completo (${data.assessments.length})</summary>
          <ul class="timeline">${data.assessments.map((a) => html`<li class="k-progress"><span class="tdot"></span><div>
            <b>${label("skill", a.skill)}</b>: ${a.result}${a.score != null ? ` (${a.score}/100)` : ""}
            <div class="meta">${d(a.assessed_on + "T12:00:00")} · ${a.criterion}${a.created_by ? " · " + staffName(a.created_by) : ""}</div>
            ${a.comments ? html`<div class="small">${a.comments}</div>` : ""}</div></li>`)}</ul></details>`
      : html`<div class="empty-state"><b>Sin evaluaciones todavía.</b>Registra la primera para ver la evolución de cada habilidad.</div>`}
    </section>`);
  }

  /* ---------- Tareas / próximas acciones ---------- */
  function tareas(body) {
    const open = data.tasks.filter((t) => t.status === "open");
    const closed = data.tasks.filter((t) => t.status !== "open");
    mount(body, html`<section class="panel">
      <h2>Próximas acciones <span class="spacer"></span><button class="btn btn-primary btn-sm" type="button" data-act="task">Nueva tarea</button></h2>
      ${open.length ? html`${open.map((t) => taskItem(t, { showPerson: false }))}` : html`<div class="empty-state">No hay tareas pendientes para esta persona.</div>`}
      ${closed.length ? html`<details style="margin-top:10px"><summary class="small">Tareas hechas o canceladas (${closed.length})</summary>
        ${closed.map((t) => taskItem(t, { showPerson: false }))}</details>` : ""}
    </section>`);
    bindTaskList(body, () => data.tasks, () => { ctx.refreshCounts(); refresh(); });
  }

  function convert() {
    const L = data.openLead;
    openDialog({
      title: "Convertir en estudiante",
      submitLabel: "Convertir",
      body: html`<p>Se usa la misma ficha de ${data.stu.full_name}: no se crea ningún registro duplicado.</p>
        <div class="field"><label for="cv-plan">Plan</label>
          <select class="input" id="cv-plan" name="plan">${selectOptions(S.plans.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} (${p.currency} ${p.price})` })), data.stu.plan_id, { empty: "Definir después" })}</select></div>
        <div class="field"><label for="cv-start">Fecha de inicio</label>
          <input class="input" id="cv-start" name="start" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>`,
      onSubmit: async (form) => {
        await rpc("sms_convert_lead", { p_lead: L.id, p_plan: form.elements.plan.value || null, p_start: form.elements.start.value || null });
        toast(`${data.stu.full_name} ahora es estudiante activo.`, "ok");
        ctx.refreshCounts();
        refresh();
      }
    });
  }

  function editProfile() {
    const s = data.stu;
    const { priority, rest } = countryList("es");
    const av = s.availability || {};
    openDialog({
      title: "Editar datos",
      wide: true,
      body: html`
        <div class="field"><label for="e-name">Nombre completo</label><input class="input" id="e-name" name="full_name" maxlength="120" value="${s.full_name}"></div>
        <div class="grid2">
          <div class="field"><label for="e-email">Correo</label><input class="input" id="e-email" name="email" type="email" value="${s.email}"></div>
          <div class="field"><label for="e-wa">WhatsApp con indicativo</label><input class="input" id="e-wa" name="whatsapp" value="${s.whatsapp || ""}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="e-country">País</label><select class="input" id="e-country" name="country">
            <option value="">—</option>${[...priority, ...rest].map((c) => html`<option value="${c.code}" ${raw(c.code === s.country ? "selected" : "")}>${c.name}</option>`)}</select></div>
          <div class="field"><label for="e-contact">Contacto preferido</label><select class="input" id="e-contact" name="preferred_contact">${selectOptions(opt("contact", CONTACTS), s.preferred_contact, { empty: "—" })}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="e-occ">Ocupación</label><input class="input" id="e-occ" name="occupation" maxlength="120" value="${s.occupation || ""}"></div>
          <div class="field"><label for="e-tz">Zona horaria</label><select class="input" id="e-tz" name="timezone">${selectOptions(timeZones().map((z) => ({ value: z, label: z.replace(/_/g, " ") })), s.timezone, { empty: "—" })}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="e-level">Nivel</label><select class="input" id="e-level" name="english_level">${selectOptions(opt("level", LEVELS), s.english_level, { empty: "—" })}</select></div>
          <div class="field"><label for="e-format">Formato</label><select class="input" id="e-format" name="preferred_format">${selectOptions(opt("format", FORMATS), s.preferred_format, { empty: "—" })}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="e-obj">Objetivo</label><select class="input" id="e-obj" name="objective">${selectOptions(opt("objective", OBJECTIVES), s.objective, { empty: "—" })}</select></div>
          <div class="field"><label for="e-obj2">Detalle del objetivo</label><input class="input" id="e-obj2" name="objective_other" maxlength="200" value="${s.objective_other || ""}"></div>
        </div>
        <div class="field"><span class="label">Días</span><div class="chips days">${DAYS.map((x) => html`<label class="chip"><input type="checkbox" name="av_day" value="${x}" ${raw((av.days || []).includes(x) ? "checked" : "")}><span>${label("day", x)}</span></label>`)}</div></div>
        <div class="field"><span class="label">Franjas</span><div class="chips">${TIMES.map((x) => html`<label class="chip"><input type="checkbox" name="av_time" value="${x}" ${raw((av.times || []).includes(x) ? "checked" : "")}><span>${label("time", x)}</span></label>`)}</div></div>
        <div class="field"><label for="e-avn">Detalle de disponibilidad</label><input class="input" id="e-avn" name="av_notes" maxlength="300" value="${av.notes || ""}"></div>
        <div class="field"><label for="e-goals">Metas profesionales</label><textarea class="input" id="e-goals" name="professional_goals" maxlength="1000">${s.professional_goals || ""}</textarea></div>
        <div class="field"><label for="e-com">Comentarios</label><textarea class="input" id="e-com" name="comments" maxlength="1000">${s.comments || ""}</textarea></div>
        <div class="field"><label for="e-ref">Cómo nos conoció</label><input class="input" id="e-ref" name="referral_source" maxlength="120" value="${s.referral_source || ""}"></div>`,
      onSubmit: async (form) => {
        const v = (n) => form.elements[n].value.trim();
        const name = v("full_name").replace(/\s+/g, " ");
        if (name.length < 2) throw userError("Escribe el nombre completo.");
        if (!isValidEmail(v("email"))) throw userError("Revisa el correo.");
        const wa = v("whatsapp") ? normalizePhone(v("whatsapp")) : null;
        if (v("whatsapp") && !wa) throw userError("El WhatsApp debe incluir indicativo, por ejemplo +57 300 123 4567.");
        await q((c) => c.from("sms_students").update({
          full_name: name, email: normalizeEmail(v("email")), whatsapp: wa, country: v("country") || null,
          preferred_contact: v("preferred_contact") || null, english_level: v("english_level") || null,
          preferred_format: v("preferred_format") || null, objective: v("objective") || null, objective_other: v("objective_other") || null,
          availability: { days: $$('input[name="av_day"]:checked', form).map((i) => i.value), times: $$('input[name="av_time"]:checked', form).map((i) => i.value), notes: v("av_notes") || null, tz: (s.availability || {}).tz || null },
          professional_goals: v("professional_goals") || null, comments: v("comments") || null, referral_source: v("referral_source") || null,
          occupation: v("occupation") || null, timezone: v("timezone") || null
        }).eq("id", s.id));
        toast("Datos actualizados.", "ok");
        refresh();
      }
    });
  }

  /* ---------- Historial ---------- */
  function historial(body) {
    mount(body, html`<div class="cols" style="grid-template-columns:minmax(0,1fr)">
      <section class="panel">
        <form id="note-form" class="inline-form">
          <div class="field"><label for="note">Nota interna</label>
            <textarea class="input" id="note" name="note" maxlength="2000" placeholder="Solo la ve el equipo."></textarea></div>
          <div class="btn-row"><button class="btn btn-dark btn-sm" type="submit">Agregar nota</button></div>
        </form>
      </section>
      <section class="panel">
        <h2>Actividad</h2>
        ${data.activity.length ? html`<ul class="timeline">${data.activity.map((a) => html`
          <li class="k-${a.kind}"><span class="tdot"></span><div>
            <div class="body">${a.summary}</div>
            ${a.kind === "intake" && a.data && a.data.differences && Object.keys(a.data.differences).length
              ? html`<div class="small" style="margin-top:4px">Datos distintos recibidos: ${Object.entries(a.data.differences).map(([k, v]) => `${k === "full_name" ? "nombre" : k === "whatsapp" ? "WhatsApp" : "país"}: ${v}`).join(" · ")}</div>` : ""}
            <div class="meta">${dt(a.created_at)} · ${a.actor_id ? staffName(a.actor_id) || "Equipo" : "Sistema / formulario web"}</div>
          </div></li>`)}</ul>` : html`<div class="empty-state">Sin actividad todavía.</div>`}
      </section></div>`);
    $("#note-form", body).addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = e.currentTarget.elements.note.value.trim();
      if (!text) return;
      try {
        await q((c) => c.from("sms_activity").insert({ student_id: id, lead_id: data.openLead ? data.openLead.id : null, kind: "note", summary: text }));
        toast("Nota agregada.", "ok");
        refresh();
      } catch (err) { toast(apiErrorText(err), "err"); }
    });
  }

  /* ---------- Sesiones ---------- */
  function sesiones(body) {
    const s = data.stu;
    mount(body, html`<section class="panel">
      <h2>Sesiones <span class="spacer"></span><button class="btn btn-primary btn-sm" type="button" data-act="book">Agendar sesión</button></h2>
      ${data.bookings.length ? data.bookings.map((b) => html`
        <div class="booking">
          <span><span class="time">${tm(b.starts_at)}</span><span class="small muted" style="display:block">${d(b.starts_at)}</span></span>
          <span>${sessionName(b.session_type)} ${badge("booking", b.status)}
            <span class="small muted" style="display:block">${b.origin === "public" ? "Solicitada desde la web" : "Creada en el panel"}${b.student_message ? " · “" + b.student_message + "”" : ""}</span>
            ${b.meeting_url ? html`<a class="small" href="${b.meeting_url}" target="_blank" rel="noopener">Enlace de la sesión</a>` : ""}</span>
          <span class="acts">${bookingButtons({ ...b, full_name: s.full_name, whatsapp: s.whatsapp })}</span>
        </div>`) : html`<div class="empty-state">Sin sesiones registradas.</div>`}
    </section>`);
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-bk]");
      if (!btn) return;
      const b = data.bookings.find((x) => x.id === btn.dataset.id);
      bookingAction(btn.dataset.bk, { ...b, full_name: s.full_name, whatsapp: s.whatsapp }, () => { ctx.refreshCounts(); refresh(); });
    });
  }

  /* ---------- Progreso (ruta de 18 pasos) ---------- */
  function progreso(body) {
    const stu = data.stu;
    const steps = S.steps.filter((s) => s.active);
    const map = Object.fromEntries(data.progress.map((p) => [p.step_no, p]));
    const done = steps.filter((s) => (map[s.step_no] || {}).status === "completed").length;
    const cefr = CEFR.map((c) => ({ value: c, label: label("cefr", c) }));
    mount(body, html`<section class="panel">
      <h2>Perfil educativo</h2>
      <form class="inline-form" id="edu-form">
        <div class="grid2">
          <div class="field"><label for="e-li">Nivel inicial (estimado)</label><select class="input" id="e-li" name="level_initial">${selectOptions(cefr, stu.level_initial, { empty: "Sin evaluar" })}</select></div>
          <div class="field"><label for="e-lc">Nivel actual (estimado)</label><select class="input" id="e-lc" name="level_current">${selectOptions(cefr, stu.level_current, { empty: "Sin evaluar" })}</select></div>
        </div>
        <p class="small muted" style="margin:-4px 0 0">Estimación del profesor con base en evaluaciones; no equivale a una certificación oficial. Nivel declarado al registrarse: ${label("level", stu.english_level) || "—"}.</p>
        <div class="field"><span class="label" style="font-weight:700;font-size:13px">Habilidades a desarrollar</span>
          <div class="chips">${SKILLS.map((k) => html`<label class="chip"><input type="checkbox" name="skills_focus" value="${k}" ${raw((stu.skills_focus || []).includes(k) ? "checked" : "")}><span>${label("skill", k)}</span></label>`)}</div></div>
        <div class="field"><label for="e-tn">Observaciones del profesor</label><textarea class="input" id="e-tn" name="teacher_notes" maxlength="2000">${stu.teacher_notes || ""}</textarea></div>
        <div class="grid2">
          <div class="field"><label for="e-ng">Próximos objetivos</label><textarea class="input" id="e-ng" name="next_goals" maxlength="1000">${stu.next_goals || ""}</textarea></div>
          <div class="field"><label for="e-rd">Fecha de revisión del progreso</label><input class="input" id="e-rd" name="review_date" type="date" value="${stu.review_date || ""}">
            <p class="small muted" style="margin:4px 0 0">Inicio del plan: ${stu.plan_started_at ? d(stu.plan_started_at + "T12:00:00") : "—"} · Sesiones realizadas: ${stu.sessions_completed}</p></div>
        </div>
        <div class="btn-row"><button class="btn btn-dark btn-sm" type="submit">Guardar perfil</button></div>
      </form>
    </section>
    <section class="panel">
      <h2>Ruta de aprendizaje <span class="spacer"></span><span class="small muted">${done} de ${steps.length} pasos</span></h2>
      <div class="progress-bar" style="margin-bottom:14px"><i style="width:${steps.length ? (100 * done / steps.length).toFixed(1) : 0}%"></i></div>
      <div class="steps">${steps.map((st) => {
        const p = map[st.step_no] || {};
        const info = [["Descripción", st.description], ["Objetivo", st.objective], ["Actividades y recursos", st.resources], ["Criterios de finalización", st.completion_criteria]].filter(([, v]) => v);
        return html`<div class="step-row ${p.status === "completed" ? "done" : ""}" data-step="${st.step_no}">
          <span class="no">${st.step_no}</span>
          <span>${st.url ? html`<a href="${st.url}" target="_blank" rel="noopener">${st.title}</a>` : st.title}
            ${p.started_at ? html`<span class="small muted" style="display:block">Inicio ${d(p.started_at)}${p.completed_at ? " · fin " + d(p.completed_at) : ""}</span>` : ""}
            ${info.length ? html`<details><summary class="small">Detalles del paso</summary>${info.map(([k, v]) => html`<p class="small" style="margin:4px 0"><b>${k}:</b> ${v}</p>`)}</details>` : ""}
            <input class="input" style="margin-top:6px;min-height:36px" data-field="notes" maxlength="1000" placeholder="Observaciones del paso" value="${p.notes || ""}" aria-label="Observaciones del paso ${st.step_no}"></span>
          <select class="input" aria-label="Estado del paso ${st.step_no}" data-field="status">${selectOptions(opt("progress", PROGRESS_STATUSES), p.status || "not_started")}</select>
          <input class="input" type="number" min="0" max="100" placeholder="%" aria-label="Puntaje del paso ${st.step_no}" data-field="score" value="${p.score ?? ""}">
        </div>`;
      })}</div>
      <p class="small muted">Los cambios se guardan al instante y quedan en el historial. El contenido de cada paso se edita en Ajustes → Ruta de aprendizaje.</p>
    </section>`);
    $("#edu-form", body).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fm = e.currentTarget;
      try {
        await q((c) => c.from("sms_students").update({
          level_initial: fm.elements.level_initial.value || null, level_current: fm.elements.level_current.value || null,
          skills_focus: $$('input[name="skills_focus"]:checked', fm).map((i) => i.value),
          teacher_notes: fm.elements.teacher_notes.value.trim() || null, next_goals: fm.elements.next_goals.value.trim() || null,
          review_date: fm.elements.review_date.value || null
        }).eq("id", id));
        toast("Perfil educativo guardado.", "ok");
        await load();
      } catch (err) { toast(apiErrorText(err), "err"); }
    });
    body.addEventListener("change", async (e) => {
      const row = e.target.closest("[data-step]");
      if (!row) return;
      const status = row.querySelector('[data-field="status"]').value;
      const scoreText = row.querySelector('[data-field="score"]').value;
      const score = scoreText === "" ? null : Math.max(0, Math.min(100, Number(scoreText)));
      const notes = row.querySelector('[data-field="notes"]').value.trim() || null;
      try {
        await q((c) => c.from("sms_progress").upsert({ student_id: id, step_no: Number(row.dataset.step), status, score, notes }, { onConflict: "student_id,step_no" }));
        toast(`Paso ${row.dataset.step}: ${label("progress", status)}.`, "ok", 2000);
        await load();
        row.classList.toggle("done", status === "completed");
      } catch (err) { toast(apiErrorText(err), "err"); }
    });
  }

  /* ---------- Pagos ---------- */
  function pagos(body) {
    mount(body, html`<section class="panel">
      <h2>Pagos <span class="spacer"></span><button class="btn btn-primary btn-sm" type="button" data-act="pay">Registrar pago</button></h2>
      ${data.payments.length ? html`<div class="rows">${data.payments.map((p) => html`
        <div class="row" style="--cols: 1.6fr 1fr 1fr 1fr auto">
          <span class="name">${p.concept}<span class="sub">${p.method ? label("method", p.method) : ""}${p.reference ? " · ref. " + p.reference : ""}</span></span>
          <b>${money(p.amount, p.currency)}</b>
          ${badge("payment", p.status)}
          <span class="small">${p.status === "paid" ? "Pagado " + d(p.paid_at) : p.due_date ? html`<span class="${p.status === "pending" && new Date(p.due_date) < new Date() ? "overdue" : ""}">Vence ${p.due_date}</span>` : ""}</span>
          <span style="display:flex;gap:6px">${p.status === "pending" ? html`<button class="btn btn-primary btn-sm" type="button" data-paid="${p.id}">Marcar pagado</button>` : ""}
            <button class="btn btn-soft btn-sm" type="button" data-editpay="${p.id}">Editar</button></span>
        </div>`)}</div>` : html`<div class="empty-state">Sin pagos registrados.</div>`}
    </section>`);
    body.addEventListener("click", async (e) => {
      const mp = e.target.closest("[data-paid]");
      const ep = e.target.closest("[data-editpay]");
      if (mp) {
        try {
          await q((c) => c.from("sms_payments").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", mp.dataset.paid));
          toast("Pago marcado como pagado.", "ok");
          refresh();
        } catch (err) { toast(apiErrorText(err), "err"); }
      } else if (ep) {
        paymentDialog({ student: data.stu, payment: data.payments.find((x) => x.id === ep.dataset.editpay), onSaved: () => refresh() });
      }
    });
  }

  /* ---------- Privacidad ---------- */
  function privacidad(body) {
    const s = data.stu;
    mount(body, html`<div class="cols">
      <section class="panel">
        <h2>Consentimientos</h2>
        <p class="small muted">Registro de cada autorización con la versión del aviso vigente y la fecha.</p>
        ${data.consents.length ? html`<div class="rows">${data.consents.map((c) => html`
          <div class="row" style="--cols: 1fr 1fr 1.2fr">
            <span>${c.kind === "privacy" ? "Tratamiento de datos" : c.kind === "journal_sharing" ? "Compartir su journal" : "Marketing"}</span>
            <span>${c.granted ? "Otorgado" : "No otorgado"}</span>
            <span class="small">${dt(c.created_at)} · aviso ${c.notice_version} · ${c.source}</span>
          </div>`)}</div>` : html`<div class="empty-state">Sin registros de consentimiento (ficha creada en el panel).</div>`}
      </section>
      <section class="panel">
        <h2>Derechos de la persona</h2>
        <p>Si ${s.full_name.split(" ")[0]} pide sus datos, descárgalos y envíaselos. Si pide que los borremos, usa “Eliminar datos personales”: se conserva solo lo contable sin identificarla.</p>
        <div class="btn-row">
          <button class="btn btn-soft btn-sm" type="button" data-act="export">Descargar sus datos (JSON)</button>
          ${S.isAdmin && !s.anonymized_at ? html`<button class="btn btn-dark btn-sm" type="button" data-act="anonymize">Eliminar datos personales</button>` : ""}
        </div>
        ${s.consent_marketing ? html`<p class="small" style="margin-top:14px">Autorizó marketing. <button class="btn btn-soft btn-sm" type="button" data-act="optout">Registrar baja de marketing</button></p>` : ""}
      </section></div>`);
  }

  /* ---------- acciones generales ---------- */
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    const s = data.stu;
    try {
      if (act === "contact") contactDialog({ studentId: id, leadId: data.openLead && data.openLead.id, onSaved: () => { ctx.refreshCounts(); refresh(); } });
      else if (act === "edit") editProfile();
      else if (act === "convert") convert();
      else if (act === "book") bookingDialog({ student: { id, full_name: s.full_name }, onSaved: () => { ctx.refreshCounts(); refresh(); } });
      else if (act === "pay") paymentDialog({ student: { id, full_name: s.full_name }, onSaved: () => refresh() });
      else if (act === "assess") assessmentDialog({ student: { id, full_name: s.full_name }, onSaved: () => refresh() });
      else if (act === "task") taskDialog({ student: { id, full_name: s.full_name }, leadId: data.openLead ? data.openLead.id : null, onSaved: () => { ctx.refreshCounts(); refresh(); } });
      else if (act === "invite") {
        const link = new URL("../reservar/", location.href).href;
        window.open(waLink(s.whatsapp, fillTemplate(S.settings.wa_templates && S.settings.wa_templates.invite, { nombre: s.full_name.split(" ")[0], link })), "_blank", "noopener");
        if (await confirmDialog({ title: "¿Enviaste la invitación?", text: "Marcamos el lead como “Invitación enviada” y registramos el contacto.", confirmLabel: "Sí, marcar" })) {
          await q((c) => c.from("sms_leads").update({ status: "invitation_sent" }).eq("id", data.openLead.id));
          await q((c) => c.from("sms_activity").insert({ student_id: id, lead_id: data.openLead.id, kind: "contact", summary: "Invitación enviada por WhatsApp", data: { channel: "whatsapp" } }));
          ctx.refreshCounts(); refresh();
        }
      } else if (act === "newlead") {
        await q((c) => c.from("sms_leads").insert({ student_id: id, source: "panel", status: "contact_pending", objective: s.objective, preferred_format: s.preferred_format, availability: s.availability || {} }));
        toast("Nuevo proceso abierto.", "ok"); refresh();
      } else if (act === "reviewed") {
        await q((c) => c.from("sms_students").update({ needs_review: false }).eq("id", id)); refresh();
      } else if (act === "notdup") {
        await q((c) => c.from("sms_students").update({ possible_duplicate_of: null, needs_review: false }).eq("id", id)); refresh();
      } else if (act === "merge") {
        const ok = await confirmDialog({ title: "Fusionar fichas", text: `Todo lo de esta ficha (${s.email}) pasa a la de ${data.dup.full_name} y esta ficha se elimina. No se puede deshacer.`, confirmLabel: "Fusionar", danger: true, requireText: "FUSIONAR" });
        if (!ok) return;
        await rpc("sms_merge_students", { p_keep: data.dup.id, p_drop: id });
        toast("Fichas fusionadas.", "ok");
        location.hash = "#/persona/" + data.dup.id;
      } else if (act === "export") {
        const out = await rpc("sms_student_export", { p_id: id });
        download(`datos-${s.full_name.replace(/[^\p{L}\d]+/gu, "-").toLowerCase()}.json`, JSON.stringify(out, null, 2), "application/json");
        await rpc("sms_log_export", { p_entity: "student_data", p_count: 1 }).catch(() => {});
      } else if (act === "anonymize") {
        const ok = await confirmDialog({ title: "Eliminar datos personales", text: `Se borran nombre, contacto, comentarios y notas de ${s.full_name}. Se conservan pagos y estadísticas sin identificarla. No se puede deshacer.`, confirmLabel: "Eliminar datos", danger: true, requireText: "ELIMINAR" });
        if (!ok) return;
        await rpc("sms_anonymize_student", { p_id: id });
        toast("Datos personales eliminados.", "ok"); refresh();
      } else if (act === "optout") {
        await q((c) => c.from("sms_students").update({ consent_marketing: false, consent_marketing_at: new Date().toISOString() }).eq("id", id));
        await q((c) => c.from("sms_activity").insert({ student_id: id, kind: "note", summary: "Baja de comunicaciones de marketing a solicitud de la persona." }));
        toast("Baja de marketing registrada.", "ok"); refresh();
      }
    } catch (err) {
      toast(apiErrorText(err), "err", 6000);
    }
  });

  await load();
  if (!ctx.isCurrent()) return;
  paint();
}
