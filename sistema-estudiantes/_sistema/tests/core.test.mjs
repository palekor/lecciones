// Pruebas unitarias de sistema/core.js (lógica pura del cliente).
// Ejecutar: node _sistema/tests/core.test.mjs
import assert from "node:assert/strict";
import * as C from "../../sistema/core.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("PASS:", name); };

t("normaliza teléfonos con indicativo", () => {
  assert.equal(C.normalizePhone("+57 (300) 111-2233"), "+573001112233");
  assert.equal(C.normalizePhone("0057 300 111 2233"), "+573001112233");
  assert.equal(C.normalizePhone("3001112233"), null);
  assert.equal(C.normalizePhone("+57"), null);
});

t("valida correos como el servidor", () => {
  assert.ok(C.isValidEmail("  Ana.Perez@Gmail.COM "));
  assert.ok(!C.isValidEmail("ana@@x.com"));
  assert.ok(!C.isValidEmail("ana..p@x.com"));
  assert.ok(!C.isValidEmail("ana@x"));
});

t("limpia disponibilidad", () => {
  const a = C.cleanAvailability({ days: ["wed", "mon", "xxx"], times: ["night", "evening"], notes: "  hola\u0007 ", tz: "America/Bogota" });
  assert.deepEqual(a, { days: ["mon", "wed"], times: ["evening"], tz: "America/Bogota", notes: "hola" });
  assert.equal(C.cleanAvailability({ tz: "<script>" }).tz, null);
});

t("validación de registro completa", () => {
  const ok = {
    full_name: "Ana María Pérez", email: "ana@correo.com", whatsapp: "+57 300 111 2233", country: "CO",
    english_level: "intermediate", objective: "professional", preferred_format: "individual", preferred_contact: "whatsapp",
    availability: { days: ["mon"], times: ["evening"] }, consent_privacy: true
  };
  assert.deepEqual(C.validateIntake(ok, "register"), {});
  const e = C.validateIntake({ ...ok, full_name: "Ana 2", whatsapp: "+57 ", objective: "other", consent_privacy: false }, "register");
  assert.equal(e.full_name, "format");
  assert.equal(e.whatsapp, "required");
  assert.equal(e.objective_other, "required");
  assert.equal(e.consent_privacy, "required");
});

t("lista de espera y reserva piden menos datos", () => {
  const base = { full_name: "Ana Pérez", email: "a@b.co", whatsapp: "+573001112233", country: "CO", consent_privacy: true };
  assert.deepEqual(C.validateIntake(base, "booking"), {});
  const w = C.validateIntake(base, "waitlist");
  assert.deepEqual(Object.keys(w).sort(), ["availability", "objective", "preferred_format"]);
});

t("preguntas adicionales obligatorias", () => {
  const cfg = { extra_questions: [{ id: "empresa", type: "text", required: true }, { id: "modo", type: "select", options: ["A", "B"] }] };
  const p = { full_name: "Ana Pérez", email: "a@b.co", whatsapp: "+573001112233", country: "CO", english_level: "beginner", objective: "travel", preferred_format: "not_sure", preferred_contact: "email", availability: { notes: "fines de semana" }, consent_privacy: true, extra: { modo: "C" } };
  const e = C.validateIntake(p, "register", cfg);
  assert.equal(e.extra_empresa, "required");
  assert.equal(e.extra_modo, "invalid");
});

t("CSV protegido contra inyección de fórmulas", () => {
  const csv = C.toCSV([{ a: "=HYPERLINK(\"x\")", b: "Pérez, Ana" }], [{ label: "A", key: "a" }, { label: "B", key: "b" }]);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes(`"Pérez, Ana"`));
});

t("conversión de hora local de una zona a UTC y de vuelta", () => {
  const iso = C.zonedLocalToISO("2026-11-02T09:30", "America/Bogota");
  assert.equal(iso, "2026-11-02T14:30:00.000Z");
  assert.equal(C.isoToZonedLocal(iso, "America/Bogota"), "2026-11-02T09:30");
  assert.equal(C.zonedLocalToISO("2026-07-01T10:00", "Europe/Madrid"), "2026-07-01T08:00:00.000Z");
});

t("agrupa horarios por día local", () => {
  const g = C.groupSlotsByDay([
    { start: "2026-11-02T14:00:00Z" }, { start: "2026-11-02T23:30:00Z" }, { start: "2026-11-03T05:30:00Z" }
  ], "America/Bogota");
  assert.deepEqual(g.map((x) => [x.day, x.items.length]), [["2026-11-02", 2], ["2026-11-03", 1]]);
});

t("lista de países en español", () => {
  const { priority, rest } = C.countryList("es");
  assert.equal(priority[0].code, "CO");
  assert.equal(C.countryName("ES"), "España");
  assert.ok(priority.length + rest.length > 240);
});

t("enlaces de WhatsApp y plantillas", () => {
  assert.equal(C.waLink("+57 300 111 2233", "Hola Ana"), "https://wa.me/573001112233?text=Hola%20Ana");
  assert.equal(C.fillTemplate("Hola {nombre}, {link}", { nombre: "Ana", link: "x" }), "Hola Ana, x");
});

console.log(`\n${n} pruebas unitarias OK`);
