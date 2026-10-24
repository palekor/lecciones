/* /reservar — Módulo 3 (parte pública): elegir y solicitar un horario */
import { CONFIG } from "./config.js";
import { label, errorText } from "./i18n.js";
import { validateIntake, browserTimeZone, groupSlotsByDay, fmtTime, fmtDate } from "./core.js";
import { $, $$, esc, html, mount, setBusy, showFieldErrors, clearFieldErrors, clearErrorsOnEdit, readRef, saveRef, forgetRef, toast, download } from "./ui.js";
import {
  loadPublicConfig, fillCountrySelect, linkPhonePrefix, guessCountry, sourceParam,
  renderConsent, contactPayload, makeSubmitter, fatal, journeyState
} from "./public.js";
import { rpc } from "./api.js";

const viewerTz = browserTimeZone();
const submit = makeSubmitter("sms_request_booking");
let cfg = null;
let saved = null;
let slots = [];
let chosenDay = null;
let chosen = null;
let chosenType = "";

const typeName = (code) => ((cfg && cfg.session_types) || []).find((t) => t.code === code)?.name || label("session", code);
const visibleSlots = () => (chosenType ? slots.filter((s) => s.type === chosenType) : slots);

function renderTypes() {
  const present = [...new Set(slots.map((s) => s.type))];
  const wrap = $("#types-wrap");
  if (present.length < 2) { wrap.hidden = true; chosenType = ""; return; }
  wrap.hidden = false;
  $("#types").innerHTML = [["", "Todas"], ...present.map((c) => [c, typeName(c)])].map(([v, t]) =>
    `<label class="chip"><input type="radio" name="session_type" value="${esc(v)}" ${v === chosenType ? "checked" : ""}><span>${esc(t)}</span></label>`).join("");
}

async function loadSlots() {
  const r = await rpc("sms_public_slots", { p_from: null, p_days: 31 });
  slots = (r && r.slots) || [];
  return r;
}

function renderDays() {
  const groups = groupSlotsByDay(visibleSlots(), viewerTz);
  const days = $("#days");
  if (!groups.length) return false;
  if (!chosenDay || !groups.some((g) => g.day === chosenDay)) chosenDay = groups[0].day;
  days.innerHTML = groups.map((g) => {
    const d = new Date(g.items[0].start);
    const wd = new Intl.DateTimeFormat("es", { timeZone: viewerTz, weekday: "short" }).format(d);
    const dn = new Intl.DateTimeFormat("es", { timeZone: viewerTz, day: "numeric" }).format(d);
    const mo = new Intl.DateTimeFormat("es", { timeZone: viewerTz, month: "short" }).format(d);
    return `<button type="button" class="day-btn" data-day="${g.day}" aria-pressed="${g.day === chosenDay}">
      <small>${esc(wd)}</small><b>${esc(dn)}</b><small>${esc(mo)}</small></button>`;
  }).join("");
  renderTimes();
  return true;
}

function renderTimes() {
  const group = groupSlotsByDay(visibleSlots(), viewerTz).find((g) => g.day === chosenDay);
  $("#times").innerHTML = (group ? group.items : []).map((s) =>
    `<button type="button" class="time-btn" data-start="${esc(s.start)}" aria-pressed="${chosen && chosen.start === s.start}">${esc(fmtTime(s.start, viewerTz))}</button>`
  ).join("");
  $$(".day-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.day === chosenDay)));
}

function pick(start) {
  chosen = slots.find((s) => s.start === start) || null;
  renderTimes();
  const p = $("#picked");
  const btn = $("#submit");
  if (!chosen) { p.hidden = true; btn.disabled = true; btn.textContent = "Elige un horario"; return; }
  const when = fmtDate(chosen.start, viewerTz, { weekday: "long", day: "numeric", month: "long", year: undefined, hour: "numeric", minute: "2-digit" });
  let txt = `${typeName(chosen.type)}: ${when}`;
  if (cfg.timezone && cfg.timezone !== viewerTz) {
    txt += ` (en Colombia: ${fmtTime(chosen.start, cfg.timezone)})`;
  }
  p.textContent = txt;
  p.hidden = false;
  btn.disabled = false;
  btn.textContent = cfg.booking_auto_confirm ? "Reservar este horario" : "Solicitar este horario";
  const wrap = $('[data-field="slot"]');
  wrap.classList.remove("has-error");
  const m = wrap.querySelector(".field-error"); if (m) m.remove();
}

function icsFor(b) {
  const f = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ProfGermandario//Reservas//ES", "BEGIN:VEVENT",
    "UID:" + f(b.start) + "-profgermandario", "DTSTAMP:" + f(new Date().toISOString()),
    "DTSTART:" + f(b.start), "DTEND:" + f(b.end),
    "SUMMARY:" + typeName(b.type) + " con ProfGermandario",
    "DESCRIPTION:" + (b.status === "confirmed" ? "Sesión confirmada." : "Solicitud pendiente de confirmación por WhatsApp."),
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
}

function showDone(r) {
  saveRef(r.ref, r.first_name);
  journeyState(3);
  $("#form").hidden = true;
  $("#title").hidden = true;
  $("#lede").hidden = true;
  const b = r.booking;
  const when = fmtDate(b.start, viewerTz, { weekday: "long", day: "numeric", month: "long", year: undefined, hour: "numeric", minute: "2-digit" });
  const confirmed = b.status === "confirmed";
  const done = $("#done");
  done.hidden = false;
  mount(done, html`
    <h2 tabindex="-1" id="done-title">${confirmed ? "Sesión reservada" : "Solicitud enviada"}${r.first_name ? ", " + r.first_name : ""}.</h2>
    <div class="form-card done-card">
      <p style="margin:0;color:var(--muted)">${typeName(b.type)}</p>
      <p style="font-size:24px;font-weight:900;letter-spacing:-.03em;margin:4px 0 12px;text-transform:capitalize">${when}</p>
      <p>${confirmed
        ? "Tu horario quedó confirmado. Te enviaremos el enlace de la sesión por WhatsApp."
        : "Revisamos tu solicitud y te confirmamos por WhatsApp. El horario queda apartado para ti mientras tanto."}</p>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn btn-dark" type="button" id="ics">Agregar a mi calendario</button>
        <a class="btn btn-soft" target="_blank" rel="noopener"
           href="https://wa.me/${CONFIG.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Hola, acabo de solicitar una sesión para el " + when + ".")}">Escribir por WhatsApp</a>
      </div>
    </div>`);
  $("#ics").addEventListener("click", () => download("sesion-profgermandario.ics", icsFor(b), "text/calendar;charset=utf-8"));
  $("#done-title").focus();
}

async function onSubmit(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const alertBox = $("#form-alert");
  alertBox.hidden = true;
  if (!chosen) {
    showFieldErrors(form, { slot: "required" });
    return;
  }
  let p = { slot_start: chosen.start, session_type: chosen.type, message: form.elements.message.value.trim() };
  if (saved) {
    p.ref = saved.ref;
  } else {
    p = { ...contactPayload(form, cfg), ...p, source: sourceParam() };
    const errors = validateIntake(p, "booking", cfg);
    if (Object.keys(errors).length) {
      const first = showFieldErrors(form, errors);
      alertBox.textContent = "Revisa los campos marcados para continuar.";
      alertBox.hidden = false;
      if (first && first.el) first.el.focus();
      return;
    }
  }
  clearFieldErrors(form);
  const btn = $("#submit");
  setBusy(btn, true, "Enviando…");
  try {
    const r = await submit(p);
    if (r && r.ok) return showDone(r);
    const errs = (r && r.errors) || { form: "invalid" };
    if (errs.slot === "unavailable" || errs.slot === "taken") {
      toast(errorText("slot", errs.slot), "err", 6000);
      chosen = null;
      await loadSlots();
      renderTypes();
      if (!renderDays()) return showNoSlots();
      pick(null);
      return;
    }
    if (errs.ref) {
      forgetRef(); saved = null;
      $("#contact-set").hidden = false; $("#consent-set").hidden = false; $("#as-ref").hidden = true;
    }
    const first = showFieldErrors(form, errs);
    const [field, code] = Object.entries(errs)[0];
    alertBox.textContent = errorText(field, code);
    alertBox.hidden = false;
    if (first && first.el) first.el.focus();
  } catch (e) {
    alertBox.textContent = errorText("network", e.code === "network" ? "network" : "generic");
    alertBox.hidden = false;
  } finally {
    setBusy(btn, false);
    if (!chosen) { btn.disabled = true; btn.textContent = "Elige un horario"; }
  }
}

function showNoSlots(disabled) {
  $("#form").hidden = true;
  $("#lede").hidden = true;
  const done = $("#done");
  done.hidden = false;
  mount(done, html`<div class="empty">
      <p style="margin:0 0 6px;font-weight:800;color:var(--ink)">${disabled ? "Las reservas en línea están pausadas." : "No hay horarios disponibles en las próximas semanas."}</p>
      <p style="margin:0 0 16px">Únete a la lista de espera y te avisamos apenas se abra un espacio.</p>
      <div class="btn-row" style="justify-content:center">
        <a class="btn btn-primary" href="../lista-de-espera/${saved ? "#ref=" + encodeURIComponent(saved.ref) : ""}">Unirme a la lista de espera</a>
        <a class="btn btn-soft" target="_blank" rel="noopener" href="https://wa.me/${CONFIG.whatsapp.replace(/\D/g, "")}">Escribir por WhatsApp</a>
      </div></div>`);
}

async function init() {
  const app = $("#app");
  saved = readRef();
  let r;
  try {
    [cfg, r] = await Promise.all([loadPublicConfig(), loadSlots()]);
  } catch (e) {
    $("#loading").remove();
    return fatal(app, e);
  }
  $("#loading").remove();
  if (!r.enabled) return showNoSlots(true);
  renderTypes();
  if (!renderDays()) return showNoSlots(false);
  if (cfg.cancellation_policy) { $("#policy").textContent = "Cancelaciones y cambios: " + cfg.cancellation_policy; $("#policy").hidden = false; }

  const form = $("#form");
  form.hidden = false;
  const tzName = viewerTz.replace(/_/g, " ");
  $("#tz-note").textContent = cfg.timezone && cfg.timezone !== viewerTz
    ? `Horas en tu zona horaria (${tzName}). Al elegir verás también la hora de Colombia.`
    : `Horas en tu zona horaria (${tzName}).`;

  if (saved) {
    $("#contact-set").hidden = true;
    $("#consent-set").hidden = true;
    const asRef = $("#as-ref");
    asRef.hidden = false;
    asRef.innerHTML = `Reservando con los datos de tu registro${saved.first_name ? " (" + esc(saved.first_name) + ")" : ""}. <a href="#" id="not-me">¿No eres tú?</a>`;
    $("#not-me").addEventListener("click", (e) => {
      e.preventDefault(); forgetRef(); saved = null;
      asRef.hidden = true; $("#contact-set").hidden = false; $("#consent-set").hidden = false;
    });
  }
  fillCountrySelect(form.elements.country, guessCountry());
  linkPhonePrefix(form.elements.country, form.elements.whatsapp)();
  renderConsent($("#consent"), cfg, "agendar tu sesión, confirmarla contigo y hacer seguimiento a tu proceso.");

  $("#types").addEventListener("change", (e) => {
    chosenType = e.target.value; chosen = null; chosenDay = null;
    renderDays(); pick(null);
  });
  $("#days").addEventListener("click", (e) => {
    const b = e.target.closest(".day-btn"); if (!b) return;
    chosenDay = b.dataset.day; renderTimes();
  });
  $("#times").addEventListener("click", (e) => {
    const b = e.target.closest(".time-btn"); if (!b) return;
    pick(b.dataset.start);
  });
  form.addEventListener("submit", onSubmit);
  clearErrorsOnEdit(form);
}

init();
