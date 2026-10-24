/* Inicio — Módulo 4: indicadores calculados con datos reales y pendientes del día */
import { rpc } from "../../api.js";
import { label } from "../../i18n.js";
import { LEAD_STATUSES, waLink, countryName } from "../../core.js";
import { html, mount } from "../../ui.js";
import { S, dt, d, tm, relative, isOverdue, money, sessionName } from "../state.js";
import { badge } from "../widgets.js";

const PIPE_COLORS = {
  new: "#FF6A1A", contact_pending: "#F2A33A", contacted: "#7A2BD1", awaiting_response: "#9C6ADE", waitlist: "#D72B83",
  invitation_sent: "#A06BE0", booking_requested: "#3B6FD8", booking_confirmed: "#1E9BC4", converted: "#0E8C79",
  not_interested: "#B9B2C2", archived: "#DAD5DF"
};
const sumMoney = (obj) => {
  const e = Object.entries(obj || {});
  return e.length ? e.map(([c, v]) => money(v, c)).join(" + ") : money(0, "USD");
};

export async function render(el, _params, ctx) {
  const [k, jo] = await Promise.all([rpc("sms_dashboard"), rpc("sms_journal_overview").catch(() => null)]);
  if (!ctx.isCurrent()) return;
  const accessDue = jo ? (jo.codes_expiring_7d || 0) + (jo.codes_expired_30d || 0) : 0;
  const conv = k.conversion_90d || {};
  const rate = conv.leads ? Math.round((conv.converted / conv.leads) * 100) : 0;
  const pipeTotal = LEAD_STATUSES.reduce((a, s) => a + ((k.pipeline || {})[s] || 0), 0);
  const hello = S.me.staff.display_name ? `Hola, ${S.me.staff.display_name}` : "Hola";
  const kpi = (href, n, text, alert) => html`<a class="kpi ${alert ? "alert" : ""}" href="${href}"><b>${n}</b><span>${text}</span></a>`;

  mount(el, html`
    <p class="muted" style="margin:0 0 14px">${hello}. Esto es lo que necesita tu atención hoy.</p>
    <div class="kpis">
      ${kpi("#/agenda?f=requested", k.pending_bookings, "Solicitudes de reserva por confirmar", k.pending_bookings)}
      ${kpi("#/tareas?f=overdue", k.tasks_overdue, "Tareas vencidas", k.tasks_overdue)}
      ${kpi("#/leads?sort=followup", k.follow_ups_due, "Seguimientos para hoy o vencidos", k.follow_ups_due)}
      ${kpi("#/mensajes", k.outbox_pending, "Mensajes por enviar", k.outbox_pending)}
      ${kpi("#/agenda", k.sessions_7d, "Sesiones confirmadas (7 días)")}
      ${kpi("#/leads?status=new", k.new_leads_7d, "Registros nuevos (7 días)")}
      ${kpi("#/estudiantes?status=prospect", k.total_prospects, "Prospectos en total")}
      ${kpi("#/lista", k.waitlist, "En lista de espera")}
      ${kpi("#/estudiantes", k.active_students, "Estudiantes activos")}
      ${kpi("#/agenda?view=list", k.sessions_completed_30d, "Sesiones realizadas (30 días)")}
      <div class="kpi"><b>${rate}%</b><span>Conversión a estudiante, 90 días (${conv.converted} de ${conv.leads})</span></div>
      ${kpi("#/estudiantes?f=renewals", k.renewals_7d, "Renovaciones en 7 días")}
      ${jo ? kpi("#/estudiantes?f=journal", jo.online_now, "En el journal ahora") : ""}
      ${jo ? kpi("#/estudiantes?f=journal", jo.texts_pending, "Textos del journal por revisar", jo.texts_pending) : ""}
      ${jo ? kpi("#/estudiantes?f=access", accessDue, "Accesos por vencer o vencidos", accessDue) : ""}
    </div>

    ${k.revenue_month ? html`<section class="panel" style="margin-bottom:16px">
      <h2>Dinero <span class="spacer"></span><a class="small" href="#/pagos">Ver pagos</a></h2>
      <div class="money-row">
        <div><b>${sumMoney(k.agreed_active)}</b><span>Acordado con estudiantes activos (por período)</span></div>
        <div><b>${sumMoney(k.billed_pending)}</b><span>Facturado y pendiente de cobro</span></div>
        <div><b>${sumMoney(k.revenue_month)}</b><span>Recibido este mes</span></div>
        <div><b class="${k.payments_overdue ? "overdue" : ""}">${k.payments_overdue}</b><span>Pagos vencidos</span></div>
      </div>
      <p class="small muted" style="margin:8px 0 0">Solo cuenta como recibido lo que está marcado como pagado.</p>
    </section>` : ""}

    <div class="cols">
      <section class="panel">
        <h2>Próximas sesiones <span class="spacer"></span><a class="small" href="#/agenda">Ver agenda</a></h2>
        ${k.upcoming.length ? html`<div>${k.upcoming.map((b) => html`
          <a class="row" style="--cols: 110px 1fr auto; padding:10px 0; border-top:1px solid var(--line)" href="#/persona/${b.student_id}">
            <span><b>${tm(b.starts_at)}</b><span class="sub">${d(b.starts_at)}</span></span>
            <span class="name">${b.full_name}<span class="sub">${sessionName(b.session_type)}</span></span>
            ${badge("booking", b.status)}
          </a>`)}</div>` : html`<div class="empty-state"><b>No hay sesiones próximas.</b>Activa horarios en Agenda para recibir reservas.</div>`}
      </section>

      <section class="panel">
        <h2>Tareas para hoy <span class="spacer"></span><a class="small" href="#/tareas">Ver tareas</a></h2>
        ${k.tasks.length ? html`<div>${k.tasks.map((t) => html`
          <a class="row" style="--cols: 1fr auto; padding:10px 0; border-top:1px solid var(--line)" href="${t.student_id ? "#/persona/" + t.student_id : "#/tareas"}">
            <span class="name">${t.title}<span class="sub ${isOverdue(t.due_at) ? "overdue" : ""}">${t.full_name ? t.full_name + " · " : ""}${dt(t.due_at)}</span></span>
            <span class="badge">${label("task", t.kind)}</span>
          </a>`)}</div>` : html`<div class="empty-state"><b>Sin tareas para hoy.</b>Prográmalas desde la ficha de cada persona.</div>`}
      </section>

      <section class="panel">
        <h2>Seguimientos pendientes <span class="spacer"></span><a class="small" href="#/leads?sort=followup">Ver todos</a></h2>
        ${k.follow_ups.length ? html`<div>${k.follow_ups.map((f) => html`
          <div class="row" style="--cols: 1fr auto; padding:10px 0; border-top:1px solid var(--line)">
            <a class="name" href="#/persona/${f.student_id}" style="color:inherit;text-decoration:none">${f.full_name}
              <span class="sub ${isOverdue(f.due) ? "overdue" : ""}">${dt(f.due)} (${relative(f.due)})</span></a>
            ${f.whatsapp ? html`<a class="btn btn-soft btn-sm" target="_blank" rel="noopener" href="${waLink(f.whatsapp)}">WhatsApp</a>` : ""}
          </div>`)}</div>` : html`<div class="empty-state"><b>Todo al día.</b>Programa seguimientos desde la ficha de cada persona.</div>`}
      </section>

      ${jo ? html`<section class="panel">
        <h2>Journal · últimas 24 horas <span class="spacer"></span><a class="small" href="#/estudiantes?f=journal">Ver todos</a></h2>
        ${jo.recent.length ? html`<div>${jo.recent.map((r) => {
          const on = Date.now() - Date.parse(r.last_seen_at) < 7 * 60 * 1000;
          return html`<a class="row" style="--cols: 1fr auto; padding:10px 0; border-top:1px solid var(--line)" href="#/persona/${r.student_id}?tab=journal">
            <span class="name">${on ? html`<span class="online-dot" aria-hidden="true"></span>` : ""}${r.full_name}<span class="sub">${on ? "En línea ahora" : "Conectado " + relative(r.last_seen_at)}${r.streak ? " · racha " + r.streak : ""}</span></span>
            <span class="small muted">Ver journal ›</span>
          </a>`; })}</div>` : html`<div class="empty-state"><b>Nadie conectado en las últimas 24 horas.</b>Crea el código de cada estudiante en su ficha → Journal.</div>`}
      </section>` : ""}

      <section class="panel">
        <h2>Embudo de leads</h2>
        <div class="pipeline" role="img" aria-label="Distribución de leads por estado">
          ${LEAD_STATUSES.map((s) => (k.pipeline || {})[s] ? html`<i style="width:${(100 * k.pipeline[s] / pipeTotal).toFixed(2)}%;background:${PIPE_COLORS[s]}" title="${label("lead", s)}: ${k.pipeline[s]}"></i>` : "")}
        </div>
        <div class="legend">${LEAD_STATUSES.filter((s) => (k.pipeline || {})[s]).map((s) => html`
          <a href="#/leads?status=${s}" style="--c:${PIPE_COLORS[s]};color:inherit;text-decoration:none"><span>${label("lead", s)}: <b>${k.pipeline[s]}</b></span></a>`)}</div>
        ${pipeTotal ? "" : html`<div class="empty-state"><b>Aún no hay leads.</b>Comparte el enlace de registro: <code>/registro/</code></div>`}
      </section>

      <section class="panel">
        <h2>Últimos registros <span class="spacer"></span><a class="small" href="#/leads">Ver leads</a></h2>
        ${k.recent.length ? html`<div>${k.recent.map((r) => html`
          <a class="row" style="--cols: 1fr auto; padding:10px 0; border-top:1px solid var(--line)" href="#/persona/${r.student_id}">
            <span class="name">${r.full_name}<span class="sub">${[label("objective", r.objective), countryName(r.country), relative(r.registered_at)].filter(Boolean).join(" · ")}</span></span>
            ${badge("lead", r.status)}
          </a>`)}</div>` : html`<div class="empty-state">Sin registros todavía.</div>`}
      </section>
    </div>`);
}
