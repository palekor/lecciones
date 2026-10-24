"""
Pruebas E2E de las páginas públicas (/registro, /lista-de-espera, /reservar)
contra la pila local (Postgres + PostgREST + server.mjs).
Uso: BASE=http://127.0.0.1:8787 ANON_KEY=... SHOTS=/ruta python3 test_public.py
"""
import os, subprocess, json, time, uuid, sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://127.0.0.1:8787")
PAGES = BASE + "/lecciones/sistema-estudiantes"
ANON = os.environ["ANON_KEY"]
SHOTS = os.environ.get("SHOTS", "/tmp")
PSQL = ["psql", "-h", "127.0.0.1", "-p", os.environ.get("PGPORT", "54329"), "-U", "postgres", "-d", "smstest", "-At", "-c"]

def sql(q):
    return subprocess.check_output(PSQL + [q]).decode().strip()

INIT = """window.SMS_CONFIG = { supabaseUrl: '%s', supabaseKey: '%s', sdkUrl: '%s/sdk/supabase.js', sdkIntegrity: '%s' };""" % (BASE, ANON, BASE, os.environ.get("SDK_SRI", ""))

results = []
def check(cond, name):
    results.append((bool(cond), name))
    print(("PASS: " if cond else "FAIL: ") + name)

def new_page(browser, ip, mobile=True):
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844} if mobile else {"width": 1366, "height": 900},
        extra_http_headers={"x-test-ip": ip}, locale="es-CO", timezone_id="America/Bogota")
    ctx.add_init_script(INIT)
    ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    return ctx, page, errors

def fill_registration(page, email, name="Laura Gómez"):
    page.fill("#full_name", name)
    page.fill("#email", email)
    page.select_option("#country", "CO")
    page.fill("#whatsapp", "+57 310 555 0101")
    page.click("label.chip:has-text('WhatsApp')")
    page.click("label.chip:has-text('Intermedio')")
    page.click("label.chip:has-text('Inglés profesional')")
    page.click("label.chip:has-text('Sesiones individuales')")
    page.click("label.chip:has-text('Lo antes posible')")
    page.fill("#occupation", "Analista financiera")
    page.click("label.chip:has-text('Mar')")
    page.click("label.chip:has-text('Jue')")
    page.click("label.chip:has-text('Noche')")
    page.check("#consent_privacy")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------------------------------------------------------- registro
    ctx, page, errs = new_page(browser, "10.0.0.1")
    page.goto(PAGES + "/registro/")
    page.wait_for_selector("#form:not([hidden])")
    check(page.locator("#country option").count() > 200, "lista de países cargada")
    check(page.locator("#consent_marketing").is_checked() is False, "marketing NO premarcado")
    page.screenshot(path=f"{SHOTS}/registro-movil.png", full_page=True)

    page.click("#submit")
    check(page.locator(".field-error").count() >= 6, "errores en español al enviar vacío")
    check("obligatorio" in page.locator(".field-error").first.inner_text(), "mensaje de validación en español")

    page.wait_for_timeout(2600)  # tiempo humano mínimo
    fill_registration(page, "laura.gomez@correo.com")
    page.fill("#email", "laura@@correo")
    page.click("#submit")
    check("nombre@dominio.com" in page.locator('[data-field="email"] .field-error').inner_text(), "correo inválido detectado en cliente")
    page.fill("#email", "Laura.Gomez@Correo.com")
    page.screenshot(path=f"{SHOTS}/registro-lleno.png", full_page=True)
    # doble clic: no debe duplicar
    page.locator("#submit").dblclick()
    page.wait_for_selector("#done:not([hidden])", timeout=10000)
    check("Listo, Laura" in page.locator("#done-title").inner_text(), "confirmación con siguiente paso")
    check(sql("select count(*) from sms_students where email='laura.gomez@correo.com'") == "1", "doble clic no duplica el registro")
    check(sql("select whatsapp||'|'||country||'|'||status from sms_students where email='laura.gomez@correo.com'") == "+573105550101|CO|prospect", "datos normalizados en la base")
    check(sql("select occupation||'|'||urgency||'|'||timezone from sms_students where email='laura.gomez@correo.com'") == "Analista financiera|asap|America/Bogota", "ocupación, urgencia y zona horaria guardadas")
    check(sql("select count(*) from sms_submissions") == "1", "una sola recepción registrada")
    page.screenshot(path=f"{SHOTS}/registro-confirmacion.png", full_page=True)

    page.click("#wl-btn")
    page.wait_for_selector("#wl-card:has-text('Estás en la lista')")
    check("1" in page.locator("#wl-card b").inner_text(), "unirse a la lista desde la confirmación (posición 1)")
    check(sql("select l.status from sms_leads l join sms_students s on s.id=l.student_id where s.email='laura.gomez@correo.com'") == "waitlist", "lead en lista de espera")
    check(not [e for e in errs if "fonts" not in e and "net::ERR_FAILED" not in e], "sin errores de JavaScript en /registro: %s" % errs[:3])
    ctx.close()

    # ---------------------------------------------------------- lista de espera (formulario dedicado)
    ctx, page, errs = new_page(browser, "10.0.0.2", mobile=False)
    page.goto(PAGES + "/lista-de-espera/")
    page.wait_for_selector("#full:not([hidden])")
    page.wait_for_timeout(2600)
    page.fill("#full_name", "Mateo Ríos")
    page.fill("#email", "mateo@correo.com")
    page.select_option("#country", "MX")
    check(page.input_value("#whatsapp").startswith("+52"), "indicativo propuesto al elegir país")
    page.fill("#whatsapp", "+52 55 1234 5678")
    page.click("label.chip:has-text('Viajes')")
    page.click("label.chip:has-text('Autoestudio guiado')")
    page.fill("#av_notes", "Fines de semana en la mañana")
    page.check("#consent_privacy")
    page.screenshot(path=f"{SHOTS}/lista-escritorio.png", full_page=True)
    page.click("#submit")
    page.wait_for_selector("#done:not([hidden])")
    check(page.locator(".big-number").inner_text().strip() == "2", "formulario dedicado: posición 2 en la lista")
    check(sql("select english_level is null from sms_students where email='mateo@correo.com'") == "t", "lista no exige datos innecesarios")
    page.screenshot(path=f"{SHOTS}/lista-confirmacion.png", full_page=True)
    check(not [e for e in errs if "fonts" not in e and "net::ERR_FAILED" not in e], "sin errores de JavaScript en /lista-de-espera: %s" % errs[:3])
    ctx.close()

    # ---------------------------------------------------------- reservar
    sql("update sms_availability_rules set active = true")
    sql("insert into sms_availability_rules (weekday, start_time, end_time, slot_minutes, session_type, active) "
        "select d, '14:00', '17:00', 60, 'diagnostic', true from generate_series(1,7) d")
    ctx, page, errs = new_page(browser, "10.0.0.3")
    page.goto(PAGES + "/reservar/")
    page.wait_for_selector("#form:not([hidden])")
    n_days = page.locator(".day-btn").count()
    check(n_days >= 10, "días con horarios disponibles (%d)" % n_days)
    page.locator(".day-btn").nth(1).click()
    first_time = page.locator(".time-btn").first
    chosen_text = first_time.inner_text()
    first_time.click()
    check(page.locator("#picked").is_visible() and page.locator("#submit").is_enabled(), "horario elegido y botón activo")
    check("Cancelaciones y cambios" in page.inner_text("#policy"), "política de cancelación visible al reservar")
    page.wait_for_timeout(2600)
    page.fill("#full_name", "Sofía Herrera")
    page.fill("#email", "sofia@correo.com")
    page.select_option("#country", "CO")
    page.fill("#whatsapp", "3015550202")
    page.check("#consent_privacy")
    page.click("#submit")
    check("indicativo" in page.locator('[data-field="whatsapp"] .field-error').inner_text(), "WhatsApp sin indicativo rechazado")
    page.fill("#whatsapp", "+57 301 555 0202")
    page.fill("#message", "Tengo entrevista en inglés en dos semanas")
    page.screenshot(path=f"{SHOTS}/reservar-movil.png", full_page=True)
    page.click("#submit")
    page.wait_for_selector("#done:not([hidden])")
    check("Solicitud enviada" in page.locator("#done-title").inner_text(), "solicitud de reserva enviada")
    check(sql("select count(*) from sms_bookings b join sms_students s on s.id=b.student_id where s.email='sofia@correo.com' and b.status='requested' and b.origin='public'") == "1", "reserva guardada como 'por confirmar'")
    check(sql("select l.status from sms_leads l join sms_students s on s.id=l.student_id where s.email='sofia@correo.com'") == "booking_requested", "lead en 'reserva solicitada'")
    page.screenshot(path=f"{SHOTS}/reservar-confirmacion.png", full_page=True)
    check(not [e for e in errs if "fonts" not in e and "net::ERR_FAILED" not in e], "sin errores de JavaScript en /reservar: %s" % errs[:3])
    ctx.close()

    # El horario ya no se ofrece a otra persona
    ctx, page, errs = new_page(browser, "10.0.0.4")
    page.goto(PAGES + "/reservar/")
    page.wait_for_selector("#form:not([hidden])")
    page.locator(".day-btn").nth(1).click()
    times = page.locator(".time-btn").all_inner_texts()
    check(chosen_text not in times, "el horario reservado desaparece para otros visitantes")
    ctx.close()

    # Reserva con ref (después de registrarse): sin volver a escribir datos
    ctx, page, errs = new_page(browser, "10.0.0.5")
    ref = sql("select token from sms_submissions where kind='register' limit 1")
    page.goto(PAGES + "/reservar/#ref=" + ref)
    page.wait_for_selector("#form:not([hidden])")
    check(page.locator("#contact-set").is_hidden() and page.locator("#as-ref").is_visible(), "con ref no pide datos de nuevo")
    check("#ref=" not in page.url, "el ref se retira de la URL")
    page.locator(".day-btn").nth(2).click()
    page.locator(".time-btn").first.click()
    page.click("#submit")
    page.wait_for_selector("#done:not([hidden])")
    check(sql("select count(*) from sms_bookings b join sms_students s on s.id=b.student_id where s.email='laura.gomez@correo.com'") == "1", "reserva con ref asociada a la persona correcta")
    ctx.close()

    # Privacidad
    ctx, page, errs = new_page(browser, "10.0.0.6")
    page.goto(PAGES + "/privacidad/")
    check("1581 de 2012" in page.content(), "política de privacidad publicada")
    ctx.close()
    browser.close()

failed = [n for ok, n in results if not ok]
print("\n%d/%d pruebas E2E públicas OK" % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
