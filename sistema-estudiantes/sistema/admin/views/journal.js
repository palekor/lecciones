/* Ficha → Journal: códigos de acceso (crear, renovar, revocar, enviar) y lo que
   el estudiante comparte desde journal.html: conexión, avance, reportes del día
   y textos con la retroalimentación del profesor (vuelve al journal). */
import { q, rpc } from "../../api.js";
import { waLink } from "../../core.js";
import { $, $$, html, raw, mount, toast } from "../../ui.js";
import { S, d, dt, tm, relative, staffName } from "../state.js";
import { openDialog, confirmDialog, userError, selectOptions, apiErrorText } from "../widgets.js";

export const TIERS = { essential: "Essential", companion: "Companion", mastery: "Mastery Program" };
const KIND = { writing: "Escrito", reflection: "Reflexión", mirror: "Muestra inicial" };
const SUB = { mission: "misión", class: "clase", free: "práctica libre", mirror: "muestra espejo" };
const ONLINE_MS = 7 * 60 * 1000;

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria del negocio. */
export function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: S.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const dayDiff = (a, b) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);
const fmtDay = (k) => (k ? d(k + "T12:00:00") : "");
function addMonths(key, n) {
  const [y, m, dd] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(dd, last));
  return t.toISOString().slice(0, 10);
}

/** Estado legible de un código: activo, por vencer, vencido, revocado. */
export function accessState(c) {
  if (!c) return null;
  if (c.status === "revoked") return { key: "revoked", label: "Revocado", cls: "b-cancelled", line: "Revocado " + (c.revoked_at ? d(c.revoked_at) : "") };
  if (!c.valid_until) return { key: "open", label: "Vigente", cls: "b-active", line: "Sin fecha de vencimiento" };
  const left = dayDiff(c.valid_until, todayKey());
  if (left < 0) return { key: "expired", label: "Vencido", cls: "b-no_show", line: "Venció el " + fmtDay(c.valid_until), left };
  if (left <= 7) return { key: "soon", label: left === 0 ? "Vence hoy" : `Vence en ${left} día${left === 1 ? "" : "s"}`, cls: "b-pending", line: "Vigente hasta el " + fmtDay(c.valid_until), left };
  return { key: "active", label: "Vigente", cls: "b-active", line: `Vigente hasta el ${fmtDay(c.valid_until)} · quedan ${left} días`, left };
}
export const addDays = (k, n) => new Date(Date.parse(k + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const dayName = (k, today) => (k === today ? "Hoy" : k === addDays(today, -1) ? "Ayer" : fmtDay(k));
export const minutes = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`);
/** Tira de días con entradas (más intensa = más minutos). */
export function strip(visits, today, days = 14) {
  const by = Object.fromEntries((visits || []).map((v) => [v.day, v]));
  const keys = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const n = keys.filter((k) => by[k]).length;
  return html`<span class="days-strip" role="img" aria-label="${n} de ${days} días con entradas">${keys.map((k) => {
    const v = by[k], lvl = !v ? 0 : v.minutes >= 30 ? 3 : v.minutes >= 10 ? 2 : 1;
    return html`<i class="l${lvl}" title="${dayName(k, today)}: ${v ? `${v.sessions} entrada${v.sessions === 1 ? "" : "s"} · ~${minutes(v.minutes)}` : "sin entrar"}"></i>`;
  })}</span>`;
}
export function entryLine(v, today) {
  const a = tm(v.first_at || v.first), b = tm(v.last_at || v.last);
  const m = v.minutes != null ? v.minutes : Math.round((v.active_seconds || 0) / 60);
  return `${dayName(v.day, today)} · ${a === b ? a : a + "–" + b} · ${v.sessions} entrada${v.sessions === 1 ? "" : "s"} · ~${minutes(m)}`;
}

/** El código que manda: el vigente más reciente; si no hay, el último creado. */
export function mainCode(codes) {
  const live = codes.filter((c) => ["active", "open", "soon"].includes(accessState(c).key));
  return (live.length ? live : codes).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}
export function presence(j) {
  if (!j || !j.sharing || !j.last_seen_at) return null;
  const on = Date.now() - Date.parse(j.last_seen_at) < ONLINE_MS;
  return { on, text: on ? "En línea ahora" : "Última conexión " + relative(j.last_seen_at) };
}

const journalUrl = () => new URL("../../journal.html", location.href).href;
function codeMessage(stu, c) {
  const first = (stu.full_name || "").split(" ")[0];
  return `Hola ${first} 👋\n\nTu acceso a *ProfGermandario Fluency OS* está listo.\n\nPrograma: *${TIERS[c.tier]}*\nCódigo: *${c.code}*\n` +
    (c.valid_until ? `Válido hasta el ${fmtDay(c.valid_until)}.` : "Sin fecha de vencimiento.") +
    `\n\nActívalo con un toque:\n${journalUrl()}#code=${c.code}\n\nAl activarlo, el journal te preguntará si quieres compartir tu avance conmigo para acompañarte de cerca.` +
    `\nEl mismo código abre las masterclasses de The System: escríbelo donde dice “Unlock”.`;
}

function codeDialog({ stu, code, onDone }) {
  const renew = !!code;
  const base = renew && code.valid_until && code.valid_until > todayKey() ? code.valid_until : todayKey();
  const planEnd = stu.plan_renews_at && stu.plan_renews_at >= todayKey() ? stu.plan_renews_at : null;
  const initial = renew ? (code.valid_until || "") : (planEnd || addMonths(todayKey(), 1));
  const quick = [1, 3, 6, 12].map((n) => ({ n, v: addMonths(base, n) }));
  const { dlg } = openDialog({
    title: renew ? `Renovar o editar ${code.code}` : "Crear código de acceso",
    submitLabel: renew ? "Guardar" : "Crear código",
    body: html`
      ${renew ? "" : html`<p class="small muted">El código abre el journal y las masterclasses según el programa, hasta la fecha que elijas. Funciona en cuanto lo creas.</p>`}
      <div class="field"><label for="ac-tier">Programa en el journal</label>
        <select class="input" id="ac-tier" name="tier">${selectOptions(Object.entries(TIERS).map(([value, label]) => ({ value, label })), renew ? code.tier : "essential")}</select></div>
      <div class="field"><label for="ac-until">Vigente hasta (último día válido)</label>
        <input class="input" id="ac-until" name="valid_until" type="date" value="${initial}">
        <div class="filters" style="margin:8px 0 0">${quick.map((x) => html`<button class="filter-chip" type="button" data-q="${x.v}">+${x.n} ${x.n === 1 ? "mes" : "meses"}</button>`)}
          <button class="filter-chip" type="button" data-q="">Sin vencimiento</button></div>
        ${planEnd && !renew ? html`<p class="small muted" style="margin:6px 0 0">Propuesta: la renovación de su plan (${fmtDay(planEnd)}).</p>` : ""}</div>
      <div class="field"><label for="ac-note">Nota interna <span class="opt">(opcional)</span></label>
        <input class="input" id="ac-note" name="note" maxlength="300" value="${renew ? code.note || "" : ""}" placeholder="Ej.: pagó 3 meses del plan Impulso"></div>
      ${renew ? "" : html`<details class="more"><summary class="small">Registrar un código que ya existe</summary>
        <div class="field" style="margin-top:8px"><label for="ac-code">Código actual del estudiante</label>
          <input class="input" id="ac-code" name="code" autocomplete="off" placeholder="PG-XXXX-XXXX" style="text-transform:uppercase">
          <p class="small muted" style="margin:6px 0 0">Útil si ya le diste un código desde la consola del journal. Después pídele que lo escriba de nuevo en Membership para conectarse.</p></div></details>`}`,
    onOpen: (dl) => {
      $$("[data-q]", dl).forEach((b) => b.addEventListener("click", () => { dl.querySelector("#ac-until").value = b.dataset.q; }));
    },
    onSubmit: async (fm) => {
      const v = (n) => (fm.elements[n] ? fm.elements[n].value.trim() : "");
      const until = v("valid_until") || null;
      if (until && !renew && until < todayKey()) throw userError("La fecha de vigencia ya pasó.");
      try {
        if (renew) {
          await rpc("sms_access_update", { p_id: code.id, p_patch: { tier: v("tier"), valid_until: until, note: v("note") || null } });
          toast("Código actualizado. Le llega al estudiante en su próxima conexión.", "ok");
        } else {
          await rpc("sms_access_create", { p_student: stu.id, p_tier: v("tier"), p_valid_until: until, p_note: v("note") || null, p_code: v("code") || null });
          toast("Código creado. Envíaselo por WhatsApp.", "ok");
        }
      } catch (e) {
        if (e.code === "duplicate") throw userError("Ese código ya está registrado.");
        if (/invalid_code/.test(e.message)) throw userError("El código debe tener entre 6 y 20 letras o números.");
        throw e;
      }
      onDone();
    }
  });
  return dlg;
}

/**
 * Pinta la pestaña. data: { stu, codes, journal } (de la ficha);
 * refresh(): recarga la ficha conservando la pestaña.
 */
export async function journalTab(body, { stu, codes, journal }, refresh, isCurrent) {
  mount(body, html`<div class="loading"><span class="spinner"></span> Cargando journal…</div>`);
  const ids = codes.map((c) => c.id);
  const [devices, texts, reports, messages, visits] = await Promise.all([
    ids.length ? q((c) => c.from("sms_access_devices").select("id,code_id,label,created_at,last_seen_at,revoked_at").in("code_id", ids).order("last_seen_at", { ascending: false })) : Promise.resolve([]),
    q((c) => c.from("sms_journal_texts").select("*").eq("student_id", stu.id).order("written_at", { ascending: false, nullsFirst: false }).order("received_at", { ascending: false }).limit(300)),
    q((c) => c.from("sms_journal_reports").select("*").eq("student_id", stu.id).order("day", { ascending: false }).limit(120)),
    q((c) => c.from("sms_journal_messages").select("*").eq("student_id", stu.id).order("created_at", { ascending: false }).limit(30)).catch(() => []),
    q((c) => c.from("sms_journal_visits").select("*").eq("student_id", stu.id).order("day", { ascending: false }).limit(30)).catch(() => [])
  ]);
  if (isCurrent && !isCurrent()) return;
  let sub = "texts", textFilter = texts.some((t) => !t.feedback_at) ? "pending" : "all";
  const j = journal, pr = presence(j), st = (j && j.stats) || {}, pf = (j && j.profile) || {};
  const sorted = codes.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const main = mainCode(codes);
  const first = stu.full_name.split(" ")[0];
  const locked = !!stu.anonymized_at;

  const codeCard = (c) => {
    const a = accessState(c), dv = devices.filter((x) => x.code_id === c.id && !x.revoked_at);
    const last = dv[0];
    return html`<div class="code-card" data-code="${c.id}">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <b class="mono">${c.code}</b><span class="badge ${a.cls}">${a.label}</span><span class="badge">${TIERS[c.tier]}</span>
      </div>
      <p class="small muted" style="margin:6px 0 0">${a.line}${dv.length ? html` · ${dv.length} dispositivo${dv.length === 1 ? "" : "s"}${last && j && j.sharing ? " · último uso " + relative(last.last_seen_at) : ""}` : " · aún sin activar"}</p>
      ${c.note ? html`<p class="small" style="margin:4px 0 0">${c.note}</p>` : ""}
      ${locked ? "" : html`<div class="btn-row" style="margin-top:10px">
        ${a.key !== "revoked" && a.key !== "expired" && stu.whatsapp ? html`<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="${waLink(stu.whatsapp, codeMessage(stu, c))}">Enviar por WhatsApp</a>` : ""}
        <button class="btn btn-soft btn-sm" type="button" data-copy="${c.id}">Copiar mensaje</button>
        ${S.isAdmin ? html`<button class="btn btn-soft btn-sm" type="button" data-renew="${c.id}">${a.key === "expired" || a.key === "soon" ? "Renovar" : "Editar vigencia"}</button>
          ${c.status === "revoked" ? html`<button class="btn btn-soft btn-sm" type="button" data-reactivate="${c.id}">Reactivar</button>`
                                   : html`<button class="btn btn-soft btn-sm" type="button" data-revoke="${c.id}">Revocar</button>`}` : ""}
      </div>`}
    </div>`;
  };

  const statBox = (v, t) => html`<div><b>${v == null || v === "" ? "—" : v}</b><span>${t}</span></div>`;
  const journalPanel = () => {
    if (!j || (!j.sharing && !j.last_sync_at)) {
      return html`<div class="empty-state"><b>${main ? `${first} aún no comparte su journal.` : "Sin código todavía."}</b>
        ${main ? `Cuando active su código, el journal le pedirá autorización para compartir su avance contigo. Si ya lo activó, puede hacerlo en Membership.`
               : `Crea su código de acceso: al activarlo, el journal le pedirá autorización para compartir su avance, sus textos y sus reportes contigo.`}</div>`;
    }
    return html`
      <p style="margin:0 0 10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${pr ? html`<span class="badge ${pr.on ? "b-active" : ""}">${pr.text}</span>` : ""}
        ${!j.sharing ? html`<span class="badge b-cancelled">Dejó de compartir ${j.withdrawn_at ? d(j.withdrawn_at) : ""}</span>` : ""}
        ${j.streak ? html`<span class="badge">Racha: ${j.streak} día${j.streak === 1 ? "" : "s"}</span>` : ""}
        ${j.app_version ? html`<span class="small muted">Journal ${j.app_version}</span>` : ""}
      </p>
      ${j.sharing ? html`<div style="margin:0 0 12px">
        <p class="small" style="margin:0 0 6px"><b>Entradas</b> <span class="muted">· últimos 14 días</span></p>
        ${strip(visits.map((v) => ({ day: v.day, sessions: v.sessions, minutes: Math.round(v.active_seconds / 60) })), todayKey())}
        ${visits.length ? html`<ul class="small muted" style="margin:8px 0 0;padding-left:18px">${visits.slice(0, 5).map((v) => html`<li>${entryLine(v, todayKey())}</li>`)}</ul>`
                        : html`<p class="small muted" style="margin:6px 0 0">Sin entradas registradas todavía.</p>`}
      </div>` : ""}
      <div class="money-row">
        ${statBox(`${(j.completed_missions || []).length}/17`, "misiones")}
        ${statBox(st.classesAttended, "clases asistidas")}
        ${statBox(st.stars, "estrellas del día")}
        ${statBox(st.secs != null ? Math.round(st.secs / 60) : null, "minutos hablados")}
        ${statBox(st.words, "palabras escritas")}
        ${statBox(st.samples, "escritos")}
        ${statBox(st.reflections, "reflexiones")}
        ${statBox(st.meditations, "meditaciones")}
        ${statBox(st.hours != null ? Number(st.hours).toFixed(1) : null, "horas de práctica")}
        ${statBox(st.daysSent, "reportes enviados")}
      </div>
      <dl class="facts" style="margin-top:12px">
        ${pf.level ? html`<dt>Nivel declarado</dt><dd>${pf.level}</dd>` : ""}
        ${pf.goal ? html`<dt>Objetivo</dt><dd>${pf.goal}</dd>` : ""}
        ${pf.block ? html`<dt>Bloqueo</dt><dd>${pf.block}</dd>` : ""}
        ${pf.style ? html`<dt>Cómo aprende</dt><dd>${pf.style}</dd>` : ""}
        ${j.current_mission != null ? html`<dt>Misión actual</dt><dd>${j.current_mission + 1}</dd>` : ""}
        ${j.last_active_day ? html`<dt>Último día de práctica</dt><dd>${fmtDay(j.last_active_day)}</dd>` : ""}
        ${j.consent_at ? html`<dt>Autorizó compartir</dt><dd>${dt(j.consent_at)}</dd>` : ""}
      </dl>`;
  };

  const activated = devices.some((x) => !x.revoked_at);
  const msgStatus = (m) => m.withdrawn_at ? html`<span class="badge b-cancelled">Retirado</span>`
    : m.read_at ? html`<span class="badge b-active">Leído ${dt(m.read_at)}</span>`
    : m.delivered_at ? html`<span class="badge b-booking_confirmed">Entregado ${dt(m.delivered_at)}</span>`
    : html`<span class="badge b-pending">Le llega al abrir su journal</span>`;
  const messagesPanel = () => html`<section class="panel">
    <h2>Mensajes a su journal</h2>
    ${locked ? html`<p class="small muted">Ficha con datos eliminados.</p>` : html`
      <p class="small muted" style="margin:0 0 10px">${activated
        ? `Le aparece a ${first} en cuanto abra el journal. Aquí ves si ya le llegó y si lo leyó.`
        : codes.length ? `${first} aún no ha activado su código: el mensaje le llegará cuando lo active.`
                       : `Necesita un código de acceso para recibir mensajes en su journal.`}</p>
      <form id="msg-form">
        <label class="sr-only" for="msg-body">Mensaje</label>
        <textarea class="input" id="msg-body" name="body" rows="3" maxlength="4000" placeholder="Ej.: ${first}, mañana repasamos el pasado simple. Trae tu texto de la clase 3."></textarea>
        <div class="btn-row" style="margin-top:8px"><button class="btn btn-primary btn-sm" type="submit">Enviar a su journal</button></div>
      </form>`}
    ${messages.length ? html`<div style="margin-top:12px">${messages.map((m) => html`<div class="msg" style="${m.withdrawn_at ? "opacity:.6" : ""}">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${msgStatus(m)}
          <span class="small muted">Enviado ${relative(m.created_at)}${m.created_by ? " · " + staffName(m.created_by) : ""}</span>
          ${!m.read_at && !m.withdrawn_at && !locked ? html`<button class="btn btn-soft btn-sm" type="button" data-withdraw="${m.id}" style="margin-left:auto">Retirar</button>` : ""}</div>
        <pre>${m.body}</pre></div>`)}</div>` : ""}
  </section>`;

  const pendingCount = texts.filter((t) => !t.feedback_at).length;
  const textCard = (t) => html`<article class="msg" data-text="${t.id}">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <b>${t.title || "Texto"}</b><span class="badge">${KIND[t.kind]}${t.sub && SUB[t.sub] ? " · " + SUB[t.sub] : ""}</span>
      <span class="small muted">${t.written_at ? dt(t.written_at) : dt(t.received_at)}${t.words ? ` · ${t.words} palabras` : ""}</span>
      ${t.feedback ? html`<span class="badge b-active">${t.feedback_seen_at ? "Entregada en su journal" : "Corrección enviada"}</span>`
                   : t.feedback_at ? "" : html`<span class="badge b-pending">Sin revisar</span>`}
    </div>
    ${t.prompt ? html`<p class="small muted" style="margin:6px 0 0">Consigna: ${t.prompt}</p>` : ""}
    <pre>${t.content}</pre>
    ${locked ? "" : html`<form class="fb-form" data-fb="${t.id}">
      <label class="small" for="fb-${t.id}"><b>Tu retroalimentación</b> <span class="muted">(le llega a su journal)</span></label>
      <textarea class="input" id="fb-${t.id}" name="fb" rows="3" maxlength="5000" placeholder="Correcciones, versión mejorada, un comentario…">${t.feedback || ""}</textarea>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-primary btn-sm" type="submit">${t.feedback ? "Actualizar" : "Enviar al journal"}</button>
        ${t.feedback ? html`<button class="btn btn-soft btn-sm" type="button" data-clear="${t.id}">Quitar</button>` : ""}
        ${t.feedback_at ? html`<span class="small muted">${t.feedback ? "Enviada" : "Retirada"} ${relative(t.feedback_at)}</span>` : ""}
      </div></form>`}
  </article>`;

  function paintList() {
    const box = $("#j-list", body);
    if (sub === "reports") {
      mount(box, reports.length ? html`${reports.map((r, i) => html`<details class="msg" ${raw(i === 0 ? "open" : "")}>
          <summary style="cursor:pointer"><b>${fmtDay(r.day)}</b> ${r.sent_at ? html`<span class="badge">Enviado por WhatsApp</span>` : ""}
            <span class="small muted">· recibido ${relative(r.updated_at)}</span></summary><pre>${r.content}</pre></details>`)}`
        : html`<div class="empty-state">Todavía no hay reportes del día.</div>`);
      return;
    }
    const list = textFilter === "pending" ? texts.filter((t) => !t.feedback_at) : texts;
    mount(box, html`
      <div class="filters" role="group" aria-label="Textos">
        <button class="filter-chip" type="button" data-tf="pending" aria-pressed="${textFilter === "pending"}">Sin revisar (${pendingCount})</button>
        <button class="filter-chip" type="button" data-tf="all" aria-pressed="${textFilter === "all"}">Todos (${texts.length})</button>
      </div>
      ${list.length ? list.map(textCard) : html`<div class="empty-state">${texts.length ? "Todo revisado. 👌" : "Todavía no hay textos."}</div>`}`);
  }

  mount(body, html`
    <div class="cols">
      <div class="stack-s" style="gap:16px;align-content:start">
      <section class="panel">
        <h2>Acceso al journal <span class="spacer"></span>
          ${S.isAdmin && !locked ? html`<button class="btn btn-primary btn-sm" type="button" data-act="new-code">${codes.length ? "Nuevo código" : "Crear código"}</button>` : ""}</h2>
        ${sorted.length ? html`<div class="stack-s">${sorted.map(codeCard)}</div>`
          : html`<div class="empty-state"><b>Sin código de acceso.</b>${S.isAdmin ? "Crea uno: abre el journal completo y las masterclasses hasta la fecha que elijas." : "Un administrador puede crearlo."}</div>`}
      </section>
      ${messagesPanel()}
      </div>
      <section class="panel">
        <h2>Journal</h2>
        ${journalPanel()}
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="tabs" role="tablist" style="margin:0 0 12px">
        <button type="button" role="tab" data-sub="texts" aria-selected="true">Textos (${texts.length})</button>
        <button type="button" role="tab" data-sub="reports" aria-selected="false">Reportes del día (${reports.length})</button>
      </div>
      <div id="j-list"></div>
      ${S.isAdmin && (texts.length || reports.length) ? html`<p class="small muted" style="margin:14px 0 0">
        <button class="btn btn-soft btn-sm" type="button" data-act="purge">Borrar datos del journal en el servidor</button>
        Para cuando ${first} retire su autorización o pida borrar lo que compartió.</p>` : ""}
    </section>`);
  paintList();

  body.addEventListener("click", async (e) => {
    const t = e.target;
    const tab = t.closest("[data-sub]");
    if (tab) {
      sub = tab.dataset.sub;
      $$("[data-sub]", body).forEach((x) => x.setAttribute("aria-selected", String(x === tab)));
      return paintList();
    }
    const tf = t.closest("[data-tf]");
    if (tf) { textFilter = tf.dataset.tf; return paintList(); }
    const byId = (attr) => codes.find((c) => c.id === t.closest(`[${attr}]`).getAttribute(attr));
    if (t.closest("[data-act=new-code]")) return codeDialog({ stu, onDone: refresh });
    if (t.closest("[data-renew]")) return codeDialog({ stu, code: byId("data-renew"), onDone: refresh });
    if (t.closest("[data-copy]")) {
      const c = byId("data-copy");
      try { await navigator.clipboard.writeText(codeMessage(stu, c)); toast("Mensaje copiado con el código y el enlace.", "ok", 2200); }
      catch (err) { toast("Código: " + c.code, "ok", 6000); }
      return;
    }
    if (t.closest("[data-revoke]")) {
      const c = byId("data-revoke");
      if (!(await confirmDialog({ title: "Revocar " + c.code, text: `${first} pierde el acceso en todos sus dispositivos en su próxima conexión (sin conexión, a más tardar al vencer). Puedes reactivarlo después.`, confirmLabel: "Revocar", danger: true }))) return;
      try { await rpc("sms_access_update", { p_id: c.id, p_patch: { status: "revoked" } }); toast("Código revocado.", "ok"); refresh(); }
      catch (err) { toast(apiErrorText(err), "err"); }
      return;
    }
    if (t.closest("[data-reactivate]")) {
      const c = byId("data-reactivate");
      try { await rpc("sms_access_update", { p_id: c.id, p_patch: { status: "active" } }); toast("Código reactivado.", "ok"); refresh(); }
      catch (err) { toast(apiErrorText(err), "err"); }
      return;
    }
    if (t.closest("[data-withdraw]")) {
      const id = t.closest("[data-withdraw]").dataset.withdraw;
      if (!(await confirmDialog({ title: "Retirar mensaje", text: `Desaparece del journal de ${first} en su próxima conexión. Si ya lo vio en pantalla, no se puede “desver”.`, confirmLabel: "Retirar", danger: true }))) return;
      try { await rpc("sms_journal_message_withdraw", { p_id: id }); toast("Mensaje retirado.", "ok"); refresh(); }
      catch (err) { toast(apiErrorText(err), "err"); }
      return;
    }
    if (t.closest("[data-clear]")) {
      const id = t.closest("[data-clear]").dataset.clear;
      try { await rpc("sms_journal_feedback", { p_text: id, p_feedback: "" }); toast("Retroalimentación retirada.", "ok"); refresh(); }
      catch (err) { toast(apiErrorText(err), "err"); }
      return;
    }
    if (t.closest("[data-act=purge]")) {
      if (!(await confirmDialog({ title: "Borrar datos del journal", text: `Se borran del servidor los textos y reportes que ${first} compartió, y se apaga el envío. Su journal en el teléfono no cambia. No se puede deshacer.`, confirmLabel: "Borrar", danger: true, requireText: "BORRAR" }))) return;
      try { const r = await rpc("sms_journal_purge", { p_student: stu.id }); toast(`Borrados ${r.texts} textos y ${r.reports} reportes.`, "ok"); refresh(); }
      catch (err) { toast(apiErrorText(err), "err"); }
    }
  });
  body.addEventListener("submit", async (e) => {
    if (e.target.id === "msg-form") {
      e.preventDefault();
      const fm = e.target, v = fm.elements.body.value.trim(), btn = fm.querySelector("button[type=submit]");
      if (!v) { toast("Escribe el mensaje.", "err"); return; }
      btn.disabled = true;
      try { await rpc("sms_journal_message_send", { p_student: stu.id, p_body: v }); toast(activated ? "Enviado. Le aparece al abrir su journal." : "Guardado. Le llegará cuando active su código.", "ok"); refresh(); }
      catch (err) { btn.disabled = false; toast(apiErrorText(err), "err"); }
      return;
    }
    const f = e.target.closest("[data-fb]");
    if (!f) return;
    e.preventDefault();
    const v = f.elements.fb.value.trim();
    if (!v) { toast("Escribe la retroalimentación o usa “Quitar”.", "err"); return; }
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    try { await rpc("sms_journal_feedback", { p_text: f.dataset.fb, p_feedback: v }); toast("Enviada. Le llega a su journal en su próxima conexión.", "ok"); refresh(); }
    catch (err) { btn.disabled = false; toast(apiErrorText(err), "err"); }
  });
}
