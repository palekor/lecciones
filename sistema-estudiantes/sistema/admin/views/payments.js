/* Pagos — Módulo 5 (seguimiento comercial). Solo owner/admin. */
import { q } from "../../api.js";
import { label } from "../../i18n.js";
import { PAYMENT_STATUSES } from "../../core.js";
import { $, $$, html, mount, toast } from "../../ui.js";
import { S, d, money } from "../state.js";
import { badge, exportCSV, safeTerm, selectOptions, apiErrorText } from "../widgets.js";
import { paymentDialog } from "../forms.js";

const CSV = [
  { label: "Fecha registro", value: (r) => d(r.created_at) }, { label: "Estudiante", key: "full_name" }, { label: "Correo", key: "email" },
  { label: "Concepto", key: "concept" }, { label: "Plan", key: "plan_name" }, { label: "Valor", key: "amount" }, { label: "Moneda", key: "currency" },
  { label: "Estado", value: (r) => label("payment", r.status) }, { label: "Vencido", value: (r) => (r.overdue ? "Sí" : "No") },
  { label: "Medio", value: (r) => label("method", r.method) }, { label: "Fecha límite", key: "due_date" }, { label: "Fecha de pago", value: (r) => d(r.paid_at) },
  { label: "Período desde", key: "period_start" }, { label: "Período hasta", key: "period_end" }, { label: "Referencia", key: "reference" }
];

export async function render(el, params, ctx) {
  let filter = params.f === "overdue" ? "overdue" : "all";
  let rows = [];
  let term = "";

  mount(el, html`
    <div class="kpis" id="totals"></div>
    <div class="filters" role="group" aria-label="Filtrar pagos">
      ${[["all", "Todos"], ["overdue", "Vencidos"], ...PAYMENT_STATUSES.map((s) => [s, label("payment", s)])].map(([v, t]) =>
        html`<button class="filter-chip" type="button" data-f="${v}" aria-pressed="${filter === v}">${t}</button>`)}
    </div>
    <div class="toolbar">
      <input class="input search" id="pay-q" type="search" placeholder="Buscar por estudiante o concepto" aria-label="Buscar">
      <button class="btn btn-soft" type="button" id="csv">Exportar CSV</button>
      <button class="btn btn-primary" type="button" id="new">Registrar pago</button>
    </div>
    <div class="rows" id="rows"></div>`);

  async function totals() {
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    const [paid, pending] = await Promise.all([
      q((c) => c.from("sms_payments").select("amount,currency").eq("status", "paid").gte("paid_at", m0.toISOString())),
      q((c) => c.from("sms_payments_v").select("amount,currency,overdue").eq("status", "pending"))
    ]);
    const sum = (list) => Object.entries(list.reduce((a, r) => ({ ...a, [r.currency]: (a[r.currency] || 0) + Number(r.amount) }), {}));
    const fmt = (e) => (e.length ? e.map(([c, v]) => money(v, c)).join(" + ") : money(0, "USD"));
    mount($("#totals", el), html`
      <div class="kpi"><b>${fmt(sum(paid))}</b><span>Cobrado este mes</span></div>
      <div class="kpi"><b>${fmt(sum(pending))}</b><span>Pendiente por cobrar</span></div>
      <div class="kpi ${pending.some((p) => p.overdue) ? "alert" : ""}"><b>${pending.filter((p) => p.overdue).length}</b><span>Pagos vencidos</span></div>`);
  }

  function build(c, all = false) {
    let qb = c.from("sms_payments_v").select("*");
    if (filter === "overdue") qb = qb.eq("overdue", true);
    else if (filter !== "all") qb = qb.eq("status", filter);
    const t = safeTerm(term);
    if (t) qb = qb.or(`full_name.ilike.*${t}*,concept.ilike.*${t}*,email.ilike.*${t}*`);
    return qb.order("created_at", { ascending: false }).limit(all ? 5000 : 200);
  }

  async function load() {
    rows = await q((c) => build(c));
    mount($("#rows", el), rows.length ? html`
      <div class="row head" style="--cols: 1.6fr 1.4fr 1fr 1fr 1fr auto"><span>Estudiante</span><span>Concepto</span><span>Valor</span><span>Estado</span><span>Fecha</span><span></span></div>
      ${rows.map((p) => html`<div class="row" style="--cols: 1.6fr 1.4fr 1fr 1fr 1fr auto">
        <a class="name" href="#/persona/${p.student_id}" style="color:inherit;text-decoration:none">${p.full_name}<span class="sub">${p.email}</span></a>
        <span>${p.concept}<span class="sub">${p.method ? label("method", p.method) : ""}</span></span>
        <b>${money(p.amount, p.currency)}</b>
        <span>${badge("payment", p.status)}${p.overdue ? html`<span class="flag err">Vencido</span>` : ""}</span>
        <span class="small">${p.status === "paid" ? "Pagado " + d(p.paid_at) : p.due_date ? "Vence " + d(p.due_date + "T12:00:00") : "—"}</span>
        <span style="display:flex;gap:6px">${p.status === "pending" ? html`<button class="btn btn-primary btn-sm" type="button" data-paid="${p.id}">Marcar pagado</button>` : ""}
          <button class="btn btn-soft btn-sm" type="button" data-edit="${p.id}">Editar</button></span>
      </div>`)}` : html`<div class="empty-state"><b>No hay pagos con este filtro.</b>Registra el primero con “Registrar pago”.</div>`);
  }

  const reload = () => { load(); totals(); };
  el.addEventListener("click", async (e) => {
    const fb = e.target.closest("[data-f]");
    if (fb) { filter = fb.dataset.f; $$("[data-f]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === fb))); return load(); }
    const mp = e.target.closest("[data-paid]");
    if (mp) {
      try { await q((c) => c.from("sms_payments").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", mp.dataset.paid)); toast("Pago marcado como pagado.", "ok"); reload(); }
      catch (err) { toast(apiErrorText(err), "err"); }
      return;
    }
    const ed = e.target.closest("[data-edit]");
    if (ed) {
      const p = rows.find((x) => x.id === ed.dataset.edit);
      return paymentDialog({ student: { id: p.student_id, full_name: p.full_name }, payment: p, onSaved: reload });
    }
    if (e.target.closest("#new")) return paymentDialog({ onSaved: reload });
    if (e.target.closest("#csv")) {
      const all = await q((c) => build(c, true));
      exportCSV("payments", `pagos-${new Date().toISOString().slice(0, 10)}.csv`, all, CSV);
    }
  });
  let timer;
  $("#pay-q", el).addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { term = e.target.value; load(); }, 300); });
  await Promise.all([load(), totals()]);
}
