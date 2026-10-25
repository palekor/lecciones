/* Journal — tablero del profesor: quién entra, cuándo, cuánto tiempo y cómo va
   cada estudiante. Conexión y progreso solo de quienes autorizaron compartir su
   journal; de los demás se ve su acceso y que no comparten. */
import { rpc } from "../../api.js";
import { $, $$, html, raw, mount } from "../../ui.js";
import { relative } from "../state.js";
import { accessState, todayKey, TIERS, addDays, strip as dayStrip, entryLine as line } from "./journal.js";

const ONLINE_MS = 7 * 60 * 1000;
const DAYS = 14;
const isOnline = (iso) => iso && Date.now() - Date.parse(iso) < ONLINE_MS;
export async function render(el, params, ctx) {
  const [b, ov] = await Promise.all([rpc("sms_journal_board", { p_days: DAYS }), rpc("sms_journal_overview").catch(() => null)]);
  if (!ctx.isCurrent()) return;
  const today = b.today || todayKey();
  const rows = b.students.map((r) => {
    const acc = r.code_id ? accessState({ status: r.code_status, valid_until: r.valid_until }) : null;
    const quiet = r.sharing && (!r.last_seen || Date.now() - Date.parse(r.last_seen) > 3 * 86400000);
    return Object.assign(r, { acc, online: r.sharing && isOnline(r.last_seen), quiet });
  });
  let filter = params.f || "all", sort = params.sort || "recent";

  const online = rows.filter((r) => r.online);
  const todayIn = rows.filter((r) => (r.visits || []).some((v) => v.day === today));
  const notSharing = rows.filter((r) => !r.sharing && r.acc && ["active", "open", "soon"].includes(r.acc.key));
  const quiet = rows.filter((r) => r.quiet && r.acc && r.acc.key !== "revoked");
  const accessDue = rows.filter((r) => r.acc && (r.acc.key === "soon" || (r.acc.key === "expired" && r.acc.left >= -30)));
  const pending = rows.reduce((a, r) => a + (r.texts_pending || 0), 0);
  const kpi = (f, n, text, alert) => html`<a class="kpi ${alert ? "alert" : ""}" href="#/journal?f=${f}"><b>${n}</b><span>${text}</span></a>`;

  const person = (r) => html`<span class="name">${r.online ? html`<span class="online-dot" aria-hidden="true"></span>` : ""}${r.full_name}</span>`;
  const entryLine = (e) => line(e, today);
  const strip = (v) => dayStrip(v, today, DAYS);

  mount(el, html`
    <p class="muted" style="margin:0 0 14px">Quién entra a su journal y cómo va cada uno. La conexión y el progreso solo se ven de quienes aceptaron compartir su journal contigo.</p>
    <div class="kpis">
      ${kpi("online", online.length, "En el journal ahora")}
      ${kpi("today", todayIn.length, "Entraron hoy")}
      ${kpi("sharing", ov && ov.active_7d != null ? ov.active_7d : rows.filter((r) => (r.visits || []).some((v) => v.day > addDays(today, -7))).length, "Activos en los últimos 7 días")}
      ${kpi("quiet", quiet.length, "Comparten pero no entran hace 3+ días", quiet.length)}
      ${kpi("notsharing", notSharing.length, "Con acceso pero sin compartir")}
      ${kpi("access", accessDue.length, "Accesos por vencer o vencidos", accessDue.length)}
      ${kpi("pending", pending, "Textos por revisar", pending)}
    </div>

    <div class="cols" style="margin-top:16px">
      <section class="panel">
        <h2>Entradas recientes <span class="spacer"></span><span class="small muted">últimos 7 días</span></h2>
        ${b.entries.length ? html`<div>${b.entries.slice(0, 25).map((e) => html`
          <a class="row" style="--cols: 1fr auto; padding:10px 0" href="#/persona/${e.student_id}?tab=journal">
            <span class="name">${isOnline(e.last) ? html`<span class="online-dot" aria-hidden="true"></span>` : ""}${e.full_name}<span class="sub">${entryLine(e)}</span></span>
            <span class="small muted">${isOnline(e.last) ? "En línea" : relative(e.last)}</span>
          </a>`)}</div>`
          : html`<div class="empty-state"><b>Aún no hay entradas.</b>Aparecen cuando un estudiante con código del panel acepta compartir su journal y lo abre.</div>`}
      </section>
      <section class="panel">
        <h2>Necesitan tu atención</h2>
        ${quiet.length || notSharing.length || accessDue.length ? html`
          ${quiet.length ? html`<h3 class="small" style="margin:6px 0">No entran hace 3 días o más</h3>${quiet.map((r) => html`
            <a class="row" style="--cols: 1fr auto; padding:8px 0" href="#/persona/${r.student_id}?tab=journal">${person(r)}<span class="small muted">${r.last_seen ? relative(r.last_seen) : "nunca"}</span></a>`)}` : ""}
          ${accessDue.length ? html`<h3 class="small" style="margin:14px 0 6px">Acceso por vencer o vencido</h3>${accessDue.map((r) => html`
            <a class="row" style="--cols: 1fr auto; padding:8px 0" href="#/persona/${r.student_id}?tab=journal">${person(r)}<span class="badge ${r.acc.cls}">${r.acc.label}</span></a>`)}` : ""}
          ${notSharing.length ? html`<h3 class="small" style="margin:14px 0 6px">Tienen acceso pero no comparten su journal</h3>${notSharing.map((r) => html`
            <a class="row" style="--cols: 1fr auto; padding:8px 0" href="#/persona/${r.student_id}?tab=journal">${person(r)}<span class="small muted">${r.devices ? "activó su código" : "no ha activado su código"}</span></a>`)}
            <p class="small muted" style="margin:8px 0 0">Pídeles que abran Toolbox → Membership → “Share my journal”.</p>` : ""}`
          : html`<div class="empty-state"><b>Todo en orden.</b>Nadie se está quedando atrás.</div>`}
      </section>
    </div>

    <section class="panel" style="margin-top:16px">
      <h2>Progreso de todos <span class="spacer"></span><span class="small muted">${rows.length} con código o journal</span></h2>
      <div class="filters" role="group" aria-label="Filtrar">
        ${[["all", "Todos"], ["online", "En línea"], ["today", "Entraron hoy"], ["sharing", "Comparten"], ["notsharing", "No comparten"], ["quiet", "Sin entrar 3+ días"], ["access", "Acceso por vencer"], ["pending", "Con textos por revisar"]]
          .map(([k, t]) => html`<button class="filter-chip" type="button" data-f="${k}" aria-pressed="${filter === k}">${t}</button>`)}
      </div>
      <div class="toolbar" style="margin:0 0 10px">
        <label class="small" for="jb-sort">Ordenar por</label>
        <select class="input" id="jb-sort" style="max-width:220px">${raw([["recent", "Última entrada"], ["missions", "Misiones"], ["streak", "Racha"], ["active", "Días activos (14)"], ["name", "Nombre"]]
          .map(([k, t]) => `<option value="${k}" ${sort === k ? "selected" : ""}>${t}</option>`).join(""))}</select>
      </div>
      <div class="rows" id="jb-rows"></div>
    </section>`);

  const COLS = "1.6fr 1fr 1fr 1.4fr 1.1fr .6fr .6fr .7fr";
  function paint() {
    let list = rows.filter((r) =>
      filter === "online" ? r.online : filter === "today" ? todayIn.includes(r) : filter === "sharing" ? r.sharing
      : filter === "notsharing" ? notSharing.includes(r) : filter === "quiet" ? quiet.includes(r)
      : filter === "access" ? accessDue.includes(r) : filter === "pending" ? r.texts_pending > 0 : true);
    const active = (r) => (r.visits || []).length;
    const by = {
      recent: (a, b) => (b.sharing - a.sharing) || String(b.last_seen || "").localeCompare(String(a.last_seen || "")) || a.full_name.localeCompare(b.full_name),
      missions: (a, b) => (b.missions || -1) - (a.missions || -1), streak: (a, b) => (b.streak || -1) - (a.streak || -1),
      active: (a, b) => active(b) - active(a), name: (a, b) => a.full_name.localeCompare(b.full_name)
    };
    list = list.slice().sort(by[sort] || by.recent);
    mount($("#jb-rows", el), list.length ? html`
      <div class="row head" style="--cols: ${COLS}"><span>Estudiante</span><span>Acceso</span><span>Última entrada</span><span>Últimos ${DAYS} días</span><span>Misiones</span><span>Racha</span><span>Estrellas</span><span>Por revisar</span></div>
      ${list.map((r) => html`<a class="row" style="--cols: ${COLS}" href="#/persona/${r.student_id}?tab=journal">
        <span class="name">${r.online ? html`<span class="online-dot" aria-hidden="true"></span>` : ""}${r.full_name}<span class="sub">${r.tier ? TIERS[r.tier] : ""}</span></span>
        ${r.acc ? html`<span class="badge ${r.acc.cls}">${r.acc.label}</span>` : html`<span class="small muted">Sin código</span>`}
        <span>${r.sharing ? html`<span class="cell-label">Última entrada:</span>${r.online ? "En línea ahora" : r.last_seen ? relative(r.last_seen) : "—"}`
                         : html`<span class="small muted">No comparte su journal</span>`}</span>
        <span>${r.sharing ? html`<span class="cell-label">Días:</span>${strip(r.visits)}` : ""}</span>
        <span>${r.sharing && r.missions != null ? html`<span class="cell-label">Misiones:</span>${r.missions}/17
          <span class="progress-bar" style="display:block;margin-top:4px;max-width:120px"><i style="width:${Math.round(100 * r.missions / 17)}%"></i></span>` : ""}</span>
        <span>${r.sharing ? html`<span class="cell-label">Racha:</span>${r.streak || 0}` : ""}</span>
        <span>${r.sharing && r.stats ? html`<span class="cell-label">Estrellas:</span>${r.stats.stars || 0}` : ""}</span>
        <span>${r.texts_pending ? html`<span class="cell-label">Textos por revisar:</span><span class="badge b-pending">${r.texts_pending}</span>` : ""}</span>
      </a>`)}`
      : html`<div class="empty-state"><b>Nadie con este filtro.</b>${rows.length ? "" : "Crea el código de cada estudiante en su ficha → Journal."}</div>`);
  }
  paint();
  $$("[data-f]", el).forEach((btn) => btn.addEventListener("click", () => {
    filter = btn.dataset.f;
    $$("[data-f]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === btn)));
    paint();
  }));
  $("#jb-sort", el).addEventListener("change", (e) => { sort = e.target.value; paint(); });
  // Los KPIs filtran la tabla sin recargar
  $$(".kpis a", el).forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const f = new URL(a.href).hash.split("f=")[1];
    const btn = $(`[data-f="${f}"]`, el); if (btn) btn.click();
    $("#jb-rows", el).scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}
