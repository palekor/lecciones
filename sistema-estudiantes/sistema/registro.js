/* /registro — Módulo 1: registro de estudiantes */
import { CONFIG } from "./config.js";
import { options, label, errorText } from "./i18n.js";
import { validateIntake, firstName } from "./core.js";
import { $, $$, esc, html, mount, setBusy, showFieldErrors, clearFieldErrors, clearErrorsOnEdit, saveRef, toast } from "./ui.js";
import {
  loadPublicConfig, fillCountrySelect, fillTimeZoneSelect, linkPhonePrefix, guessCountry, sourceParam, availabilityFrom,
  renderConsent, contactPayload, makeSubmitter, fatal, journeyState
} from "./public.js";
import { rpc } from "./api.js";

const form = $("#form");
const app = $("#app");
let cfg = null;
const submit = makeSubmitter("sms_register");

function chipsFor(container) {
  const name = container.dataset.chips || container.dataset.checks;
  const multi = !!container.dataset.checks;
  const list = options(container.dataset.group);
  container.innerHTML = list.map((o) =>
    `<label class="chip"><input type="${multi ? "checkbox" : "radio"}" name="${name}" value="${esc(o.value)}"><span>${esc(o.label)}</span></label>`
  ).join("");
}

function renderExtra(questions) {
  const box = $("#extra-questions");
  mount(box, html`${questions.map((q) => {
    const id = "extra_" + q.id;
    const opt = q.required ? "" : html` <span class="opt">(opcional)</span>`;
    if (q.type === "checkbox") {
      return html`<div class="field" data-field="${id}"><div class="check">
        <input type="checkbox" id="${id}" data-extra="${q.id}" data-type="checkbox">
        <label for="${id}">${q.label}${opt}</label></div></div>`;
    }
    if (q.type === "select") {
      return html`<div class="field" data-field="${id}"><label for="${id}">${q.label}${opt}</label>
        <select class="input" id="${id}" data-extra="${q.id}"><option value="">Elige una opción</option>
        ${q.options.map((o) => html`<option>${o}</option>`)}</select></div>`;
    }
    const tag = q.type === "textarea"
      ? html`<textarea class="input" id="${id}" data-extra="${q.id}" maxlength="1000"></textarea>`
      : html`<input class="input" id="${id}" data-extra="${q.id}" maxlength="200">`;
    return html`<div class="field" data-field="${id}"><label for="${id}">${q.label}${opt}</label>${tag}</div>`;
  })}`);
}

function collect() {
  const radio = (n) => (form.querySelector(`input[name="${n}"]:checked`) || {}).value || "";
  const extra = {};
  $$("[data-extra]", form).forEach((el) => {
    extra[el.dataset.extra] = el.dataset.type === "checkbox" ? el.checked : el.value.trim();
  });
  const p = {
    ...contactPayload(form, cfg),
    english_level: radio("english_level"),
    objective: radio("objective"),
    objective_other: radio("objective") === "other" ? form.elements.objective_other.value.trim() : "",
    preferred_format: radio("preferred_format"),
    preferred_contact: radio("preferred_contact"),
    urgency: radio("urgency"),
    occupation: form.elements.occupation.value.trim(),
    availability: availabilityFrom(form),
    professional_goals: form.elements.professional_goals.value.trim(),
    comments: form.elements.comments.value.trim(),
    referral_source: form.elements.referral_source.value,
    extra,
    source: sourceParam()
  };
  return p;
}

function showDone(res) {
  journeyState(2);
  $("#mini-label").textContent = "Paso 2 de 4: elige cómo seguir";
  saveRef(res.ref, res.first_name);
  form.hidden = true;
  $("h2", app).hidden = true;
  $(".lede", app).hidden = true;
  const done = $("#done");
  done.hidden = false;
  const bookingHref = "../reservar/#ref=" + encodeURIComponent(res.ref);
  mount(done, html`
    <div class="done-card">
      <h2 tabindex="-1" id="done-title">Listo, ${res.first_name || "gracias"}. Recibimos tu registro.</h2>
      <p class="lede">Te escribiremos por el medio que elegiste. Mientras tanto, elige el siguiente paso:</p>
      <div class="next-list">
        ${res.next && res.next.booking ? html`
        <div class="next featured">
          <div><h3>Reservar mi sesión de diagnóstico</h3><p>Elige día y hora. Te confirmamos por WhatsApp.</p></div>
          <a class="btn btn-primary" href="${bookingHref}">Ver horarios</a>
        </div>` : ""}
        ${res.next && res.next.waitlist ? html`
        <div class="next" id="wl-card">
          <div><h3>Unirme a la lista de espera</h3><p>Si no ves un horario que te sirva, te avisamos cuando se abra un cupo.</p></div>
          <button class="btn btn-soft" type="button" id="wl-btn">Unirme a la lista</button>
        </div>` : ""}
        <div class="next">
          <div><h3>Hablar con nosotros</h3><p>¿Tienes una pregunta antes de seguir?</p></div>
          <a class="btn btn-soft" target="_blank" rel="noopener"
             href="https://wa.me/${CONFIG.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Hola, acabo de registrarme en ProfGermandario. Mi nombre es " + (res.first_name || "") + ".")}">Abrir WhatsApp</a>
        </div>
      </div>
    </div>`);
  $("#done-title").focus();
  const wlBtn = $("#wl-btn");
  if (wlBtn) wlBtn.addEventListener("click", () => joinWaitlist(res.ref, wlBtn));
}

const waitlistSubmit = makeSubmitter("sms_join_waitlist");
async function joinWaitlist(ref, btn) {
  setBusy(btn, true, "Uniéndote…");
  try {
    const r = await waitlistSubmit({ ref });
    if (r && r.ok) {
      const card = $("#wl-card");
      mount(card, r.state === "waitlist"
        ? html`<div><h3>Estás en la lista de espera</h3><p>Tu posición actual: <b>${r.position}</b>. El orden es por fecha de registro; te avisamos apenas se abra un cupo.</p></div>`
        : html`<div><h3>Tu solicitud ya está en proceso</h3><p>Estado: ${label("lead", r.state)}. Te contactaremos pronto.</p></div>`);
    } else {
      const [field, code] = Object.entries((r && r.errors) || { form: "invalid" })[0];
      toast(errorText(field, code), "err", 6000);
      setBusy(btn, false);
    }
  } catch (e) {
    toast(errorText("network", e.code === "network" ? "network" : "generic"), "err", 6000);
    setBusy(btn, false);
  }
}

async function onSubmit(ev) {
  ev.preventDefault();
  const alertBox = $("#form-alert");
  alertBox.hidden = true;
  const p = collect();
  const errors = validateIntake(p, "register", cfg);
  if (Object.keys(errors).length) {
    const first = showFieldErrors(form, errors);
    if (first && first.el) first.el.focus();
    alertBox.textContent = "Revisa los campos marcados para continuar.";
    alertBox.hidden = false;
    return;
  }
  clearFieldErrors(form);
  const btn = $("#submit");
  setBusy(btn, true, "Enviando…");
  try {
    const res = await submit(p);
    if (res && res.ok) {
      showDone(res);
      return;
    }
    const errs = (res && res.errors) || { form: "invalid" };
    const first = showFieldErrors(form, errs);
    alertBox.textContent = errs.form ? errorText("form", errs.form) : "Revisa los campos marcados para continuar.";
    alertBox.hidden = false;
    if (errs.consent_privacy === "outdated") setTimeout(() => location.reload(), 2500);
    (first && first.el ? first.el : alertBox).focus?.();
  } catch (e) {
    alertBox.textContent = errorText("network", e.code === "network" ? "network" : "generic");
    alertBox.hidden = false;
  } finally {
    setBusy(btn, false);
  }
}

async function init() {
  try {
    cfg = await loadPublicConfig();
  } catch (e) {
    $("#loading").remove();
    fatal(app, e);
    return;
  }
  $$("[data-chips],[data-checks]", form).forEach(chipsFor);
  fillCountrySelect(form.elements.country, guessCountry());
  fillTimeZoneSelect(form.elements.timezone);
  linkPhonePrefix(form.elements.country, form.elements.whatsapp)();

  const show = cfg.show_optional_fields || {};
  $$("[data-optional]", form).forEach((el) => { el.hidden = show[el.dataset.optional] === false; });
  const ref = form.elements.referral_source;
  ref.innerHTML = `<option value="">Elige una opción</option>` +
    (cfg.referral_options || []).map((o) => `<option>${esc(o)}</option>`).join("");
  renderExtra(cfg.extra_questions || []);
  if ($$("[data-optional]:not([hidden])", form).length === 0 && !(cfg.extra_questions || []).length) $("#optional-set").hidden = true;

  renderConsent($("#consent"), cfg,
    "gestionar tu registro, contactarte sobre tu proceso de inglés, agendar sesiones y hacer seguimiento a tu progreso.");

  form.addEventListener("change", (e) => {
    if (e.target.name === "objective") $("#objective-other-wrap").hidden = e.target.value !== "other";
  });
  clearErrorsOnEdit(form);
  form.addEventListener("submit", onSubmit);
  $("#loading").remove();
  form.hidden = false;
  $("#mini-label").textContent = "Paso 1 de 4: registro";
}

init();
