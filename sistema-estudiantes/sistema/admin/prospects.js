/* Prospectos al frente: al abrir el panel y cada vez que llega alguien nuevo,
   una ventana muestra a quienes se registraron y nadie ha contactado todavía,
   con acciones de un toque (WhatsApp con saludo, llamar, correo, ficha,
   marcar como contactado, archivar). "Más tarde" la oculta 2 horas, salvo que
   llegue alguien nuevo. */
import { q } from "../api.js";
import { CONFIG } from "../config.js";
import { label } from "../i18n.js";
import { waLink, fillTemplate, countryName } from "../core.js";
import { $, $$, html, mount, toast } from "../ui.js";
import { S, relative } from "./state.js";
import { confirmDialog, apiErrorText } from "./widgets.js";

const STATUSES = ["new", "contact_pending", "waitlist", "booking_requested"];
const SNOOZE_KEY = "sms_prospects_snooze";
const SNOOZE_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_WELCOME = "Hola {nombre} 👋 Soy Germandario de ProfGermandario. Recibí tu registro{objetivo}. ¿Tienes 10 minutos hoy o mañana para conversar sobre tu inglés?";

let open = false, busy = false, lastIds = [];

function snooze() { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || "null") || {}; } catch (e) { return {}; } }
function setSnooze(v) { try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: vuelve a aparecer */ } }

async function pending() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = await q((c) => c.from("sms_leads_v")
    .select("id,student_id,full_name,email,whatsapp,country,english_level,objective,urgency,status,registered_at,source,preferred_contact,occupation")
    .in("status", STATUSES).is("last_contact_at", null).gte("registered_at", since)
    .order("registered_at", { ascending: false }).limit(25));
  // Primero quien dijo "lo antes posible"; luego los más recientes.
  return rows.sort((a, b) => (b.urgency === "asap") - (a.urgency === "asap") || String(b.registered_at).localeCompare(String(a.registered_at)));
}

function greeting(r) {
  const tpl = (S.settings.wa_templates && S.settings.wa_templates.welcome) || DEFAULT_WELCOME;
  const obj = r.objective ? " para " + String(label("objective", r.objective)).toLowerCase() : "";
  return fillTemplate(tpl, { nombre: (r.full_name || "").split(" ")[0], objetivo: obj });
}

function setTitleCount(n) {
  const base = document.title.replace(/^\(\d+\)\s*/, "");
  document.title = n ? `(${n}) ${base}` : base;
  const c = document.getElementById("pros-count");
  if (c) { c.hidden = !n; c.textContent = n > 99 ? "99+" : String(n); }
}

function notifyBrowser(rows, fresh) {
  if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted" || !fresh.length) return;
  const r = rows.find((x) => x.id === fresh[0]);
  try {
    const n = new Notification(fresh.length === 1 ? "Nuevo prospecto: " + (r ? r.full_name : "") : fresh.length + " prospectos nuevos",
      { body: r ? [label("objective", r.objective), countryName(r.country)].filter(Boolean).join(" · ") : "", tag: "sms-prospects" });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { /* algunos navegadores móviles no permiten avisos */ }
}

/**
 * Revisa si hay prospectos sin atender y abre la ventana cuando corresponde.
 * force: abrirla aunque esté pospuesta (botón o llegada de alguien nuevo).
 */
export async function checkProspects({ force = false, onChange } = {}) {
  if (busy) return;
  busy = true;
  try {
    const rows = await pending();
    const ids = rows.map((r) => r.id);
    setTitleCount(ids.length);
    const fresh = ids.filter((id) => !lastIds.includes(id));
    if (lastIds.length || fresh.length) notifyBrowser(rows, lastIds.length ? fresh : []);
    lastIds = ids;
    if (open || !rows.length) return;
    if (!force && CONFIG.prospectsPopup === false) return;   // solo lo usan las pruebas automáticas
    const sn = snooze();
    const snoozed = sn.until && Date.parse(sn.until) > Date.now() && ids.every((id) => (sn.ids || []).includes(id));
    if (!force && snoozed) return;
    if (document.querySelector("dialog[open]")) return;   // no tapar otro diálogo; se reintenta en la próxima revisión
    show(rows, onChange);
  } catch (e) { /* sin bloqueo: el panel sigue funcionando */ }
  finally { busy = false; }
}

function show(rows, onChange) {
  open = true;
  const dlg = document.createElement("dialog");
  dlg.className = "dlg prospects";
  dlg.style.width = "min(720px, calc(100vw - 24px))";
  document.body.appendChild(dlg);
  let list = rows.slice();
  const canNotify = "Notification" in window && Notification.permission === "default";

  const card = (r) => {
    const first = (r.full_name || "").split(" ")[0];
    const asap = r.urgency === "asap";
    return html`<article class="pros ${asap ? "hot" : ""}" data-lead="${r.id}">
      <div class="pros-top">
        <b>${r.full_name}</b>
        ${asap ? html`<span class="badge b-new">Lo antes posible</span>` : r.urgency ? html`<span class="badge">${label("urgency", r.urgency)}</span>` : ""}
        ${r.status === "booking_requested" ? html`<span class="badge b-booking_requested">Pidió una sesión</span>` : r.status === "waitlist" ? html`<span class="badge b-waitlist">Lista de espera</span>` : ""}
        <span class="small muted" style="margin-left:auto">${relative(r.registered_at)}</span>
      </div>
      <p class="small muted" style="margin:4px 0 0">${[label("objective", r.objective), r.english_level ? "nivel " + String(label("level", r.english_level)).toLowerCase() : "",
        r.occupation, countryName(r.country), r.preferred_contact ? "prefiere " + label("contact", r.preferred_contact) : ""].filter(Boolean).join(" · ")}</p>
      <div class="btn-row" style="margin-top:10px">
        ${r.whatsapp ? html`<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" data-wa="${r.id}" href="${waLink(r.whatsapp, greeting(r))}">WhatsApp</a>
          <a class="btn btn-soft btn-sm" href="tel:${r.whatsapp}">Llamar</a>` : ""}
        ${r.email ? html`<a class="btn btn-soft btn-sm" href="mailto:${r.email}">Correo</a>` : ""}
        <a class="btn btn-soft btn-sm" href="#/persona/${r.student_id}" data-go>Ficha</a>
        <button class="btn btn-dark btn-sm" type="button" data-done="${r.id}">✓ Ya lo contacté</button>
        <button class="link small" type="button" data-archive="${r.id}" style="margin-left:auto">No es prospecto</button>
      </div>
      <p class="small pros-hint" data-hint="${r.id}" hidden>¿Le escribiste a ${first}? Toca <b>✓ Ya lo contacté</b> para quitarlo de esta lista.</p>
    </article>`;
  };

  function paint() {
    mount(dlg, html`<div class="pros-wrap">
      <header><h2>Prospectos por atender <span class="badge b-new">${list.length}</span></h2>
        <button class="icon-btn" type="button" data-later aria-label="Cerrar">✕</button></header>
      <div class="dlg-body">
        <p class="small muted" style="margin:0 0 10px">Se registraron y nadie les ha escrito todavía. Mientras más rápido les escribas, más probable es que respondan.</p>
        ${list.length ? html`<div class="pros-list">${list.map(card)}</div>` : html`<div class="empty-state"><b>¡Todos atendidos!</b>Buen trabajo.</div>`}
      </div>
      <footer>
        ${canNotify ? html`<button class="btn btn-soft btn-sm" type="button" data-notify style="margin-right:auto">Avisarme aunque el panel esté en otra pestaña</button>` : ""}
        <a class="btn btn-soft btn-sm" href="#/leads?status=new" data-go>Ver todos en Leads</a>
        <button class="btn btn-primary btn-sm" type="button" data-later>${list.length ? "Más tarde" : "Cerrar"}</button>
      </footer></div>`);
  }
  const close = (later) => {
    if (later && list.length) setSnooze({ until: new Date(Date.now() + SNOOZE_MS).toISOString(), ids: list.map((r) => r.id) });
    dlg.close(); dlg.remove(); open = false;
    setTitleCount(list.length);
  };
  async function done(id) {
    const r = list.find((x) => x.id === id);
    if (!r) return;
    try {
      await q((c) => c.from("sms_activity").insert({ student_id: r.student_id, lead_id: r.id, kind: "contact",
        summary: "Primer contacto desde la ventana de prospectos", data: { channel: r.whatsapp ? "whatsapp" : "email", source: "prospects_popup" } }));
      list = list.filter((x) => x.id !== id);
      lastIds = lastIds.filter((x) => x !== id);
      toast(`${r.full_name.split(" ")[0]} quedó como contactado.`, "ok", 2200);
      paint();
      if (onChange) onChange();
    } catch (e) { toast(apiErrorText(e), "err"); }
  }

  dlg.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-later]")) return close(true);
    if (t.closest("[data-go]")) return close(true);
    const wa = t.closest("[data-wa]");
    if (wa) { const h = $(`[data-hint="${wa.dataset.wa}"]`, dlg); if (h) h.hidden = false; return; }
    const d = t.closest("[data-done]");
    if (d) return done(d.dataset.done);
    const ar = t.closest("[data-archive]");
    if (ar) {
      const r = list.find((x) => x.id === ar.dataset.archive);
      if (!r) return;
      dlg.close();
      const ok = await confirmDialog({ title: "No es prospecto", text: `${r.full_name} se archiva (por ejemplo, un registro de prueba o spam). Puedes reabrirlo desde Leads.`, confirmLabel: "Archivar" });
      if (ok) {
        try {
          await q((c) => c.from("sms_leads").update({ status: "archived", closed_reason: "No es prospecto (ventana de prospectos)" }).eq("id", r.id));
          list = list.filter((x) => x.id !== r.id);
          if (onChange) onChange();
        } catch (err) { toast(apiErrorText(err), "err"); }
      }
      paint(); dlg.showModal();
      return;
    }
    if (t.closest("[data-notify]")) {
      try { await Notification.requestPermission(); } catch (err) { /* */ }
      paint();
    }
  });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(true); });
  paint();
  dlg.showModal();
}

/** Abre la ventana a pedido (botón del encabezado), aunque esté pospuesta. */
export function openProspects(onChange) {
  setSnooze({});
  return checkProspects({ force: true, onChange });
}
