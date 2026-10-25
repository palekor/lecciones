/* =====================================================================
   Panel de administración — arranque, acceso, navegación y avisos.
   ===================================================================== */
import { client, rpc, q, currentSession, sendLoginCode, verifyLoginCode, signOut } from "../api.js";
import { checkProspects, openProspects } from "./prospects.js";
import { label } from "../i18n.js";
import { $, $$, esc, html, raw, mount, toast, setBusy } from "../ui.js";
import { S, loadBasics, relative } from "./state.js";
import { apiErrorText } from "./widgets.js";

const ICONS = {
  inicio: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  leads: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M17 11h5M19.5 8.5v5"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  estudiantes: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  agenda: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  pagos: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>',
  tareas: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  mensajes: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  journal: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>',
  mas: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

const ROUTES = {
  inicio:      { title: "Inicio",           load: () => import("./views/dashboard.js") },
  leads:       { title: "Leads",            load: () => import("./views/leads.js") },
  lista:       { title: "Lista de espera",  load: () => import("./views/leads.js"), params: { mode: "waitlist" } },
  estudiantes: { title: "Estudiantes",      load: () => import("./views/students.js") },
  persona:     { title: "Ficha",            load: () => import("./views/person.js") },
  journal:     { title: "Journal",          load: () => import("./views/journalboard.js") },
  agenda:      { title: "Agenda",           load: () => import("./views/agenda.js") },
  tareas:      { title: "Tareas",           load: () => import("./views/tasks.js") },
  mensajes:    { title: "Mensajes",         load: () => import("./views/messages.js") },
  mas:         { title: "Más",              load: () => Promise.resolve({ render: renderMore }) },
  pagos:       { title: "Pagos",            load: () => import("./views/payments.js"), admin: true },
  ajustes:     { title: "Ajustes",          load: () => import("./views/settings.js") }
};
const NAV = ["inicio", "leads", "lista", "estudiantes", "journal", "agenda", "tareas", "mensajes", "pagos", "ajustes"];
const TABBAR = ["inicio", "leads", "agenda", "estudiantes", "mas"];
const MORE = ["journal", "lista", "tareas", "mensajes", "pagos", "ajustes"];

function renderMore(el) {
  mount(el, html`<nav class="more-menu" aria-label="Más secciones">${MORE.filter((k) => !ROUTES[k].admin || S.isAdmin).map((k) => html`
    <a href="#/${k}"><span style="display:flex;gap:10px;align-items:center">${raw(svg(k))}${ROUTES[k].title}</span>${counts[k] ? html`<span class="badge b-new">${counts[k]}</span>` : ""}</a>`)}
    <a href="#" id="more-logout"><span>Cerrar sesión</span></a></nav>`);
  $("#more-logout", el).addEventListener("click", async (e) => { e.preventDefault(); await signOut(); location.hash = ""; location.reload(); });
}

/* ---------------- acceso ---------------- */
function show(id) {
  ["boot", "login", "noaccess", "shell"].forEach((x) => { $("#" + x).hidden = x !== id; });
}

async function whoami() {
  S.me = await rpc("sms_whoami");
  return S.me;
}

async function afterSession() {
  const me = await whoami();
  if (!me.signed_in) return showLogin();
  if (!me.staff) {
    $("#noaccess-email").textContent = me.email || "";
    return show("noaccess");
  }
  await loadBasics();
  startShell();
}

function showLogin() {
  show("login");
  $("#login-email").hidden = false;
  $("#login-code").hidden = true;
  $("#login-email-input").focus();
}

function loginAlert(msg) {
  const a = $("#login-alert");
  a.textContent = msg || "";
  a.hidden = !msg;
}

function bindLogin() {
  let email = "";
  $("#login-email").addEventListener("submit", async (e) => {
    e.preventDefault();
    loginAlert("");
    email = $("#login-email-input").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return loginAlert("Escribe un correo válido.");
    const btn = e.submitter || $("#login-email button");
    setBusy(btn, true, "Enviando…");
    try {
      await sendLoginCode(email, location.origin + location.pathname);
      $("#login-email").hidden = true;
      $("#login-code").hidden = false;
      $("#login-hint").textContent = `Enviamos un código a ${email}. Revisa también la carpeta de spam.`;
      $("#login-code-input").focus();
    } catch (err) {
      loginAlert(/rate|seconds/i.test(err.message) ? "Espera un minuto antes de pedir otro código." : "No se pudo enviar el código. Inténtalo de nuevo.");
    } finally {
      setBusy(btn, false);
    }
  });
  $("#login-code").addEventListener("submit", async (e) => {
    e.preventDefault();
    loginAlert("");
    const btn = $("#login-code button[type=submit]");
    setBusy(btn, true, "Verificando…");
    try {
      await verifyLoginCode(email, $("#login-code-input").value);
      await afterSession();
    } catch (err) {
      loginAlert("El código no es válido o venció. Pide uno nuevo.");
    } finally {
      setBusy(btn, false);
    }
  });
  $("#login-back").addEventListener("click", () => { loginAlert(""); showLogin(); $("#login-hint").textContent = "Entra con tu correo. Te enviamos un código de acceso."; });
  const out = async () => { await signOut(); location.hash = ""; location.reload(); };
  $("#noaccess-out").addEventListener("click", out);
  $("#logout").addEventListener("click", out);
}

/* ---------------- estructura ---------------- */
let counts = {};
function renderNav(current) {
  const item = (k, cls) => {
    const r = ROUTES[k];
    if (r.admin && !S.isAdmin) return "";
    const n = counts[k];
    return `<a href="#/${k}" ${current === k ? 'aria-current="page"' : ""}>${svg(k)}<span>${esc(r.title)}</span>${n ? `<span class="count">${n}</span>` : ""}</a>`;
  };
  $("#nav").innerHTML = NAV.map((k) => item(k)).join("");
  $("#tabbar").innerHTML = TABBAR.map((k) => item(k)).join("");
}

async function refreshCounts() {
  try {
    const [d, jo] = await Promise.all([rpc("sms_dashboard"), rpc("sms_journal_overview").catch(() => null)]);
    counts = { leads: (d.pipeline && d.pipeline.new) || 0, agenda: d.pending_bookings || 0, lista: d.waitlist || 0,
               tareas: d.tasks_overdue || 0, mensajes: d.outbox_pending || 0, journal: (jo && jo.texts_pending) || 0 };
    counts.mas = counts.journal + counts.lista + counts.tareas + counts.mensajes;
    setBell(d.unread_notifications || 0);
    renderNav(currentRoute().name);
  } catch (e) { /* sin bloqueo */ }
}

function setBell(n) {
  const c = $("#bell-count");
  c.hidden = !n;
  c.textContent = n > 99 ? "99+" : String(n);
}

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  const [name, id] = path.split("/");
  const params = Object.fromEntries(new URLSearchParams(query || ""));
  return { name: ROUTES[name] ? name : "inicio", id, params };
}

let renderSeq = 0;
async function route() {
  const { name, id, params } = currentRoute();
  const r = ROUTES[name];
  const seq = ++renderSeq;
  renderNav(name === "persona" ? "" : name === "mas" ? "mas" : name);
  // Contenedor limpio por vista: los manejadores de la vista anterior no sobreviven.
  const prev = $("#view");
  const view = prev.cloneNode(false);
  prev.replaceWith(view);
  if (r.admin && !S.isAdmin) {
    mount(view, html`<div class="empty-state"><b>Sección solo para administradores.</b></div>`);
    return;
  }
  $("#page-title").textContent = r.title;
  document.title = r.title + " · Panel ProfGermandario";
  mount(view, html`<div class="loading"><span class="spinner"></span> Cargando…</div>`);
  try {
    const mod = await r.load();
    if (seq !== renderSeq) return;
    await mod.render(view, { ...(r.params || {}), ...params, id }, {
      setTitle: (t) => { $("#page-title").textContent = t; document.title = t + " · Panel ProfGermandario"; },
      refreshCounts,
      isCurrent: () => seq === renderSeq
    });
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (seq !== renderSeq) return;
    mount(view, html`<div class="empty-state"><b>No se pudo cargar esta sección.</b>${apiErrorText(e)}
      <p><button class="btn btn-soft btn-sm" type="button" onclick="location.reload()">Recargar</button></p></div>`);
  }
}

/* ---------------- notificaciones ---------------- */
async function openNotifications() {
  const panel = $("#notif-panel");
  if (!panel.hidden) { panel.hidden = true; $("#bell").setAttribute("aria-expanded", "false"); return; }
  panel.hidden = false;
  $("#bell").setAttribute("aria-expanded", "true");
  mount(panel, html`<div class="loading" style="padding:14px"><span class="spinner"></span></div>`);
  const rows = await q((c) => c.from("sms_notifications").select("*").order("created_at", { ascending: false }).limit(25));
  mount(panel, html`
    <header>Notificaciones <button type="button" id="notif-read">Marcar todo como leído</button></header>
    ${rows.length ? rows.map((n) => html`
      <a class="notif ${n.read_at ? "" : "unread"}" href="${n.student_id ? "#/persona/" + n.student_id : "#/inicio"}" data-id="${n.id}">
        <b>${n.title}</b><span>${n.body || ""} · ${relative(n.created_at)}</span></a>`)
      : html`<div class="empty-state">Sin notificaciones por ahora.</div>`}`);
  $("#notif-read").addEventListener("click", async () => {
    await rpc("sms_mark_notifications_read", { p_ids: null });
    panel.hidden = true;
    refreshCounts();
  });
  panel.querySelectorAll(".notif").forEach((a) => a.addEventListener("click", async () => {
    panel.hidden = true;
    try { await rpc("sms_mark_notifications_read", { p_ids: [Number(a.dataset.id)] }); refreshCounts(); } catch (e) { /* */ }
  }));
}

async function subscribeNotifications() {
  try {
    const c = await client();
    if (!c.channel) return;
    c.channel("sms-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sms_notifications" }, (p) => {
        const n = p.new || {};
        toast(n.title || "Nueva notificación", "info", 6000);
        refreshCounts();
        // Alguien nuevo se registró: la ventana de prospectos aparece al frente.
        if (["register", "waitlist", "booking"].includes(n.kind)) checkProspects({ force: true, onChange: refreshCounts });
      })
      .subscribe();
  } catch (e) { /* el sondeo periódico cubre este caso */ }
}

let started = false;
function startShell() {
  show("shell");
  $("#me").textContent = `${S.me.staff.display_name || S.me.email} · ${label("role", S.me.staff.role)}`;
  if (started) return route();
  started = true;
  window.addEventListener("hashchange", route);
  $("#bell").addEventListener("click", openNotifications);
  $("#pros-btn").addEventListener("click", () => openProspects(refreshCounts));
  document.addEventListener("click", (e) => {
    const panel = $("#notif-panel");
    if (!panel.hidden && !e.target.closest("#notif-panel") && !e.target.closest("#bell")) panel.hidden = true;
  });
  if (!location.hash) location.hash = "#/inicio";
  route();
  // Prepara los recordatorios de las próximas 24 h y actualiza contadores.
  const outbox = () => rpc("sms_outbox_refresh").then(refreshCounts).catch(() => {});
  outbox();
  subscribeNotifications();
  setInterval(refreshCounts, 60000);
  setInterval(outbox, 5 * 60000);
  // Prospectos sin atender: al entrar, cada minuto (por si el tiempo real no llega) y al volver a la pestaña.
  const pros = () => checkProspects({ onChange: refreshCounts });
  setTimeout(pros, 700);
  setInterval(pros, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pros(); });
}

async function boot() {
  bindLogin();
  try {
    await client();
    const s = await currentSession();
    if (s) return await afterSession();
    showLogin();
  } catch (e) {
    show("login");
    loginAlert("No hay conexión con el servidor. Revisa tu internet y recarga.");
  }
}

boot();
