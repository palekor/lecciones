/* Ajustes — configuración del sistema, planes, ruta, equipo y enlaces públicos */
import { DEFAULT_WELCOME } from "../prospects.js";
import { q, rpc } from "../../api.js";
import { label, setLabelOverrides } from "../../i18n.js";
import { $, $$, html, raw, mount, toast, download } from "../../ui.js";
import { LEAD_STATUSES, STUDENT_STATUSES } from "../../core.js";
import { S, loadBasics, d } from "../state.js";
import { badge, selectOptions, openDialog, userError, confirmDialog, apiErrorText } from "../widgets.js";

function defaultLabel(group, code) {
  // Nombre original sin personalizaciones (para mostrar como referencia).
  const saved = (S.settings.status_labels || {});
  setLabelOverrides({});
  const t = label(group, code);
  setLabelOverrides(saved);
  return t;
}
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "pregunta";

export async function render(el, params, ctx) {
  const base = new URL("../", location.href).href;
  const links = [
    ["Registro", base + "registro/"], ["Lista de espera", base + "lista-de-espera/"],
    ["Reservar sesión", base + "reservar/"], ["Política de datos", base + "privacidad/"]
  ];
  const linksPanel = html`<section class="panel" id="links">
    <h2>Enlaces para compartir</h2>
    <p class="small muted" style="margin-top:-6px">Pégalos en tu bio, en WhatsApp o en botones de embudo.html. Agrega <code>?src=instagram</code> (u otra fuente) para saber de dónde llegó cada registro.</p>
    <div class="rows">${links.map(([t, u]) => html`<div class="row" style="--cols: 1fr 2fr auto">
      <b>${t}</b><span class="small" style="overflow-wrap:anywhere">${u}</span>
      <button class="btn btn-soft btn-sm" type="button" data-copy="${u}">Copiar</button></div>`)}</div>
  </section>`;

  if (!S.isAdmin) {
    mount(el, html`${linksPanel}<p class="muted" style="margin-top:16px">Los ajustes del sistema solo los puede cambiar un administrador.</p>`);
    bindCopy();
    return;
  }

  await loadBasics();
  const st = S.settings;
  const tzs = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : ["America/Bogota", "America/Mexico_City", "America/New_York", "Europe/Madrid"]);
  const sof = st.show_optional_fields || {};
  const wa = st.wa_templates || {};
  let questions = JSON.parse(JSON.stringify(st.extra_questions || []));

  mount(el, html`
    ${linksPanel}
    <div class="cols" style="margin-top:16px">
      <section class="panel"><h2>General</h2>
        <form class="inline-form" data-section="general">
          <div class="field"><label for="g-tz">Zona horaria de la agenda</label>
            <select class="input" id="g-tz" name="timezone">${selectOptions(tzs.map((z) => ({ value: z, label: z.replace(/_/g, " ") })), st.timezone)}</select></div>
          <div class="field"><label for="g-ctrl">Responsable de los datos (nombre visible)</label><input class="input" id="g-ctrl" name="controller_name" value="${st.controller_name || ""}" maxlength="160"></div>
          <div class="grid2">
            <div class="field"><label for="g-mail">Correo de contacto</label><input class="input" id="g-mail" name="contact_email" type="email" value="${st.contact_email || ""}"></div>
            <div class="field"><label for="g-wa">WhatsApp del negocio</label><input class="input" id="g-wa" name="contact_whatsapp" value="${st.contact_whatsapp || ""}"></div>
          </div>
          <button class="btn btn-dark btn-sm" type="submit">Guardar</button>
        </form></section>

      <section class="panel"><h2>Privacidad</h2>
        <form class="inline-form" data-section="privacy">
          <div class="field"><label for="p-url">Enlace a la política de tratamiento de datos</label><input class="input" id="p-url" name="privacy_policy_url" type="url" value="${st.privacy_policy_url || ""}"></div>
          <div class="field"><label for="p-ver">Versión vigente del aviso</label><input class="input" id="p-ver" name="privacy_notice_version" value="${st.privacy_notice_version || ""}" maxlength="40">
            <p class="small muted" style="margin:4px 0 0">Cámbiala (por ejemplo, a la fecha de hoy) cada vez que modifiques la política. Cada consentimiento queda guardado con la versión que la persona aceptó.</p></div>
          <button class="btn btn-dark btn-sm" type="submit">Guardar</button>
        </form></section>

      <section class="panel"><h2>Lista de espera</h2>
        <form class="inline-form" data-section="waitlist">
          <label class="switch"><input type="checkbox" name="waitlist_enabled" ${raw(st.waitlist_enabled !== false ? "checked" : "")}> Lista de espera abierta al público</label>
          <div class="field"><span class="label">Orden de la lista (después de la prioridad manual)</span>
            <div class="chips">
              <label class="chip"><input type="radio" name="waitlist_order" value="registered" ${raw(st.waitlist_order !== "joined" ? "checked" : "")}><span>Fecha de registro</span></label>
              <label class="chip"><input type="radio" name="waitlist_order" value="joined" ${raw(st.waitlist_order === "joined" ? "checked" : "")}><span>Fecha de ingreso a la lista</span></label>
            </div></div>
          <button class="btn btn-dark btn-sm" type="submit">Guardar</button>
        </form></section>

      <section class="panel"><h2>Reservas web</h2>
        <form class="inline-form" data-section="booking">
          <label class="switch"><input type="checkbox" name="booking_enabled" ${raw(st.booking_enabled !== false ? "checked" : "")}> Reservas en línea activas</label>
          <label class="switch"><input type="checkbox" name="booking_auto_confirm" ${raw(st.booking_auto_confirm ? "checked" : "")}> Confirmar automáticamente (sin revisión)</label>
          <div class="grid2">
            <div class="field"><label for="b-min">Antelación mínima (horas)</label><input class="input" id="b-min" name="booking_min_notice_hours" type="number" min="0" max="336" value="${st.booking_min_notice_hours ?? 12}"></div>
            <div class="field"><label for="b-max">Días visibles hacia adelante</label><input class="input" id="b-max" name="booking_max_days_ahead" type="number" min="1" max="60" value="${st.booking_max_days_ahead ?? 21}"></div>
          </div>
          <div class="field"><label for="b-pend">Solicitudes pendientes por persona</label><input class="input" id="b-pend" name="booking_max_pending_per_student" type="number" min="1" max="10" value="${st.booking_max_pending_per_student ?? 2}"></div>
          <button class="btn btn-dark btn-sm" type="submit">Guardar</button>
        </form>
        <form class="inline-form" data-section="policy" style="margin-top:16px">
          <div class="field"><label for="b-pol">Política de cancelación y reprogramación (se muestra en /reservar)</label>
            <textarea class="input" id="b-pol" name="cancellation_policy" maxlength="600">${st.cancellation_policy || ""}</textarea></div>
          <button class="btn btn-dark btn-sm" type="submit">Guardar política</button>
        </form></section>
    </div>

    <section class="panel" style="margin-top:16px" id="form-settings"><h2>Formulario de registro</h2>
      <form class="inline-form" data-section="form">
        <span class="label" style="font-weight:700">Campos opcionales visibles</span>
        <div style="display:flex;flex-wrap:wrap;gap:14px">
          <label class="switch"><input type="checkbox" name="sof_professional_goals" ${raw(sof.professional_goals !== false ? "checked" : "")}> Metas profesionales</label>
          <label class="switch"><input type="checkbox" name="sof_comments" ${raw(sof.comments !== false ? "checked" : "")}> Comentarios</label>
          <label class="switch"><input type="checkbox" name="sof_referral_source" ${raw(sof.referral_source !== false ? "checked" : "")}> Cómo nos conoció</label>
        </div>
        <div class="field"><label for="f-ref">Opciones de “¿Cómo nos conociste?” (una por línea)</label>
          <textarea class="input" id="f-ref" name="referral_options" rows="5">${(st.referral_options || []).join("\n")}</textarea></div>
        <span class="label" style="font-weight:700">Preguntas adicionales</span>
        <div id="questions"></div>
        <div class="btn-row"><button class="btn btn-soft btn-sm" type="button" id="add-q">Agregar pregunta</button>
          <button class="btn btn-dark btn-sm" type="submit">Guardar formulario</button></div>
      </form></section>

    <section class="panel" style="margin-top:16px"><h2>Plantillas de WhatsApp</h2>
      <form class="inline-form" data-section="wa">
        <p class="small muted" style="margin:0">Variables: <code>{nombre}</code>, <code>{link}</code> (página de reservas, solo en la invitación), <code>{fecha}</code>, <code>{tipo}</code> y <code>{enlace}</code> (enlace de la sesión). Los avisos de sesión se preparan solos en Mensajes.</p>
        <div class="field"><label for="w-wel">Primer contacto (ventana de prospectos)</label><textarea class="input" id="w-wel" name="welcome" maxlength="800" placeholder="${DEFAULT_WELCOME}">${wa.welcome || ""}</textarea>
          <p class="small muted" style="margin:4px 0 0">Variables: <code>{nombre}</code> y <code>{objetivo}</code>. Vacío = saludo predeterminado.</p></div>
        <div class="field"><label for="w-inv">Invitación a reservar</label><textarea class="input" id="w-inv" name="invite" maxlength="800">${wa.invite || ""}</textarea></div>
        <div class="field"><label for="w-fu">Seguimiento</label><textarea class="input" id="w-fu" name="followup" maxlength="800">${wa.followup || ""}</textarea></div>
        <div class="field"><label for="w-cf">Sesión confirmada</label><textarea class="input" id="w-cf" name="confirm" maxlength="800">${wa.confirm || ""}</textarea></div>
        <div class="field"><label for="w-rs">Sesión reprogramada</label><textarea class="input" id="w-rs" name="reschedule" maxlength="800">${wa.reschedule || ""}</textarea></div>
        <div class="field"><label for="w-cn">Sesión cancelada</label><textarea class="input" id="w-cn" name="cancel" maxlength="800">${wa.cancel || ""}</textarea></div>
        <div class="field"><label for="w-rm">Recordatorio (24 h antes)</label><textarea class="input" id="w-rm" name="reminder" maxlength="800">${wa.reminder || ""}</textarea></div>
        <button class="btn btn-dark btn-sm" type="submit">Guardar plantillas</button>
      </form></section>

    <section class="panel" style="margin-top:16px"><h2>Nombres de los estados</h2>
      <p class="small muted" style="margin-top:-6px">Cambia cómo se llaman los estados en el panel (por ejemplo, "En fila" en vez de "En lista de espera"). Déjalo vacío para usar el nombre por defecto. Las reglas no cambian.</p>
      <form class="inline-form" data-section="labels">
        <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
          <div>${LEAD_STATUSES.map((c) => html`<div class="field"><label for="lb-l-${c}">Lead: ${defaultLabel("lead", c)}</label>
            <input class="input" id="lb-l-${c}" data-label-lead="${c}" maxlength="40" value="${(st.status_labels && st.status_labels.lead && st.status_labels.lead[c]) || ""}"></div>`)}</div>
          <div>${STUDENT_STATUSES.map((c) => html`<div class="field"><label for="lb-s-${c}">Estudiante: ${defaultLabel("student", c)}</label>
            <input class="input" id="lb-s-${c}" data-label-student="${c}" maxlength="40" value="${(st.status_labels && st.status_labels.student && st.status_labels.student[c]) || ""}"></div>`)}</div>
        </div>
        <button class="btn btn-dark btn-sm" type="submit">Guardar nombres</button>
      </form></section>
    <section class="panel" style="margin-top:16px" id="types"></section>
    <section class="panel" style="margin-top:16px" id="plans"></section>
    <section class="panel" style="margin-top:16px" id="steps"></section>
    <section class="panel" style="margin-top:16px" id="team"></section>
    <section class="panel" style="margin-top:16px"><h2>Respaldo y conservación de datos</h2>
      <p>Descarga una copia completa (JSON) de todos los datos del sistema: personas, leads, sesiones, pagos, progreso, evaluaciones, tareas e historial. Guárdala en un lugar privado; contiene datos personales.</p>
      <p class="small muted">Para respaldos automáticos de toda la base de datos y su restauración, revisa la sección "Respaldos" del README del sistema.</p>
      <button class="btn btn-soft btn-sm" type="button" id="backup">Descargar respaldo completo</button>
    </section>`);

  bindCopy();

  /* --- preguntas adicionales --- */
  function paintQuestions() {
    const box = $("#questions", el);
    mount(box, questions.length ? html`${questions.map((qq, i) => html`<div class="rule-row" data-q="${i}" style="grid-template-columns: 2fr 1fr 1.6fr auto auto auto">
        <input class="input" data-k="label" value="${qq.label}" placeholder="Texto de la pregunta" aria-label="Pregunta">
        <select class="input" data-k="type" aria-label="Tipo">${selectOptions([{ value: "text", label: "Texto corto" }, { value: "textarea", label: "Texto largo" }, { value: "select", label: "Opciones" }, { value: "checkbox", label: "Sí / No" }], qq.type)}</select>
        <input class="input" data-k="options" value="${(qq.options || []).join(", ")}" placeholder="Opciones separadas por coma" ${raw(qq.type === "select" ? "" : "disabled")} aria-label="Opciones">
        <label class="switch"><input type="checkbox" data-k="required" ${raw(qq.required ? "checked" : "")}> Obligatoria</label>
        <label class="switch"><input type="checkbox" data-k="active" ${raw(qq.active !== false ? "checked" : "")}> Visible</label>
        <button class="btn btn-soft btn-sm" type="button" data-rmq="${i}">Quitar</button>
      </div>`)}` : html`<p class="small muted">Sin preguntas adicionales. Úsalas para datos propios de tu proceso (empresa, fecha de un examen, etc.). Evita pedir datos sensibles.</p>`);
  }
  paintQuestions();
  $("#questions", el).addEventListener("input", (e) => {
    const row = e.target.closest("[data-q]"); if (!row) return;
    const qq = questions[Number(row.dataset.q)];
    const k = e.target.dataset.k;
    if (k === "label") qq.label = e.target.value;
    if (k === "options") qq.options = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
  });
  $("#questions", el).addEventListener("change", (e) => {
    const row = e.target.closest("[data-q]"); if (!row) return;
    const qq = questions[Number(row.dataset.q)];
    const k = e.target.dataset.k;
    if (k === "type") { qq.type = e.target.value; if (qq.type === "select" && !qq.options) qq.options = []; paintQuestions(); }
    if (k === "required" || k === "active") qq[k] = e.target.checked;
  });
  $("#questions", el).addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rmq]"); if (!rm) return;
    questions.splice(Number(rm.dataset.rmq), 1); paintQuestions();
  });
  $("#add-q", el).addEventListener("click", () => {
    questions.push({ id: "", label: "", type: "text", required: false, active: true });
    paintQuestions();
    const inputs = $$('#questions [data-k="label"]', el);
    inputs[inputs.length - 1].focus();
  });

  /* --- guardar secciones --- */
  el.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-section]");
    if (!form) return;
    e.preventDefault();
    const s = form.dataset.section;
    const v = (n) => form.elements[n].value.trim();
    let patch;
    try {
      if (s === "general") patch = { timezone: v("timezone"), controller_name: v("controller_name"), contact_email: v("contact_email"), contact_whatsapp: v("contact_whatsapp") };
      else if (s === "privacy") {
        if (!/^https:\/\//.test(v("privacy_policy_url"))) throw userError("El enlace debe empezar por https://");
        patch = { privacy_policy_url: v("privacy_policy_url"), privacy_notice_version: v("privacy_notice_version") };
      } else if (s === "waitlist") patch = { waitlist_enabled: form.elements.waitlist_enabled.checked, waitlist_order: form.querySelector('input[name="waitlist_order"]:checked').value };
      else if (s === "booking") patch = {
        booking_enabled: form.elements.booking_enabled.checked, booking_auto_confirm: form.elements.booking_auto_confirm.checked,
        booking_min_notice_hours: Number(v("booking_min_notice_hours")), booking_max_days_ahead: Number(v("booking_max_days_ahead")),
        booking_max_pending_per_student: Number(v("booking_max_pending_per_student"))
      };
      else if (s === "wa") patch = { wa_templates: { welcome: v("welcome"), invite: v("invite"), followup: v("followup"), confirm: v("confirm"), reschedule: v("reschedule"), cancel: v("cancel"), reminder: v("reminder") } };
      else if (s === "labels") {
        const lead = {}, student = {};
        $$('[data-label-lead]', form).forEach((i) => { if (i.value.trim()) lead[i.dataset.labelLead] = i.value.trim().slice(0, 40); });
        $$('[data-label-student]', form).forEach((i) => { if (i.value.trim()) student[i.dataset.labelStudent] = i.value.trim().slice(0, 40); });
        patch = { status_labels: { lead, student } };
      } else if (s === "policy") patch = { cancellation_policy: v("cancellation_policy") };
      else if (s === "form") {
        const used = new Set();
        const qs = questions.filter((x) => x.label.trim()).map((x) => {
          let id = x.id || slug(x.label);
          let n = 2; const baseId = id;
          while (used.has(id)) id = (baseId.slice(0, 29) + "_" + n++);
          used.add(id);
          if (x.type === "select" && !(x.options || []).length) throw userError(`La pregunta “${x.label}” necesita opciones.`);
          return { id, label: x.label.trim().slice(0, 200), type: x.type, options: x.type === "select" ? x.options.slice(0, 20) : [], required: !!x.required, active: x.active !== false };
        });
        patch = {
          show_optional_fields: { professional_goals: form.elements.sof_professional_goals.checked, comments: form.elements.sof_comments.checked, referral_source: form.elements.sof_referral_source.checked },
          referral_options: v("referral_options").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 30),
          extra_questions: qs
        };
      }
      S.settings = await rpc("sms_update_settings", { p_patch: patch });
      setLabelOverrides(S.settings.status_labels);
      if (s === "form") { questions = JSON.parse(JSON.stringify(S.settings.extra_questions || [])); paintQuestions(); }
      toast("Ajustes guardados.", "ok");
    } catch (err) {
      toast(err.userMessage || apiErrorText(err), "err", 6000);
    }
  });

  /* --- planes --- */
  async function paintPlans() {
    S.plans = await q((c) => c.from("sms_plans").select("*").order("sort").order("name"));
    mount($("#plans", el), html`<h2>Planes <span class="spacer"></span><button class="btn btn-soft btn-sm" type="button" data-plan="new">Nuevo plan</button></h2>
      <div class="rows">${S.plans.map((p) => html`<div class="row" style="--cols: 1.4fr 1fr 1fr 1fr auto">
        <b>${p.name}</b><span>${p.currency} ${p.price}</span><span>${label("billing", p.billing)}</span>
        <span>${p.hours_per_month ? p.hours_per_month + " h/mes" : "—"} ${p.active ? "" : html`<span class="flag">Inactivo</span>`}</span>
        <button class="btn btn-soft btn-sm" type="button" data-plan="${p.id}">Editar</button></div>`)}</div>`);
  }
  $("#plans", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-plan]"); if (!b) return;
    const p = S.plans.find((x) => x.id === b.dataset.plan) || { name: "", price: "", currency: "USD", billing: "monthly", hours_per_month: "", description: "", active: true, sort: S.plans.length + 1 };
    openDialog({
      title: p.id ? "Editar plan" : "Nuevo plan",
      body: html`
        <div class="field"><label for="pl-n">Nombre</label><input class="input" id="pl-n" name="name" maxlength="80" value="${p.name}"></div>
        <div class="grid2">
          <div class="field"><label for="pl-p">Precio</label><input class="input" id="pl-p" name="price" type="number" min="0" step="0.01" value="${p.price}"></div>
          <div class="field"><label for="pl-c">Moneda</label><select class="input" id="pl-c" name="currency">${selectOptions(["USD", "COP", "EUR", "MXN"].map((c) => ({ value: c, label: c })), p.currency)}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="pl-b">Cobro</label><select class="input" id="pl-b" name="billing">${selectOptions(["monthly", "yearly", "one_time"].map((x) => ({ value: x, label: label("billing", x) })), p.billing)}</select></div>
          <div class="field"><label for="pl-h">Horas al mes</label><input class="input" id="pl-h" name="hours_per_month" type="number" min="0" step="0.5" value="${p.hours_per_month ?? ""}"></div>
        </div>
        <div class="field"><label for="pl-d">Descripción</label><input class="input" id="pl-d" name="description" maxlength="500" value="${p.description || ""}"></div>
        <label class="switch"><input type="checkbox" name="active" ${raw(p.active ? "checked" : "")}> Plan activo (disponible para asignar)</label>`,
      onSubmit: async (f) => {
        const row = { name: f.elements.name.value.trim(), price: Number(f.elements.price.value || 0), currency: f.elements.currency.value, billing: f.elements.billing.value,
          hours_per_month: f.elements.hours_per_month.value === "" ? null : Number(f.elements.hours_per_month.value), description: f.elements.description.value.trim() || null, active: f.elements.active.checked };
        if (!row.name) throw userError("Escribe el nombre del plan.");
        if (p.id) await q((c) => c.from("sms_plans").update(row).eq("id", p.id));
        else await q((c) => c.from("sms_plans").insert({ ...row, sort: p.sort }));
        toast("Plan guardado.", "ok");
        paintPlans();
      }
    });
  });

  /* --- ruta de pasos --- */
  async function paintSteps() {
    S.steps = await q((c) => c.from("sms_journey_steps").select("*").order("step_no"));
    mount($("#steps", el), html`<h2>Ruta de aprendizaje (${S.steps.filter((s) => s.active).length} pasos activos)</h2>
      <p class="small muted" style="margin-top:-6px">Estos son los pasos que se marcan en la pestaña Progreso de cada estudiante. Los cambios se guardan al salir de cada campo.</p>
      <div class="steps">${S.steps.map((s) => html`<div class="step-row" data-stepno="${s.step_no}" style="grid-template-columns: 34px 1.4fr 1.6fr auto">
        <span class="no">${s.step_no}</span>
        <input class="input" data-k="title" value="${s.title}" maxlength="120" aria-label="Título del paso ${s.step_no}">
        <input class="input" data-k="url" value="${s.url || ""}" placeholder="https://… (opcional)" aria-label="Enlace del paso ${s.step_no}">
        <span style="display:flex;gap:8px;align-items:center"><label class="switch"><input type="checkbox" data-k="active" ${raw(s.active ? "checked" : "")}> Activo</label>
          <button class="btn btn-soft btn-sm" type="button" data-step-edit="${s.step_no}">Detalles</button></span>
      </div>`)}</div>`);
  }
  $("#steps", el).addEventListener("change", async (e) => {
    const row = e.target.closest("[data-stepno]"); if (!row) return;
    const k = e.target.dataset.k;
    let v = k === "active" ? e.target.checked : e.target.value.trim();
    if (k === "url" && v && !/^https:\/\//.test(v)) { toast("El enlace debe empezar por https://", "err"); return; }
    if (k === "url" && !v) v = null;
    if (k === "title" && !v) { toast("El título no puede quedar vacío.", "err"); return; }
    try { await q((c) => c.from("sms_journey_steps").update({ [k]: v }).eq("step_no", Number(row.dataset.stepno))); toast("Paso actualizado.", "ok", 1500); }
    catch (err) { toast(apiErrorText(err), "err"); }
  });

  /* --- equipo --- */
  async function paintTeam() {
    const [staff, invites] = await Promise.all([
      q((c) => c.from("sms_staff").select("*").order("created_at")),
      q((c) => c.from("sms_staff_invites").select("*").is("accepted_at", null).order("created_at"))
    ]);
    S.staff = staff;
    mount($("#team", el), html`<h2>Equipo <span class="spacer"></span><button class="btn btn-soft btn-sm" type="button" id="invite">Invitar persona</button></h2>
      <p class="small muted" style="margin-top:-6px"><b>Dueño</b> y <b>Administrador</b>: acceso total (pagos, ajustes, borrados). <b>Equipo</b>: leads, estudiantes, agenda e historial, sin pagos ni ajustes.</p>
      <div class="rows">${staff.map((m) => html`<div class="row" style="--cols: 1.6fr 1fr 1fr auto">
        <span class="name">${m.display_name || m.email}<span class="sub">${m.email}</span></span>
        ${badge("role", m.active ? "active" : "inactive", label("role", m.role))}
        <span class="small">${m.active ? "Activo" : "Desactivado"} desde ${d(m.created_at)}</span>
        ${m.user_id === S.me.user_id ? html`<span class="small muted">Tú</span>` : html`<span style="display:flex;gap:6px">
          <select class="input" data-role="${m.user_id}" aria-label="Rol" style="min-height:38px;padding:6px 10px">${selectOptions(["owner", "admin", "staff"].map((r) => ({ value: r, label: label("role", r) })), m.role)}</select>
          <button class="btn btn-soft btn-sm" type="button" data-toggle="${m.user_id}">${m.active ? "Desactivar" : "Activar"}</button></span>`}
      </div>`)}</div>
      ${invites.length ? html`<h2 style="margin-top:16px">Invitaciones pendientes</h2><div class="rows">${invites.map((i) => html`<div class="row" style="--cols: 1.6fr 1fr auto">
        <span>${i.email}</span><span>${label("role", i.role)}</span><button class="btn btn-soft btn-sm" type="button" data-uninvite="${i.email}">Anular</button></div>`)}</div>` : ""}
      <p class="small muted">La persona invitada entra en <code>${base}admin/</code> con su correo y queda activa automáticamente.</p>`);
  }
  $("#team", el).addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-role]"); if (!sel) return;
    try { await q((c) => c.from("sms_staff").update({ role: sel.value }).eq("user_id", sel.dataset.role)); toast("Rol actualizado.", "ok"); }
    catch (err) { toast(apiErrorText(err), "err"); }
    paintTeam();
  });
  $("#team", el).addEventListener("click", async (e) => {
    const tg = e.target.closest("[data-toggle]");
    if (tg) {
      const m = S.staff.find((x) => x.user_id === tg.dataset.toggle);
      try { await q((c) => c.from("sms_staff").update({ active: !m.active }).eq("user_id", m.user_id)); } catch (err) { toast(apiErrorText(err), "err"); }
      return paintTeam();
    }
    const un = e.target.closest("[data-uninvite]");
    if (un) {
      try { await q((c) => c.from("sms_staff_invites").delete().eq("email", un.dataset.uninvite)); } catch (err) { toast(apiErrorText(err), "err"); }
      return paintTeam();
    }
    if (e.target.closest("#invite")) {
      openDialog({
        title: "Invitar al panel",
        submitLabel: "Invitar",
        body: html`
          <div class="field"><label for="i-mail">Correo</label><input class="input" id="i-mail" name="email" type="email" required></div>
          <div class="field"><label for="i-name">Nombre</label><input class="input" id="i-name" name="display_name" maxlength="80"></div>
          <div class="field"><label for="i-role">Rol</label><select class="input" id="i-role" name="role">${selectOptions(["staff", "admin", ...(S.role === "owner" ? ["owner"] : [])].map((r) => ({ value: r, label: label("role", r) })), "staff")}</select></div>`,
        onSubmit: async (f) => {
          const email = f.elements.email.value.trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw userError("Escribe un correo válido.");
          await q((c) => c.from("sms_staff_invites").upsert({ email, role: f.elements.role.value, display_name: f.elements.display_name.value.trim() || null, accepted_at: null }));
          toast("Invitación creada. Compártele el enlace del panel.", "ok", 6000);
          paintTeam();
        }
      });
    }
  });

  function bindCopy() {
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-copy]"); if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.copy); toast("Enlace copiado.", "ok", 1800); }
      catch (err) { window.prompt("Copia el enlace:", b.dataset.copy); }
    });
  }

  /* --- tipos de sesión --- */
  async function paintTypes() {
    S.sessionTypes = await q((c) => c.from("sms_session_types").select("*").order("sort").order("name"));
    mount($("#types", el), html`<h2>Tipos de sesión <span class="spacer"></span><button class="btn btn-soft btn-sm" type="button" data-type="new">Nuevo tipo</button></h2>
      <p class="small muted" style="margin-top:-6px">Las franjas de disponibilidad usan estos tipos. "Visible en /reservar" decide si el público puede pedirlos.</p>
      <div class="rows">${S.sessionTypes.map((t) => html`<div class="row" style="--cols: 1.4fr 1fr 1.2fr auto">
        <b>${t.name}</b><span>${t.default_minutes} min</span>
        <span class="small">${t.is_public ? "Visible en /reservar" : "Solo interno"}${t.active ? "" : html` <span class="flag">Inactivo</span>`}</span>
        <button class="btn btn-soft btn-sm" type="button" data-type="${t.code}">Editar</button></div>`)}</div>`);
  }
  $("#types", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-type]"); if (!b) return;
    const t = S.sessionTypes.find((x) => x.code === b.dataset.type) || { name: "", default_minutes: 60, is_public: true, active: true, sort: S.sessionTypes.length + 1 };
    openDialog({
      title: t.code ? "Editar tipo de sesión" : "Nuevo tipo de sesión",
      body: html`
        <div class="field"><label for="ty-n">Nombre</label><input class="input" id="ty-n" name="name" maxlength="60" value="${t.name}" placeholder="Ej.: Clase grupal de conversación"></div>
        <div class="field"><label for="ty-m">Duración sugerida</label><select class="input" id="ty-m" name="default_minutes">${selectOptions([15, 30, 45, 60, 90, 120].map((m) => ({ value: m, label: m + " min" })), t.default_minutes)}</select></div>
        <label class="switch"><input type="checkbox" name="is_public" ${raw(t.is_public ? "checked" : "")}> Visible en /reservar</label>
        <label class="switch" style="margin-left:16px"><input type="checkbox" name="active" ${raw(t.active ? "checked" : "")}> Activo</label>
        ${t.code ? html`<p class="small muted">Para dejar de usarlo, desactívalo: las sesiones existentes conservan su tipo.</p>` : ""}`,
      onSubmit: async (fm) => {
        const row = { name: fm.elements.name.value.trim(), default_minutes: Number(fm.elements.default_minutes.value), is_public: fm.elements.is_public.checked, active: fm.elements.active.checked };
        if (!row.name) throw userError("Escribe el nombre.");
        if (t.code) await q((c) => c.from("sms_session_types").update(row).eq("code", t.code));
        else {
          let code = slug(row.name).slice(0, 30); if (code.length < 2) code = "tipo_" + Date.now().toString(36);
          if (S.sessionTypes.some((x) => x.code === code)) code = (code.slice(0, 24) + "_" + Date.now().toString(36).slice(-4));
          await q((c) => c.from("sms_session_types").insert({ ...row, code, sort: t.sort }));
        }
        toast("Tipo de sesión guardado.", "ok");
        paintTypes();
      }
    });
  });

  /* --- edición completa de un paso de la ruta --- */
  $("#steps", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-step-edit]"); if (!b) return;
    const st2 = S.steps.find((x) => x.step_no === Number(b.dataset.stepEdit));
    openDialog({
      title: `Paso ${st2.step_no}`,
      wide: true,
      body: html`
        <p class="small muted" style="margin-top:0">Completa solo lo que ya esté definido en tu método. Nada de esto se muestra al público.</p>
        <div class="field"><label for="sp-t">Nombre</label><input class="input" id="sp-t" name="title" maxlength="120" value="${st2.title}"></div>
        <div class="field"><label for="sp-u">Enlace al recurso</label><input class="input" id="sp-u" name="url" maxlength="300" value="${st2.url || ""}" placeholder="https://…"></div>
        <div class="field"><label for="sp-d">Descripción</label><textarea class="input" id="sp-d" name="description" maxlength="1500">${st2.description || ""}</textarea></div>
        <div class="field"><label for="sp-o">Objetivo de aprendizaje</label><textarea class="input" id="sp-o" name="objective" maxlength="1500">${st2.objective || ""}</textarea></div>
        <div class="field"><label for="sp-r">Actividades y recursos</label><textarea class="input" id="sp-r" name="resources" maxlength="1500">${st2.resources || ""}</textarea></div>
        <div class="field"><label for="sp-c">Criterios de finalización</label><textarea class="input" id="sp-c" name="completion_criteria" maxlength="1500">${st2.completion_criteria || ""}</textarea></div>`,
      onSubmit: async (fm) => {
        const v = (n) => fm.elements[n].value.trim();
        if (!v("title")) throw userError("El nombre no puede quedar vacío.");
        if (v("url") && !/^https:\/\//.test(v("url"))) throw userError("El enlace debe empezar por https://");
        await q((c) => c.from("sms_journey_steps").update({
          title: v("title"), url: v("url") || null, description: v("description") || null, objective: v("objective") || null,
          resources: v("resources") || null, completion_criteria: v("completion_criteria") || null
        }).eq("step_no", st2.step_no));
        toast("Paso guardado.", "ok");
        paintSteps();
      }
    });
  });

  $("#backup", el).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const data = await rpc("sms_backup_export");
      download(`respaldo-profgermandario-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
      toast("Respaldo descargado.", "ok");
    } catch (err) { toast(apiErrorText(err), "err"); }
    finally { btn.disabled = false; }
  });

  await Promise.all([paintPlans(), paintSteps(), paintTeam(), paintTypes()]);
  if (params.s === "waitlist") { const w = el.querySelector('[data-section="waitlist"]'); if (w) w.scrollIntoView({ block: "center" }); }
}
