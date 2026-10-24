/* Mensajes — cola de avisos para la persona (confirmación, cancelación,
   reprogramación, recordatorio). Se envían con un toque desde el teléfono del
   equipo; nada sale automáticamente sin una integración configurada. */
import { q, rpc } from "../../api.js";
import { label } from "../../i18n.js";
import { waLink } from "../../core.js";
import { $, $$, html, mount, toast } from "../../ui.js";
import { dt, relative, staffName } from "../state.js";
import { badge, confirmDialog, apiErrorText } from "../widgets.js";

export async function render(el, params, ctx) {
  let tab = params.f === "history" ? "history" : "pending";
  let rows = [];

  mount(el, html`
    <p class="muted" style="margin-top:0">Avisos preparados automáticamente cuando confirmas, cancelas o mueves una sesión, y recordatorios 24 h antes.
      Ábrelos en WhatsApp o en tu correo, envíalos y márcalos como enviados.</p>
    <div class="filters" role="group" aria-label="Mensajes">
      <button class="filter-chip" type="button" data-tab="pending" aria-pressed="${tab === "pending"}">Por enviar</button>
      <button class="filter-chip" type="button" data-tab="history" aria-pressed="${tab === "history"}">Historial</button>
    </div>
    <section id="msgs"></section>`);

  async function load() {
    const box = $("#msgs", el);
    mount(box, html`<div class="loading"><span class="spinner"></span> Cargando…</div>`);
    if (tab === "pending") { try { await rpc("sms_outbox_refresh"); } catch (e) { /* sigue con lo que haya */ } }
    rows = await q((c) => {
      let qb = c.from("sms_outbox").select("*, sms_students(full_name)");
      qb = tab === "pending" ? qb.eq("status", "pending").order("created_at") : qb.neq("status", "pending").order("processed_at", { ascending: false });
      return qb.limit(100);
    });
    mount(box, rows.length ? html`${rows.map((m) => html`<div class="msg">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <b>${label("outbox", m.kind)}</b> · <a href="#/persona/${m.student_id}">${m.sms_students ? m.sms_students.full_name : "Persona"}</a>
          <span class="badge">${m.channel === "email" ? "Correo" : "WhatsApp"}: ${m.recipient}</span>
          ${tab === "history" ? badge("payment", m.status === "sent" ? "paid" : "void", m.status === "sent" ? "Enviado" : m.status === "skipped" ? "Omitido" : "Falló") : ""}
          <span class="small muted" style="margin-left:auto">${tab === "pending" ? "Preparado " + relative(m.created_at) : dt(m.processed_at) + (m.processed_by ? " · " + staffName(m.processed_by) : "")}</span>
        </div>
        <pre>${m.body}</pre>
        ${m.error ? html`<p class="small muted" style="margin:0 0 6px">${m.error}</p>` : ""}
        ${tab === "pending" ? html`<div class="btn-row">
          ${m.channel === "email"
            ? html`<a class="btn btn-primary btn-sm" data-open-msg="${m.id}" href="mailto:${m.recipient}?subject=${encodeURIComponent(m.subject || "")}&body=${encodeURIComponent(m.body)}">Abrir correo</a>`
            : html`<a class="btn btn-primary btn-sm" data-open-msg="${m.id}" target="_blank" rel="noopener" href="${waLink(m.recipient, m.body)}">Abrir WhatsApp</a>`}
          <button class="btn btn-soft btn-sm" type="button" data-sent="${m.id}">Marcar como enviado</button>
          <button class="btn btn-soft btn-sm" type="button" data-skip="${m.id}">Omitir</button>
        </div>` : ""}
      </div>`)}`
      : html`<div class="empty-state"><b>${tab === "pending" ? "No hay mensajes por enviar." : "Aún no hay mensajes enviados."}</b>
          ${tab === "pending" ? "Aparecen cuando confirmas, cancelas o mueves una sesión." : ""}</div>`);
  }

  async function mark(id, status) {
    try {
      await rpc("sms_outbox_mark", { p_id: id, p_status: status });
      toast(status === "sent" ? "Mensaje marcado como enviado." : "Mensaje omitido.", "ok", 2000);
      ctx.refreshCounts();
      load();
    } catch (e) { toast(apiErrorText(e), "err"); }
  }

  el.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) {
      tab = t.dataset.tab;
      $$("[data-tab]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === t)));
      return load();
    }
    const op = e.target.closest("[data-open-msg]");
    if (op) {
      const id = op.dataset.openMsg;
      setTimeout(async () => {
        if (await confirmDialog({ title: "¿Enviaste el mensaje?", text: "Si ya lo enviaste, lo marcamos como enviado y queda en el historial de la persona.", confirmLabel: "Sí, lo envié" })) mark(id, "sent");
      }, 400);
      return;
    }
    const sb = e.target.closest("[data-sent]");
    if (sb) return mark(sb.dataset.sent, "sent");
    const kb = e.target.closest("[data-skip]");
    if (kb) return mark(kb.dataset.skip, "skipped");
  });
  await load();
}
