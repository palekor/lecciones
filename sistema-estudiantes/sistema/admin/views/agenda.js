/* Agenda — Módulo 3: calendario semanal, lista, confirmaciones y disponibilidad */
import { q, rpc } from "../../api.js";
import { label } from "../../i18n.js";
import { BOOKING_STATUSES, dayKey, zonedLocalToISO } from "../../core.js";
import { $, $$, html, raw, mount, toast } from "../../ui.js";
import { S, d, tm, sessionName } from "../state.js";
import { badge, selectOptions, openDialog, userError, confirmDialog, apiErrorText, safeTerm } from "../widgets.js";
import { bookingDialog, bookingButtons, bookingAction } from "../forms.js";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][n - 1] }));
const typeOpts = (current) => S.sessionTypes.filter((t) => t.active || t.code === current).map((t) => ({ value: t.code, label: t.name }));

/** Lunes (fecha local YYYY-MM-DD) de la semana que contiene la fecha dada. */
function mondayOf(key) {
  const [y, m, dd] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}
function addDays(key, n) {
  const [y, m, dd] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd + n));
  return dt.toISOString().slice(0, 10);
}

export async function render(el, params, ctx) {
  let mode = params.f === "requested" ? "list" : (params.view || "week");
  let listFilter = params.f === "requested" ? "requested" : "upcoming";
  let week = mondayOf(dayKey(new Date().toISOString(), S.tz));
  let bookings = [];
  const f = { type: "", status: "", q: "" };

  mount(el, html`
    <div class="toolbar">
      <div class="filters" role="group" aria-label="Vista" style="margin:0">
        <button class="filter-chip" type="button" data-mode="week" aria-pressed="${mode === "week"}">Semana</button>
        <button class="filter-chip" type="button" data-mode="list" aria-pressed="${mode === "list"}">Lista</button>
      </div>
      <span style="flex:1"></span>
      <button class="btn btn-primary" type="button" id="new-booking">Agendar sesión</button>
    </div>
    <form class="toolbar" id="bk-filters" role="search">
      <input class="input search" name="q" type="search" placeholder="Filtrar por estudiante" aria-label="Filtrar por estudiante">
      <select class="input" name="type" aria-label="Tipo">${selectOptions(S.sessionTypes.map((t) => ({ value: t.code, label: t.name })), "", { empty: "Todos los tipos" })}</select>
      <select class="input" name="status" aria-label="Estado">${selectOptions(BOOKING_STATUSES.map((s) => ({ value: s, label: label("booking", s) })), "", { empty: "Todos los estados" })}</select>
    </form>
    <section id="bookings"></section>
    <section class="panel" style="margin-top:22px" id="availability"></section>`);

  async function loadBookings() {
    const box = $("#bookings", el);
    mount(box, html`<div class="loading"><span class="spinner"></span> Cargando sesiones…</div>`);
    const now = new Date().toISOString();
    const t = safeTerm(f.q);
    if (mode === "week") {
      const from = zonedLocalToISO(week + "T00:00", S.tz);
      const to = zonedLocalToISO(addDays(week, 7) + "T00:00", S.tz);
      const [rows, free] = await Promise.all([
        q((c) => {
          let qb = c.from("sms_bookings_v").select("*").gte("starts_at", from).lt("starts_at", to).order("starts_at");
          if (f.type) qb = qb.eq("session_type", f.type);
          if (f.status) qb = qb.eq("status", f.status);
          else qb = qb.not("status", "in", "(cancelled,rejected)");
          if (t) qb = qb.ilike("full_name", `*${t}*`);
          return qb.limit(500);
        }),
        rpc("sms_admin_slots", { p_from: week, p_days: 7 })
      ]);
      bookings = rows;
      const days = [...Array(7)].map((_, i) => addDays(week, i));
      const today = dayKey(now, S.tz);
      const fmtRange = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });
      const [y1, m1, d1] = days[0].split("-").map(Number);
      const [y2, m2, d2] = days[6].split("-").map(Number);
      mount(box, html`
        <div class="toolbar" style="margin-bottom:8px">
          <button class="btn btn-soft btn-sm" type="button" data-week="-7" aria-label="Semana anterior">◀</button>
          <b style="min-width:150px;text-align:center">${fmtRange.format(new Date(y1, m1 - 1, d1))} – ${fmtRange.format(new Date(y2, m2 - 1, d2))}</b>
          <button class="btn btn-soft btn-sm" type="button" data-week="7" aria-label="Semana siguiente">▶</button>
          <button class="btn btn-soft btn-sm" type="button" data-week="0">Hoy</button>
        </div>
        <div class="week">${days.map((k) => {
          const items = rows.filter((b) => dayKey(b.starts_at, S.tz) === k);
          const libres = free.filter((s) => dayKey(s.start, S.tz) === k).length;
          const [yy, mm, ddd] = k.split("-").map(Number);
          const title = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric" }).format(new Date(yy, mm - 1, ddd));
          return html`<div class="week-day ${k === today ? "today" : ""}">
            <h3>${title}</h3>
            ${items.map((b) => html`<button type="button" class="cal-item s-${b.status}" data-open="${b.id}" title="${b.full_name}">
              <b>${tm(b.starts_at)}</b> ${b.full_name}<span>${sessionName(b.session_type)} · ${label("booking", b.status)}</span></button>`)}
            ${items.length ? "" : html`<p class="small muted" style="margin:4px 0">Sin sesiones</p>`}
            ${libres ? html`<p class="small muted" style="margin:6px 0 0">${libres} horario${libres === 1 ? "" : "s"} libre${libres === 1 ? "" : "s"}</p>` : ""}
          </div>`;
        })}</div>`);
      return;
    }
    bookings = await q((c) => {
      let qb = c.from("sms_bookings_v").select("*");
      if (listFilter === "past") qb = qb.lt("starts_at", now).gte("starts_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("starts_at", { ascending: false });
      else if (listFilter === "requested") qb = qb.eq("status", "requested").gte("ends_at", now).order("starts_at");
      else qb = qb.in("status", ["requested", "confirmed"]).gte("ends_at", now).order("starts_at");
      if (f.type) qb = qb.eq("session_type", f.type);
      if (f.status) qb = qb.eq("status", f.status);
      if (t) qb = qb.ilike("full_name", `*${t}*`);
      return qb.limit(300);
    });
    const groups = [];
    for (const b of bookings) {
      const k = dayKey(b.starts_at, S.tz);
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, items: [] });
      groups[groups.length - 1].items.push(b);
    }
    mount(box, html`
      <div class="filters" role="group" aria-label="Qué mostrar">
        ${[["upcoming", "Próximas"], ["requested", "Por confirmar"], ["past", "Últimos 30 días"]].map(([v, t2]) =>
          html`<button class="filter-chip" type="button" data-f="${v}" aria-pressed="${listFilter === v}">${t2}</button>`)}
      </div>
      ${groups.length ? html`${groups.map((g) => html`<div class="day-group">
        <h3>${new Intl.DateTimeFormat("es", { timeZone: S.tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(g.items[0].starts_at))}</h3>
        ${g.items.map((b) => bookingRow(b))}</div>`)}`
      : html`<div class="empty-state"><b>${listFilter === "requested" ? "No hay solicitudes por confirmar." : listFilter === "past" ? "Sin sesiones en los últimos 30 días." : "No hay sesiones próximas."}</b>
          ${listFilter === "upcoming" ? "Activa horarios abajo para que las personas puedan reservar desde /reservar/." : ""}</div>`}`);
  }

  function bookingRow(b) {
    return html`<div class="booking">
      <span><span class="time">${tm(b.starts_at)}</span><span class="small muted" style="display:block">${Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000)} min</span></span>
      <span><a href="#/persona/${b.student_id}" style="font-weight:700;color:inherit">${b.full_name}</a> ${badge("booking", b.status)}
        <span class="small muted" style="display:block">${sessionName(b.session_type)}${b.channel ? " · " + label("channel", b.channel) : ""}${b.origin === "public" ? " · desde la web" : ""}${b.student_message ? " · “" + b.student_message + "”" : ""}</span></span>
      <span class="acts">${bookingButtons(b)}</span>
    </div>`;
  }

  async function loadAvailability() {
    const box = $("#availability", el);
    const [rules, exc, free] = await Promise.all([
      q((c) => c.from("sms_availability_rules").select("*").order("weekday").order("start_time")),
      q((c) => c.from("sms_availability_exceptions").select("*").gte("on_date", new Date().toISOString().slice(0, 10)).order("on_date")),
      rpc("sms_admin_slots", { p_from: new Date().toISOString().slice(0, 10), p_days: 14 })
    ]);
    const ro = !S.isAdmin;
    const dis = raw(ro ? "disabled" : "");
    mount(box, html`
      <h2>Disponibilidad para reservas web <span class="spacer"></span><span class="small muted">${free.length} horarios libres en 14 días</span></h2>
      <p class="small muted" style="margin-top:-6px">Horas en ${S.tz.replace(/_/g, " ")}. Cada franja se divide en sesiones de la duración indicada, con la pausa elegida entre una y otra. Las personas ven estos horarios en /reservar/ con ${S.settings.booking_min_notice_hours ?? 12} h de antelación mínima.</p>
      ${rules.length ? html`<div>
        <div class="rule-row small muted" style="border-top:0;font-weight:700"><span>Día</span><span>Desde</span><span>Hasta</span><span>Duración</span><span>Pausa</span><span>Tipo</span><span></span><span></span></div>
        ${rules.map((r) => html`<div class="rule-row" data-rule="${r.id}">
          <select class="input" data-k="weekday" ${dis} aria-label="Día">${selectOptions(WEEKDAYS, r.weekday)}</select>
          <input class="input" type="time" data-k="start_time" value="${r.start_time.slice(0, 5)}" ${dis} aria-label="Desde">
          <input class="input" type="time" data-k="end_time" value="${r.end_time.slice(0, 5)}" ${dis} aria-label="Hasta">
          <select class="input" data-k="slot_minutes" ${dis} aria-label="Duración">${selectOptions([30, 45, 60, 90, 120].map((m) => ({ value: m, label: m + " min" })), r.slot_minutes)}</select>
          <select class="input" data-k="buffer_minutes" ${dis} aria-label="Pausa entre sesiones">${selectOptions([0, 5, 10, 15, 30].map((m) => ({ value: m, label: m ? m + " min" : "Sin pausa" })), r.buffer_minutes || 0)}</select>
          <select class="input" data-k="session_type" ${dis} aria-label="Tipo">${selectOptions(typeOpts(r.session_type), r.session_type)}</select>
          <label class="switch"><input type="checkbox" data-k="active" ${raw(r.active ? "checked" : "")} ${dis}> Activa</label>
          ${ro ? html`<span></span>` : html`<button class="btn btn-soft btn-sm" type="button" data-del-rule="${r.id}" aria-label="Eliminar franja">Eliminar</button>`}
        </div>`)}</div>` : html`<div class="empty-state">Sin franjas configuradas.</div>`}
      ${ro ? html`<p class="small muted">Solo un administrador puede cambiar la disponibilidad.</p>` : html`<div class="btn-row" style="margin-top:12px">
        <button class="btn btn-soft btn-sm" type="button" id="add-rule">Agregar franja semanal</button>
        <button class="btn btn-soft btn-sm" type="button" id="add-exc">Bloquear o abrir una fecha</button></div>`}
      <h2 style="margin-top:22px">Fechas especiales</h2>
      ${exc.length ? html`<div class="rows">${exc.map((x) => html`<div class="row" style="--cols: 1fr 1.4fr 1.4fr auto">
          <b>${d(x.on_date + "T12:00:00")}</b>
          <span>${x.kind === "block" ? (x.start_time ? `Bloqueado de ${x.start_time.slice(0, 5)} a ${x.end_time.slice(0, 5)}` : "Día bloqueado") : `Abierto de ${x.start_time.slice(0, 5)} a ${x.end_time.slice(0, 5)} (${x.slot_minutes || 60} min)`}</span>
          <span class="small muted">${x.note || ""}</span>
          ${ro ? html`<span></span>` : html`<button class="btn btn-soft btn-sm" type="button" data-del-exc="${x.id}">Quitar</button>`}
        </div>`)}</div>` : html`<p class="small muted">No hay fechas bloqueadas ni aperturas especiales.</p>`}`);
  }

  const form = $("#bk-filters", el);
  let timer;
  form.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { f.q = form.elements.q.value; f.type = form.elements.type.value; f.status = form.elements.status.value; loadBookings(); }, e.target.name === "q" ? 300 : 0);
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  // Cambios de franjas: se guardan al instante
  el.addEventListener("change", async (e) => {
    const row = e.target.closest("[data-rule]");
    if (!row || !S.isAdmin) return;
    const k = e.target.dataset.k;
    let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (["weekday", "slot_minutes", "buffer_minutes"].includes(k)) v = Number(v);
    try {
      await q((c) => c.from("sms_availability_rules").update({ [k]: v }).eq("id", row.dataset.rule));
      toast("Disponibilidad actualizada.", "ok", 1800);
      loadAvailability();
    } catch (err) { toast(apiErrorText(err), "err"); loadAvailability(); }
  });

  el.addEventListener("click", async (e) => {
    const mb = e.target.closest("[data-mode]");
    if (mb) {
      mode = mb.dataset.mode;
      $$("[data-mode]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === mb)));
      return loadBookings();
    }
    const wb = e.target.closest("[data-week]");
    if (wb) {
      const n = Number(wb.dataset.week);
      week = n === 0 ? mondayOf(dayKey(new Date().toISOString(), S.tz)) : addDays(week, n);
      return loadBookings();
    }
    const fb = e.target.closest("[data-f]");
    if (fb) {
      listFilter = fb.dataset.f;
      return loadBookings();
    }
    const ob = e.target.closest("[data-open]");
    if (ob) {
      const b = bookings.find((x) => x.id === ob.dataset.open);
      openDialog({
        title: `${b.full_name} · ${tm(b.starts_at)}`,
        body: html`<p>${sessionName(b.session_type)} · ${d(b.starts_at)} · ${badge("booking", b.status)}</p>
          ${b.student_message ? html`<p class="small muted">“${b.student_message}”</p>` : ""}
          ${b.meeting_url ? html`<p><a href="${b.meeting_url}" target="_blank" rel="noopener">Enlace de la sesión</a></p>` : ""}
          <div class="btn-row">${bookingButtons(b)}<a class="btn btn-soft btn-sm" href="#/persona/${b.student_id}">Ver ficha</a></div>`,
        onOpen: (fm, dlg) => {
          fm.addEventListener("click", (ev) => {
            const bk = ev.target.closest("[data-bk]");
            if (bk) { dlg.close(); dlg.remove(); bookingAction(bk.dataset.bk, b, refreshAll); }
            if (ev.target.closest("a[href^='#/persona']")) { dlg.close(); dlg.remove(); }
          });
        }
      });
      return;
    }
    const bk = e.target.closest("[data-bk]");
    if (bk && !bk.closest("dialog")) {
      const b = bookings.find((x) => x.id === bk.dataset.id);
      return bookingAction(bk.dataset.bk, b, refreshAll);
    }
    if (e.target.closest("#new-booking")) return bookingDialog({ onSaved: refreshAll });
    const dr = e.target.closest("[data-del-rule]");
    if (dr) {
      if (!(await confirmDialog({ title: "Eliminar franja", text: "Las sesiones ya agendadas no se afectan.", confirmLabel: "Eliminar", danger: true }))) return;
      try { await q((c) => c.from("sms_availability_rules").delete().eq("id", dr.dataset.delRule)); loadAvailability(); } catch (err) { toast(apiErrorText(err), "err"); }
      return;
    }
    const de = e.target.closest("[data-del-exc]");
    if (de) {
      try { await q((c) => c.from("sms_availability_exceptions").delete().eq("id", de.dataset.delExc)); loadAvailability(); } catch (err) { toast(apiErrorText(err), "err"); }
      return;
    }
    if (e.target.closest("#add-rule")) {
      openDialog({
        title: "Agregar franja semanal",
        body: html`
          <div class="field"><label for="r-day">Día</label><select class="input" id="r-day" name="weekday">${selectOptions(WEEKDAYS, 1)}</select></div>
          <div class="grid2">
            <div class="field"><label for="r-from">Desde</label><input class="input" id="r-from" name="start_time" type="time" value="08:00"></div>
            <div class="field"><label for="r-to">Hasta</label><input class="input" id="r-to" name="end_time" type="time" value="12:00"></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="r-min">Duración de cada sesión</label><select class="input" id="r-min" name="slot_minutes">${selectOptions([30, 45, 60, 90, 120].map((m) => ({ value: m, label: m + " min" })), 60)}</select></div>
            <div class="field"><label for="r-buf">Pausa entre sesiones</label><select class="input" id="r-buf" name="buffer_minutes">${selectOptions([0, 5, 10, 15, 30].map((m) => ({ value: m, label: m ? m + " min" : "Sin pausa" })), 0)}</select></div>
          </div>
          <div class="field"><label for="r-type">Tipo de sesión</label><select class="input" id="r-type" name="session_type">${selectOptions(typeOpts(), "diagnostic")}</select></div>`,
        onSubmit: async (fm) => {
          if (fm.elements.end_time.value <= fm.elements.start_time.value) throw userError("La hora final debe ser posterior a la inicial.");
          await q((c) => c.from("sms_availability_rules").insert({
            weekday: Number(fm.elements.weekday.value), start_time: fm.elements.start_time.value, end_time: fm.elements.end_time.value,
            slot_minutes: Number(fm.elements.slot_minutes.value), buffer_minutes: Number(fm.elements.buffer_minutes.value),
            session_type: fm.elements.session_type.value, active: true
          }));
          toast("Franja agregada.", "ok");
          loadAvailability();
        }
      });
      return;
    }
    if (e.target.closest("#add-exc")) {
      openDialog({
        title: "Bloquear o abrir una fecha",
        body: html`
          <div class="field"><label for="x-date">Fecha</label><input class="input" id="x-date" name="on_date" type="date" required></div>
          <div class="field"><label for="x-kind">Qué hacer</label><select class="input" id="x-kind" name="kind">
            ${selectOptions([{ value: "block_day", label: "Bloquear el día completo" }, { value: "block", label: "Bloquear unas horas" }, { value: "extra", label: "Abrir horas extra ese día" }], "block_day")}</select></div>
          <div class="grid2">
            <div class="field"><label for="x-from">Desde</label><input class="input" id="x-from" name="start_time" type="time"></div>
            <div class="field"><label for="x-to">Hasta</label><input class="input" id="x-to" name="end_time" type="time"></div>
          </div>
          <div class="field"><label for="x-note">Nota <span class="opt">(opcional)</span></label><input class="input" id="x-note" name="note" maxlength="200" placeholder="Ej.: festivo, viaje"></div>`,
        onSubmit: async (fm) => {
          const kind = fm.elements.kind.value;
          const date = fm.elements.on_date.value;
          const from = fm.elements.start_time.value, to = fm.elements.end_time.value;
          if (!date) throw userError("Elige la fecha.");
          if (kind !== "block_day" && (!from || !to || to <= from)) throw userError("Indica un rango de horas válido.");
          await q((c) => c.from("sms_availability_exceptions").insert({
            on_date: date, kind: kind === "extra" ? "extra" : "block",
            start_time: kind === "block_day" ? null : from, end_time: kind === "block_day" ? null : to,
            slot_minutes: kind === "extra" ? 60 : null, session_type: kind === "extra" ? "diagnostic" : null,
            note: fm.elements.note.value.trim() || null
          }));
          toast("Fecha guardada.", "ok");
          loadAvailability();
        }
      });
    }
  });

  function refreshAll() { ctx.refreshCounts(); loadBookings(); loadAvailability(); }
  await Promise.all([loadBookings(), loadAvailability()]);
}
