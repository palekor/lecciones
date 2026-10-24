/* /lista-de-espera — Módulo 2 (parte pública) */
import { CONFIG } from "./config.js";
import { options, label, errorText } from "./i18n.js";
import { validateIntake } from "./core.js";
import { $, $$, esc, html, mount, setBusy, showFieldErrors, clearFieldErrors, clearErrorsOnEdit, readRef, saveRef, forgetRef } from "./ui.js";
import {
  loadPublicConfig, fillCountrySelect, linkPhonePrefix, guessCountry, sourceParam, availabilityFrom,
  renderConsent, contactPayload, makeSubmitter, fatal, journeyState
} from "./public.js";

const submit = makeSubmitter("sms_join_waitlist");
let cfg = null;

function chipsFor(container) {
  const name = container.dataset.chips || container.dataset.checks;
  const multi = !!container.dataset.checks;
  container.innerHTML = options(container.dataset.group).map((o) =>
    `<label class="chip"><input type="${multi ? "checkbox" : "radio"}" name="${name}" value="${esc(o.value)}"><span>${esc(o.label)}</span></label>`).join("");
}

function showDone(r) {
  saveRef(r.ref, r.first_name);
  $("#quick").hidden = true;
  $("#full").hidden = true;
  const done = $("#done");
  done.hidden = false;
  const order = cfg.waitlist_order === "joined" ? "fecha de ingreso a la lista" : "fecha de registro";
  if (r.state === "waitlist") {
    mount(done, html`
      <h2 tabindex="-1" id="done-title">${r.first_name ? r.first_name + ", ya" : "Ya"} tienes tu lugar.</h2>
      <div class="form-card done-card">
        <p style="margin:0;color:var(--muted)">Tu posición en la lista</p>
        <p class="big-number">${r.position}</p>
        <p>El orden es por <b>${order}</b>. En casos puntuales (por ejemplo, una entrevista con fecha cercana) podemos priorizar; si es tu caso, cuéntanos por WhatsApp.</p>
        <div class="btn-row" style="margin-top:18px">
          <a class="btn btn-primary" href="../reservar/#ref=${encodeURIComponent(r.ref)}">Ver si hay horarios hoy</a>
          <a class="btn btn-soft" target="_blank" rel="noopener" href="https://wa.me/${CONFIG.whatsapp.replace(/\D/g, "")}">Escribir por WhatsApp</a>
        </div>
      </div>`);
  } else {
    const msg = r.state === "active_student"
      ? "Ya eres estudiante activo: no necesitas la lista de espera. Escríbenos si quieres agendar."
      : "Tu solicitud ya avanzó (" + label("lead", r.state).toLowerCase() + "). Te contactaremos pronto.";
    mount(done, html`<h2 tabindex="-1" id="done-title">Todo listo${r.first_name ? ", " + r.first_name : ""}.</h2>
      <div class="form-card"><p style="margin:0">${msg}</p></div>`);
  }
  journeyState(2);
  $("#done-title").focus();
}

function showErrors(form, alertBox, res) {
  const errs = (res && res.errors) || { form: "invalid" };
  const first = form ? showFieldErrors(form, errs) : null;
  const [field, code] = Object.entries(errs)[0];
  alertBox.textContent = errs.form || errs.ref || !form ? errorText(field, code) : "Revisa los campos marcados para continuar.";
  alertBox.hidden = false;
  if (first && first.el) first.el.focus();
}

async function quickJoin(ref) {
  const btn = $("#quick-btn");
  const alertBox = $("#quick-alert");
  alertBox.hidden = true;
  setBusy(btn, true, "Guardando tu lugar…");
  try {
    const r = await submit({ ref });
    if (r && r.ok) return showDone(r);
    if (r && r.errors && r.errors.ref) { forgetRef(); showFull(); $("#form-alert").textContent = errorText("ref", "invalid"); $("#form-alert").hidden = false; return; }
    showErrors(null, alertBox, r);
  } catch (e) {
    alertBox.textContent = errorText("network", e.code === "network" ? "network" : "generic");
    alertBox.hidden = false;
  } finally {
    setBusy(btn, false);
  }
}

function showFull() {
  $("#quick").hidden = true;
  $("#full").hidden = false;
}

async function onSubmit(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const alertBox = $("#form-alert");
  alertBox.hidden = true;
  const radio = (n) => (form.querySelector(`input[name="${n}"]:checked`) || {}).value || "";
  const p = {
    ...contactPayload(form, cfg),
    objective: radio("objective"),
    objective_other: radio("objective") === "other" ? form.elements.objective_other.value.trim() : "",
    preferred_format: radio("preferred_format"),
    urgency: radio("urgency"),
    availability: availabilityFrom(form),
    source: sourceParam()
  };
  const errors = validateIntake(p, "waitlist", cfg);
  if (Object.keys(errors).length) return showErrors(form, alertBox, { errors: { ...errors } });
  clearFieldErrors(form);
  const btn = $("#submit");
  setBusy(btn, true, "Enviando…");
  try {
    const r = await submit(p);
    if (r && r.ok) return showDone(r);
    showErrors(form, alertBox, r);
    if (r && r.errors && r.errors.consent_privacy === "outdated") setTimeout(() => location.reload(), 2500);
  } catch (e) {
    alertBox.textContent = errorText("network", e.code === "network" ? "network" : "generic");
    alertBox.hidden = false;
  } finally {
    setBusy(btn, false);
  }
}

async function init() {
  const app = $("#app");
  try {
    cfg = await loadPublicConfig();
  } catch (e) {
    $("#loading").remove();
    return fatal(app, e);
  }
  $("#loading").remove();
  if (!cfg.waitlist_enabled) {
    mount(app, html`<h2>La lista de espera está cerrada</h2>
      <p class="lede">En este momento no estamos sumando personas a la lista. Puedes revisar horarios disponibles o escribirnos.</p>
      <div class="btn-row"><a class="btn btn-primary" href="../reservar/">Ver horarios</a>
      <a class="btn btn-soft" target="_blank" rel="noopener" href="https://wa.me/${CONFIG.whatsapp.replace(/\D/g, "")}">Escribir por WhatsApp</a></div>`);
    return;
  }
  const form = $("#form");
  $$("[data-chips],[data-checks]", form).forEach(chipsFor);
  fillCountrySelect(form.elements.country, guessCountry());
  linkPhonePrefix(form.elements.country, form.elements.whatsapp)();
  renderConsent($("#consent"), cfg, "guardar tu lugar en la lista de espera y avisarte cuando se abra un cupo.");
  form.addEventListener("change", (e) => {
    if (e.target.name === "objective") $("#objective-other-wrap").hidden = e.target.value !== "other";
  });
  form.addEventListener("submit", onSubmit);
  clearErrorsOnEdit(form);

  const saved = readRef();
  if (saved) {
    $("#quick").hidden = false;
    if (saved.first_name) $("#quick-title").textContent = `${saved.first_name}, ¿te sumamos a la lista de espera?`;
    $("#quick-btn").addEventListener("click", () => quickJoin(saved.ref));
    $("#not-me").addEventListener("click", (e) => { e.preventDefault(); forgetRef(); showFull(); });
  } else {
    showFull();
  }
}

init();
