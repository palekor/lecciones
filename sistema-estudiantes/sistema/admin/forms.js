/* Formularios reutilizables del panel: sesiones, pagos y contactos. */
import { q, rpc } from "../api.js";
import { label, options } from "../i18n.js";
import { CHANNELS, PAYMENT_METHODS, PAYMENT_STATUSES, TASK_KINDS, SKILLS, zonedLocalToISO, isoToZonedLocal, waLink, fillTemplate } from "../core.js";
import { $, html, raw, mount, toast } from "../ui.js";
import { S, dt, tm, d, sessionName } from "./state.js";
import { openDialog, userError, selectOptions, studentPicker, confirmDialog, apiErrorText } from "./widgets.js";

const opts = (group, list) => list.map((v) => ({ value: v, label: label(group, v) }));
const typeOpts = (current) => S.sessionTypes.filter((t) => t.active || t.code === current).map((t) => ({ value: t.code, label: t.name }));

/* ---------------- sesiones ---------------- */
export function bookingDialog({ student = null, booking = null, onSaved }) {
  let picked = student;
  const isEdit = !!booking;
  const start = booking ? isoToZonedLocal(booking.starts_at, S.tz) : "";
  const mins = booking ? Math.round((new Date(booking.ends_at) - new Date(booking.starts_at)) / 60000) : 60;
  openDialog({
    title: isEdit ? "Editar sesión" : "Agendar sesión",
    submitLabel: isEdit ? "Guardar cambios" : "Agendar",
    body: html`
      <div id="bk-picker">${student ? html`<p><b>${student.full_name}</b></p>` : ""}</div>
      <div class="grid2">
        <div class="field"><label for="bk-start">Fecha y hora (${S.tz.replace(/_/g, " ")})</label>
          <input class="input" id="bk-start" name="start" type="datetime-local" step="900" value="${start}" required></div>
        <div class="field"><label for="bk-mins">Duración</label>
          <select class="input" id="bk-mins" name="mins">${selectOptions([30, 45, 60, 90, 120].map((m) => ({ value: m, label: m + " min" })), mins)}</select></div>
      </div>
      <div class="field"><span class="small muted">Horarios libres (toca para usar uno):</span>
        <div class="chips" id="bk-free" style="margin-top:6px"><span class="small muted">Cargando…</span></div></div>
      <div class="grid2">
        <div class="field"><label for="bk-type">Tipo</label>
          <select class="input" id="bk-type" name="session_type">${selectOptions(typeOpts(booking && booking.session_type), booking ? booking.session_type : "class")}</select></div>
        <div class="field"><label for="bk-status">Estado</label>
          <select class="input" id="bk-status" name="status">${selectOptions(opts("booking", ["confirmed", "requested"]), booking ? booking.status : "confirmed")}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="bk-channel">Canal</label>
          <select class="input" id="bk-channel" name="channel">${selectOptions(opts("channel", CHANNELS), booking ? booking.channel : "meet", { empty: "Sin definir" })}</select></div>
        <div class="field"><label for="bk-url">Enlace de la sesión</label>
          <input class="input" id="bk-url" name="meeting_url" type="url" placeholder="https://meet.google.com/…" value="${booking ? booking.meeting_url || "" : ""}"></div>
      </div>`,
    onOpen: async (form) => {
      if (!student) studentPicker($("#bk-picker", form), (p) => { picked = { id: p.id, full_name: p.name }; });
      form.elements.session_type.addEventListener("change", () => {
        const t = S.sessionTypes.find((x) => x.code === form.elements.session_type.value);
        if (t && !isEdit) form.elements.mins.value = String(t.default_minutes);
      });
      try {
        const today = new Date().toISOString().slice(0, 10);
        const free = await rpc("sms_admin_slots", { p_from: today, p_days: 14 });
        const box = $("#bk-free", form);
        mount(box, free.length
          ? html`${free.slice(0, 16).map((s) => html`<button type="button" class="filter-chip" data-start="${s.start}" data-end="${s.end}">${d(s.start)} ${tm(s.start)}</button>`)}`
          : html`<span class="small muted">No hay horarios libres configurados. Puedes escribir cualquier fecha y hora.</span>`);
        box.addEventListener("click", (e) => {
          const b = e.target.closest("[data-start]");
          if (!b) return;
          form.elements.start.value = isoToZonedLocal(b.dataset.start, S.tz);
          form.elements.mins.value = String(Math.round((new Date(b.dataset.end) - new Date(b.dataset.start)) / 60000));
        });
      } catch (e) { /* opcional */ }
    },
    onSubmit: async (form) => {
      if (!picked) throw userError("Elige la persona.");
      const local = form.elements.start.value;
      if (!local) throw userError("Indica fecha y hora.");
      const startsAt = zonedLocalToISO(local, S.tz);
      const endsAt = new Date(new Date(startsAt).getTime() + Number(form.elements.mins.value) * 60000).toISOString();
      const url = form.elements.meeting_url.value.trim();
      if (url && !/^https:\/\//.test(url)) throw userError("El enlace debe empezar por https://");
      const row = {
        starts_at: startsAt, ends_at: endsAt, session_type: form.elements.session_type.value,
        status: form.elements.status.value, channel: form.elements.channel.value || null, meeting_url: url || null
      };
      if (isEdit) await q((c) => c.from("sms_bookings").update(row).eq("id", booking.id));
      else await q((c) => c.from("sms_bookings").insert({ ...row, student_id: picked.id, origin: "admin" }));
      toast(isEdit ? "Sesión actualizada." : "Sesión agendada.", "ok");
      if (onSaved) onSaved();
    }
  });
}

export function bookingButtons(b) {
  const future = new Date(b.ends_at) > new Date();
  const btn = (act, text, cls = "btn-soft") => html`<button class="btn ${cls} btn-sm" type="button" data-bk="${act}" data-id="${b.id}">${text}</button>`;
  const out = [];
  if (b.status === "requested") { out.push(btn("confirm", "Confirmar", "btn-primary")); out.push(btn("reject", "Rechazar")); }
  if (b.status === "confirmed" && !future) { out.push(btn("complete", "Realizada", "btn-primary")); out.push(btn("no_show", "No asistió")); }
  if (b.status === "confirmed" && future && b.whatsapp) out.push(btn("remind", "Recordar por WhatsApp"));
  if (["requested", "confirmed"].includes(b.status)) { out.push(btn("edit", "Editar")); out.push(btn("cancel", "Cancelar")); }
  return html`${out}`;
}

/** Ejecuta la acción de un botón data-bk. b debe incluir full_name y whatsapp si existen. */
export async function bookingAction(act, b, after) {
  const first = (b.full_name || "").split(" ")[0];
  const when = dt(b.starts_at);
  try {
    if (act === "edit") return bookingDialog({ student: { id: b.student_id, full_name: b.full_name }, booking: b, onSaved: after });
    if (act === "confirm") {
      await q((c) => c.from("sms_bookings").update({ status: "confirmed" }).eq("id", b.id));
      toast("Sesión confirmada. El aviso para la persona quedó listo en Mensajes.", "ok", 5000);
    } else if (act === "remind") {
      const text = fillTemplate(S.settings.wa_templates && S.settings.wa_templates.confirm, { nombre: first, fecha: when });
      window.open(waLink(b.whatsapp, text + (b.meeting_url ? "\n" + b.meeting_url : "")), "_blank", "noopener");
      return;
    } else if (act === "cancel" || act === "reject") {
      const ok = await confirmDialog({ title: act === "cancel" ? "Cancelar sesión" : "Rechazar solicitud", text: `${b.full_name} · ${when}. El horario queda libre de nuevo.`, confirmLabel: act === "cancel" ? "Cancelar sesión" : "Rechazar", danger: true });
      if (!ok) return;
      await q((c) => c.from("sms_bookings").update({ status: act === "cancel" ? "cancelled" : "rejected" }).eq("id", b.id));
      toast((act === "cancel" ? "Sesión cancelada." : "Solicitud rechazada.") + " El aviso quedó en Mensajes.", "ok", 5000);
    } else if (act === "complete" || act === "no_show") {
      await q((c) => c.from("sms_bookings").update({ status: act === "complete" ? "completed" : "no_show" }).eq("id", b.id));
      toast(act === "complete" ? "Sesión marcada como realizada." : "Marcada como no asistió.", "ok");
    }
    if (after) after();
  } catch (e) {
    toast(apiErrorText(e), "err", 6000);
  }
}

/* ---------------- pagos ---------------- */
export function paymentDialog({ student = null, payment = null, onSaved }) {
  let picked = student;
  const p = payment || {};
  const planOpts = S.plans.filter((x) => x.active || x.id === p.plan_id).map((x) => ({ value: x.id, label: `${x.name} (${x.currency} ${x.price})` }));
  openDialog({
    title: payment ? "Editar pago" : "Registrar pago",
    body: html`
      <div id="pay-picker">${student ? html`<p><b>${student.full_name}</b></p>` : ""}</div>
      <div class="field"><label for="pay-plan">Plan <span class="opt">(opcional)</span></label>
        <select class="input" id="pay-plan" name="plan_id">${selectOptions(planOpts, p.plan_id, { empty: "Sin plan" })}</select></div>
      <div class="field"><label for="pay-concept">Concepto</label>
        <input class="input" id="pay-concept" name="concept" maxlength="160" value="${p.concept || ""}" placeholder="Ej.: Plan Impulso — noviembre" required></div>
      <div class="grid2">
        <div class="field"><label for="pay-amount">Valor</label>
          <input class="input" id="pay-amount" name="amount" type="number" min="0.01" step="0.01" value="${p.amount || ""}" required></div>
        <div class="field"><label for="pay-cur">Moneda</label>
          <select class="input" id="pay-cur" name="currency">${selectOptions(["USD", "COP", "EUR", "MXN"].map((c) => ({ value: c, label: c })), p.currency || "USD")}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="pay-status">Estado</label>
          <select class="input" id="pay-status" name="status">${selectOptions(opts("payment", PAYMENT_STATUSES), p.status || "paid")}</select></div>
        <div class="field"><label for="pay-method">Medio</label>
          <select class="input" id="pay-method" name="method">${selectOptions(opts("method", PAYMENT_METHODS), p.method, { empty: "Sin especificar" })}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="pay-due">Fecha límite</label><input class="input" id="pay-due" name="due_date" type="date" value="${p.due_date || ""}"></div>
        <div class="field"><label for="pay-paid">Fecha de pago</label><input class="input" id="pay-paid" name="paid_at" type="date" value="${p.paid_at ? isoToZonedLocal(p.paid_at, S.tz).slice(0, 10) : new Date().toISOString().slice(0, 10)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="pay-ps">Período desde</label><input class="input" id="pay-ps" name="period_start" type="date" value="${p.period_start || ""}"></div>
        <div class="field"><label for="pay-pe">Período hasta</label><input class="input" id="pay-pe" name="period_end" type="date" value="${p.period_end || ""}">
          <p class="small muted" style="margin:4px 0 0">Si el pago está cobrado, esta fecha se usa como próxima renovación.</p></div>
      </div>
      <div class="field"><label for="pay-ref">Referencia <span class="opt">(opcional)</span></label>
        <input class="input" id="pay-ref" name="reference" maxlength="120" value="${p.reference || ""}" placeholder="N.º de comprobante">
        <p class="small muted" style="margin:4px 0 0">Nunca guardes aquí números de tarjeta o cuentas.</p></div>
      <div class="field"><label for="pay-notes">Notas <span class="opt">(opcional)</span></label>
        <textarea class="input" id="pay-notes" name="notes" maxlength="1000">${p.notes || ""}</textarea></div>`,
    onOpen: (form) => {
      if (!student) studentPicker($("#pay-picker", form), (x) => { picked = { id: x.id, full_name: x.name }; });
      form.elements.plan_id.addEventListener("change", () => {
        const plan = S.plans.find((x) => x.id === form.elements.plan_id.value);
        if (!plan) return;
        if (!form.elements.amount.value) form.elements.amount.value = plan.price;
        form.elements.currency.value = plan.currency;
        if (!form.elements.concept.value) form.elements.concept.value = "Plan " + plan.name;
      });
    },
    onSubmit: async (form) => {
      if (!picked) throw userError("Elige la persona.");
      const v = (n) => form.elements[n].value.trim();
      if (!v("concept")) throw userError("Escribe el concepto.");
      if (!(Number(v("amount")) > 0)) throw userError("El valor debe ser mayor que cero.");
      if (/\d{13,19}/.test(v("reference").replace(/[\s-]/g, ""))) throw userError("La referencia parece un número de tarjeta o cuenta. No lo guardes aquí.");
      const status = v("status");
      const row = {
        plan_id: v("plan_id") || null, concept: v("concept"), amount: Number(v("amount")), currency: v("currency"),
        status, method: v("method") || null, due_date: v("due_date") || null,
        paid_at: status === "paid" ? zonedLocalToISO((v("paid_at") || new Date().toISOString().slice(0, 10)) + "T12:00", S.tz) : null,
        period_start: v("period_start") || null, period_end: v("period_end") || null,
        reference: v("reference") || null, notes: v("notes") || null
      };
      if (payment) await q((c) => c.from("sms_payments").update(row).eq("id", payment.id));
      else await q((c) => c.from("sms_payments").insert({ ...row, student_id: picked.id }));
      toast("Pago guardado.", "ok");
      if (onSaved) onSaved();
    }
  });
}

/* ---------------- contacto ---------------- */
export function contactDialog({ studentId, leadId, onSaved }) {
  openDialog({
    title: "Registrar contacto",
    submitLabel: "Guardar contacto",
    body: html`
      <div class="field"><label for="ct-ch">Canal</label>
        <select class="input" id="ct-ch" name="channel">${selectOptions([{ value: "whatsapp", label: "WhatsApp" }, { value: "call", label: "Llamada" }, { value: "email", label: "Correo" }, { value: "in_person", label: "En persona" }], "whatsapp")}</select></div>
      <div class="field"><label for="ct-note">Qué pasó</label>
        <textarea class="input" id="ct-note" name="note" maxlength="1500" placeholder="Ej.: Le expliqué el plan Impulso; me responde el viernes."></textarea></div>
      <div class="field"><label for="ct-next">Próxima acción <span class="opt">(opcional)</span></label>
        <input class="input" id="ct-next" name="next_action" maxlength="300" placeholder="Ej.: enviarle la propuesta del plan Impulso"></div>
      <div class="field"><label for="ct-fu">Próximo seguimiento <span class="opt">(opcional)</span></label>
        <input class="input" id="ct-fu" name="follow" type="datetime-local"></div>`,
    onSubmit: async (form) => {
      const ch = form.elements.channel.value;
      const note = form.elements.note.value.trim();
      await q((c) => c.from("sms_activity").insert({
        student_id: studentId, lead_id: leadId || null, kind: "contact",
        summary: `Contacto por ${label("contact", ch) || (ch === "in_person" ? "reunión en persona" : ch)}${note ? ": " + note : ""}`.slice(0, 2000),
        data: { channel: ch }
      }));
      const fu = form.elements.follow.value;
      const next = form.elements.next_action.value.trim();
      const patch = {};
      if (fu) patch.next_follow_up_at = zonedLocalToISO(fu, S.tz);
      if (next) patch.next_action = next;
      if (Object.keys(patch).length) {
        if (leadId) await q((c) => c.from("sms_leads").update(patch).eq("id", leadId));
        else await q((c) => c.from("sms_students").update(patch).eq("id", studentId));
      }
      toast("Contacto registrado.", "ok");
      if (onSaved) onSaved();
    }
  });
}

/* ---------------- tareas ---------------- */
export function taskDialog({ student = null, leadId = null, task = null, onSaved }) {
  let picked = student;
  const t = task || {};
  const staffOpts = S.staff.filter((s) => s.active).map((s) => ({ value: s.user_id, label: s.display_name || s.email }));
  const due = t.due_at ? isoToZonedLocal(t.due_at, S.tz) : isoToZonedLocal(new Date(Date.now() + 86400000).toISOString(), S.tz).slice(0, 11) + "09:00";
  openDialog({
    title: task ? "Editar tarea" : "Nueva tarea",
    body: html`
      <div id="tk-picker">${student ? html`<p><b>${student.full_name}</b></p>` : ""}</div>
      <div class="grid2">
        <div class="field"><label for="tk-kind">Tipo</label>
          <select class="input" id="tk-kind" name="kind">${selectOptions(opts("task", TASK_KINDS), t.kind || "contact")}</select></div>
        <div class="field"><label for="tk-due">Para cuándo</label>
          <input class="input" id="tk-due" name="due" type="datetime-local" value="${due}" required></div>
      </div>
      <div class="field"><label for="tk-title">Qué hay que hacer</label>
        <input class="input" id="tk-title" name="title" maxlength="200" value="${t.title || ""}" placeholder="Ej.: Llamar para cerrar inscripción" required></div>
      <div class="field"><label for="tk-notes">Notas <span class="opt">(opcional)</span></label>
        <textarea class="input" id="tk-notes" name="notes" maxlength="1000">${t.notes || ""}</textarea></div>
      <div class="field"><label for="tk-as">Responsable</label>
        <select class="input" id="tk-as" name="assigned_to">${selectOptions(staffOpts, t.assigned_to || S.me.user_id, { empty: "Sin asignar" })}</select></div>`,
    onOpen: (form) => {
      if (!student && !task) {
        const box = $("#tk-picker", form);
        mount(box, html`<div id="tk-pick"></div><p class="small muted" style="margin:-4px 0 10px">Opcional: deja la persona vacía para una tarea general.</p>`);
        studentPicker($("#tk-pick", form), (p) => { picked = { id: p.id, full_name: p.name }; });
      }
      form.elements.kind.addEventListener("change", () => {
        if (!form.elements.title.value) form.elements.title.value = label("task", form.elements.kind.value);
      });
    },
    onSubmit: async (form) => {
      const title = form.elements.title.value.trim() || label("task", form.elements.kind.value);
      if (!form.elements.due.value) throw userError("Indica para cuándo es la tarea.");
      const row = {
        kind: form.elements.kind.value, title, notes: form.elements.notes.value.trim() || null,
        due_at: zonedLocalToISO(form.elements.due.value, S.tz), assigned_to: form.elements.assigned_to.value || null
      };
      if (task) await q((c) => c.from("sms_tasks").update(row).eq("id", task.id));
      else await q((c) => c.from("sms_tasks").insert({ ...row, student_id: picked ? picked.id : null, lead_id: leadId }));
      toast(task ? "Tarea actualizada." : "Tarea programada.", "ok");
      if (onSaved) onSaved();
    }
  });
}

export async function setTaskStatus(task, status, after) {
  try {
    await q((c) => c.from("sms_tasks").update({ status }).eq("id", task.id));
    toast(status === "done" ? "Tarea hecha." : status === "cancelled" ? "Tarea cancelada." : "Tarea reabierta.", "ok", 2000);
    if (after) after();
  } catch (e) { toast(apiErrorText(e), "err"); }
}

/* ---------------- evaluaciones ---------------- */
export function assessmentDialog({ student, onSaved }) {
  openDialog({
    title: "Registrar evaluación",
    body: html`
      <p class="small muted" style="margin-top:0">Cada habilidad se evalúa por separado. El resultado describe el desempeño observado; no es una certificación de nivel.</p>
      <div class="grid2">
        <div class="field"><label for="as-skill">Habilidad</label>
          <select class="input" id="as-skill" name="skill">${selectOptions(opts("skill", SKILLS), "speaking")}</select></div>
        <div class="field"><label for="as-date">Fecha</label>
          <input class="input" id="as-date" name="assessed_on" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
      </div>
      <div class="field"><label for="as-crit">Criterio o instrumento</label>
        <input class="input" id="as-crit" name="criterion" maxlength="200" placeholder="Ej.: Rúbrica de fluidez 1–5, dictado A2" required></div>
      <div class="grid2">
        <div class="field"><label for="as-res">Resultado</label>
          <input class="input" id="as-res" name="result" maxlength="60" placeholder="Ej.: 3/5, B1 estimado, logrado" required></div>
        <div class="field"><label for="as-score">Puntaje 0–100 <span class="opt">(para comparar)</span></label>
          <input class="input" id="as-score" name="score" type="number" min="0" max="100"></div>
      </div>
      <div class="field"><label for="as-com">Comentarios</label>
        <textarea class="input" id="as-com" name="comments" maxlength="1000"></textarea></div>`,
    onSubmit: async (form) => {
      const v = (n) => form.elements[n].value.trim();
      if (!v("criterion") || !v("result")) throw userError("Completa el criterio y el resultado.");
      const score = v("score") === "" ? null : Math.max(0, Math.min(100, Math.round(Number(v("score")))));
      await q((c) => c.from("sms_assessments").insert({
        student_id: student.id, skill: v("skill"), assessed_on: v("assessed_on"), criterion: v("criterion"),
        result: v("result"), score, comments: v("comments") || null
      }));
      toast("Evaluación registrada.", "ok");
      if (onSaved) onSaved();
    }
  });
}

export { raw };
