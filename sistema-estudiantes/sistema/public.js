/* =====================================================================
   Piezas compartidas por las páginas públicas (/registro, /lista-de-espera,
   /reservar): configuración, país/teléfono, privacidad, envío seguro.
   ===================================================================== */
import { rpc, ApiError } from "./api.js";
import { CONFIG } from "./config.js";
import { countryList, DIAL_CODES, browserTimeZone, timeZones, uuid, cleanAvailability, normalizeName } from "./core.js";
import { $, $$, esc, html, mount, raw } from "./ui.js";
import { errorText } from "./i18n.js";

let cfgP = null;
export function loadPublicConfig() {
  if (!cfgP) cfgP = rpc("sms_public_config").catch((e) => { cfgP = null; throw e; });
  return cfgP;
}

export function fillCountrySelect(select, preselect) {
  const { priority, rest } = countryList("es");
  const opt = (c) => `<option value="${c.code}">${esc(c.name)}</option>`;
  select.innerHTML = `<option value="">Selecciona tu país</option>
    <optgroup label="Más frecuentes">${priority.map(opt).join("")}</optgroup>
    <optgroup label="Todos los países">${rest.map(opt).join("")}</optgroup>`;
  if (preselect) select.value = preselect;
}

/** Zona horaria: se propone la del navegador; la persona puede cambiarla. */
export function fillTimeZoneSelect(select) {
  const mine = browserTimeZone();
  const list = timeZones();
  if (!list.includes(mine)) list.unshift(mine);
  select.innerHTML = list.map((z) => `<option value="${esc(z)}">${esc(z.replace(/_/g, " "))}</option>`).join("");
  select.value = mine;
}

/** Al elegir país, propone el indicativo en el campo de WhatsApp si está vacío. */
export function linkPhonePrefix(countrySel, phoneInput) {
  const apply = () => {
    const dial = DIAL_CODES[countrySel.value];
    const digits = phoneInput.value.replace(/\D/g, "");
    if (dial && digits.length <= 4) phoneInput.value = "+" + dial + " ";
  };
  countrySel.addEventListener("change", apply);
  return apply;
}

/** Sugerencia de país por zona horaria del navegador (sin geolocalización). */
export function guessCountry() {
  const tz = browserTimeZone();
  const map = {
    "America/Bogota": "CO", "America/Mexico_City": "MX", "America/Monterrey": "MX", "America/Tijuana": "MX",
    "America/Argentina/Buenos_Aires": "AR", "America/Buenos_Aires": "AR", "America/Santiago": "CL", "America/Lima": "PE",
    "America/Guayaquil": "EC", "America/Caracas": "VE", "America/La_Paz": "BO", "America/Asuncion": "PY",
    "America/Montevideo": "UY", "America/Costa_Rica": "CR", "America/Panama": "PA", "America/Guatemala": "GT",
    "America/Tegucigalpa": "HN", "America/El_Salvador": "SV", "America/Managua": "NI", "America/Santo_Domingo": "DO",
    "America/Puerto_Rico": "PR", "America/Havana": "CU", "Europe/Madrid": "ES", "Atlantic/Canary": "ES"
  };
  return map[tz] || "";
}

export function sourceParam() {
  try {
    const q = new URLSearchParams(location.search);
    const s = (q.get("src") || q.get("utm_source") || "").toLowerCase();
    return /^[a-z0-9_.-]{1,60}$/.test(s) ? s : undefined;
  } catch (e) { return undefined; }
}

export function availabilityFrom(form) {
  return cleanAvailability({
    days: $$('input[name="av_day"]:checked', form).map((i) => i.value),
    times: $$('input[name="av_time"]:checked', form).map((i) => i.value),
    notes: form.elements.av_notes ? form.elements.av_notes.value : "",
    tz: form.elements.timezone && form.elements.timezone.value ? form.elements.timezone.value : browserTimeZone()
  });
}

/** Aviso de privacidad resumido + casillas de consentimiento (marketing nunca premarcado). */
export function renderConsent(container, cfg, purpose) {
  const url = cfg.privacy_policy_url || "../privacidad/";
  mount(container, html`
    <div class="privacy-box">
      <p><b>Para qué usamos tus datos:</b> ${purpose}</p>
      <p>Responsable: ${cfg.controller_name || CONFIG.brand}. No vendemos ni compartimos tus datos con terceros para su publicidad.
         Puedes conocer, actualizar, corregir o pedir que eliminemos tus datos en cualquier momento escribiendo a
         ${cfg.contact_email || ""}.</p>
      <p><a href="${url}" target="_blank" rel="noopener">Leer la política de tratamiento de datos completa</a> (versión ${cfg.privacy_notice_version || ""}).</p>
    </div>
    <div data-field="consent_privacy">
      <div class="check">
        <input type="checkbox" id="consent_privacy" name="consent_privacy" required>
        <label for="consent_privacy">Autorizo el tratamiento de mis datos personales para gestionar mi solicitud, según la política de tratamiento de datos.</label>
      </div>
    </div>
    <div class="check">
      <input type="checkbox" id="consent_marketing" name="consent_marketing">
      <label for="consent_marketing">Quiero recibir novedades, contenidos y ofertas de ${CONFIG.brand} por WhatsApp o correo. <span class="opt">(Opcional — puedes darte de baja cuando quieras.)</span></label>
    </div>`);
}

export function contactPayload(form, cfg) {
  return {
    full_name: normalizeName(form.elements.full_name.value),
    email: form.elements.email.value.trim(),
    whatsapp: form.elements.whatsapp.value.trim(),
    country: form.elements.country.value,
    consent_privacy: form.elements.consent_privacy.checked,
    consent_marketing: form.elements.consent_marketing ? form.elements.consent_marketing.checked : false,
    notice_version: cfg.privacy_notice_version,
    timezone: form.elements.timezone && form.elements.timezone.value ? form.elements.timezone.value : browserTimeZone(),
    // Campo trampa para bots. Su nombre no coincide con nada que el autocompletado
    // del celular conozca (antes se llamaba "website" y el autocompletado lo llenaba).
    website: form.elements.hp_check ? form.elements.hp_check.value : ""
  };
}

/**
 * Envío con idempotencia: la misma client_key se reutiliza solo para
 * reintentos de red; tras una respuesta del servidor se genera otra.
 */
export function makeSubmitter(fnName) {
  let key = uuid();
  const startedAt = Date.now();
  return async function submit(payload) {
    const body = { ...payload, client_key: key, elapsed_ms: Date.now() - startedAt };
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await rpc(fnName, { p: body });
        if (!res || !res.ok) key = uuid();
        return res;
      } catch (e) {
        lastErr = e;
        if (!(e instanceof ApiError) || e.code !== "network") break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    key = uuid();
    throw lastErr;
  };
}

export function fatal(container, err) {
  const msg = err && err.code === "network" ? errorText("network", "network") : errorText("generic", "generic");
  mount(container, html`
    <div class="form-card">
      <h2 style="margin-top:0">No pudimos cargar el formulario</h2>
      <p class="lede">${msg}</p>
      <div class="btn-row">
        <button class="btn btn-dark" type="button" onclick="location.reload()">Volver a intentar</button>
        <a class="btn btn-soft" href="https://wa.me/${CONFIG.whatsapp.replace(/\D/g, "")}" target="_blank" rel="noopener">Escribir por WhatsApp</a>
      </div>
    </div>`);
}

export function journeyState(at) {
  $$(".journey").forEach((ol) => {
    ol.dataset.at = String(at);
    $$("li", ol).forEach((li, i) => {
      li.classList.toggle("done", i + 1 < at);
      li.classList.toggle("now", i + 1 === at);
    });
  });
  $$(".mini-journey").forEach((mj) => {
    $$("i", mj).forEach((dot, i) => {
      dot.className = i + 1 < at ? "done" : i + 1 === at ? "now" : "";
    });
  });
}

export { raw };
