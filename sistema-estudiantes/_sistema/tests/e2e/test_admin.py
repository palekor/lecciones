"""
Pruebas E2E del panel /admin (correr después de test_public.py sobre la misma base).
Uso: BASE=http://127.0.0.1:8787 ANON_KEY=... SHOTS=/ruta python3 test_admin.py
"""
import os, subprocess, sys, re
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:8787")
ANON = os.environ["ANON_KEY"]
SHOTS = os.environ.get("SHOTS", "/tmp")
PSQL = ["psql", "-h", "127.0.0.1", "-p", os.environ.get("PGPORT", "54329"), "-U", "postgres", "-d", "smstest", "-At", "-c"]
sql = lambda q: subprocess.check_output(PSQL + [q]).decode().strip()
INIT = "window.SMS_CONFIG = { supabaseUrl: '%s', supabaseKey: '%s', sdkUrl: '%s/sdk/supabase.js', sdkIntegrity: '%s' };" % (BASE, ANON, BASE, os.environ.get("SDK_SRI", ""))

results = []
def check(cond, name):
    results.append((bool(cond), name)); print(("PASS: " if cond else "FAIL: ") + name)

IGNORED = ("fonts", "net::ERR_FAILED", "WebSocket", "realtime")
def ctx_page(browser, mobile=False):
    ctx = browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1366, "height": 900},
                              locale="es-CO", timezone_id="America/Bogota", accept_downloads=True)
    ctx.add_init_script(INIT)
    ctx.route("**/fonts.g*/**", lambda r: r.abort())
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" and not any(x in m.text for x in IGNORED) else None)
    page.on("dialog", lambda d: d.dismiss())
    return ctx, page, errs

def login(page, email):
    page.goto(BASE + "/lecciones/admin/")
    page.wait_for_selector("#login:not([hidden])")
    page.fill("#login-email-input", email)
    page.click("#login-email button[type=submit]")
    page.wait_for_selector("#login-code:not([hidden])")
    page.fill("#login-code-input", "123456")
    page.click("#login-code button[type=submit]")

def close_dialogs(page):
    for b in page.locator("dialog[open] [data-close]").all()[:1]:
        b.click()

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ------------------------------------------------ acceso denegado
    ctx, page, errs = ctx_page(browser)
    login(page, "intruso@correo.com")
    page.wait_for_selector("#noaccess:not([hidden])")
    check("intruso@correo.com" in page.inner_text("#noaccess"), "cuenta sin invitación no entra al panel")
    page.goto(BASE + "/lecciones/admin/")
    page.wait_for_selector("#noaccess:not([hidden])")
    page.click("#noaccess-out")
    page.wait_for_selector("#login:not([hidden])")
    check(True, "cerrar sesión desde pantalla sin acceso")
    page.fill("#login-email-input", "x@y.co"); page.click("#login-email button[type=submit]")
    page.wait_for_selector("#login-code:not([hidden])")
    page.fill("#login-code-input", "000000"); page.click("#login-code button[type=submit]")
    page.wait_for_selector("#login-alert:not([hidden])")
    check("no es válido" in page.inner_text("#login-alert"), "código incorrecto rechazado")
    ctx.close()

    # Una persona más en la lista de espera (formulario dedicado), para probar el orden.
    sql("""select public.sms_join_waitlist('{"client_key":"bbbbbbbb-0000-4000-8000-000000000001","elapsed_ms":5000,
          "full_name":"Nora Vélez","email":"nora@correo.com","whatsapp":"+56911112222","country":"CL",
          "objective":"conversation","preferred_format":"individual","availability":{"notes":"tardes"},
          "consent_privacy":true,"notice_version":"2026-10-23"}'::jsonb)""")

    # ------------------------------------------------ dueño
    ctx, page, errs = ctx_page(browser)
    login(page, "profgermandario@gmail.com")
    page.wait_for_selector("#shell:not([hidden])")
    page.wait_for_selector(".kpis")
    check("Dueño" in page.inner_text("#me"), "dueño reconocido por invitación del instalador")
    kp = page.inner_text(".kpis")
    check(re.search(r"2\s*Solicitudes de reserva por confirmar", kp) is not None, "dashboard: 2 solicitudes por confirmar")
    check(re.search(r"\d+\s*Prospectos en total", kp) is not None and "Tareas vencidas" in kp and "Mensajes por enviar" in kp, "dashboard: indicadores nuevos")
    check("Recibido este mes" in page.inner_text("#view") and "Facturado y pendiente" in page.inner_text("#view"), "dashboard separa acordado, facturado y recibido")
    check(re.search(r"2\s*En lista de espera", kp) is not None, "dashboard: 2 en lista de espera")
    page.screenshot(path=f"{SHOTS}/admin-inicio.png", full_page=True)

    # Leads: búsqueda y filtros
    page.goto(BASE + "/lecciones/admin/#/leads")
    page.wait_for_selector("#rows .row.head")
    n_all = page.locator("#rows a.row").count()
    check(n_all >= 3, "leads abiertos listados (%d)" % n_all)
    page.fill("input[name=q]", "mateo")
    page.wait_for_timeout(900)
    check(page.locator("#rows a.row").count() == 1 and "Mateo" in page.inner_text("#rows"), "búsqueda por nombre")
    page.fill("input[name=q]", "")
    page.click("[data-status='booking_requested']")
    page.wait_for_timeout(700)
    check("Sofía" in page.inner_text("#rows") and "Mateo" not in page.inner_text("#rows") and page.locator("#rows a.row").count() == 2, "filtro por estado")
    check("Último contacto" in page.inner_text("#rows .row.head") and "Próxima sesión" in page.inner_text("#rows .row.head"), "directorio con columnas de contacto y sesión")
    check(page.locator("[data-status='attention']").count() == 1, "filtro de contactos que necesitan atención")
    with page.expect_download() as dl:
        page.click("#csv")
    path = dl.value.path()
    content = open(path, encoding="utf-8-sig").read()
    check("Sofía Herrera" in content and "Nombre,Correo" in content, "exportación CSV")
    check(sql("select count(*) from sms_activity where kind='export'") == "1", "exportación auditada")
    page.screenshot(path=f"{SHOTS}/admin-leads.png", full_page=True)

    # Alta manual de un contacto
    page.click("[data-status='open']")
    page.click("#add-contact")
    page.fill("#ac-name", "Pablo Ortega")
    page.fill("#ac-email", "pablo@correo.com")
    page.fill("#ac-wa", "+57 312 000 1111")
    page.select_option("#ac-urg", "asap")
    page.fill("#ac-note", "Me escribió por Instagram")
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector(".person-head")
    check("Pablo Ortega" in page.inner_text(".person-head"), "alta manual abre la ficha nueva")
    check(sql("select s.source||'|'||l.status||'|'||l.urgency from sms_students s join sms_leads l on l.student_id=s.id where s.email='pablo@correo.com'") == "panel|contacted|asap", "alta manual guardada como lead")

    # Lista de espera: orden transparente y prioridad manual
    page.goto(BASE + "/lecciones/admin/#/lista")
    page.wait_for_selector("#rows .row.head")
    rows = page.locator("#rows .row:not(.head)")
    check("Mateo" in rows.nth(0).inner_text() and "Nora" in rows.nth(1).inner_text(), "lista ordenada por fecha de registro")
    rows.nth(1).locator("[data-delta='1']").click()
    page.wait_for_timeout(900)
    check("Nora" in page.locator("#rows .row:not(.head)").nth(0).inner_text(), "prioridad manual sube a Nora al primer lugar")
    check("Política de orden" in page.inner_text("#view"), "política de orden visible")

    # Ficha de Laura
    laura = sql("select id from sms_students where email='laura.gomez@correo.com'")
    page.goto(BASE + f"/lecciones/admin/#/persona/{laura}")
    page.wait_for_selector(".person-head")
    page.screenshot(path=f"{SHOTS}/admin-ficha.png", full_page=True)
    page.click("[data-act=contact]")
    page.fill("#ct-note", "Le expliqué el plan Impulso")
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector("dialog[open]", state="detached")
    check(sql(f"select count(*) from sms_activity where student_id='{laura}' and kind='contact'") == "1", "contacto registrado desde la ficha")
    page.click("[data-tab=historial]")
    page.fill("#note", "Prefiere las noches")
    page.click("#note-form button[type=submit]")
    page.wait_for_timeout(900)
    check("Prefiere las noches" in page.inner_text("#tab-body"), "nota interna en el historial")

    # Tareas de la persona
    page.click("[data-tab=tareas]")
    page.click("[data-act=task]")
    page.fill("#tk-title", "Enviar material de entrevistas")
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector("dialog[open]", state="detached")
    page.wait_for_selector("#tab-body .task")
    check(sql(f"select count(*) from sms_tasks where student_id='{laura}' and status='open'") == "1", "tarea creada desde la ficha")
    page.locator("#tab-body [data-done]").first.check()
    page.wait_for_timeout(900)
    check(sql(f"select status from sms_tasks where student_id='{laura}'") == "done", "tarea marcada como hecha")

    # Evaluaciones por habilidad
    page.click("[data-tab=evaluaciones]")
    page.click("[data-act=assess]")
    page.select_option("#as-skill", "speaking")
    page.fill("#as-crit", "Rúbrica de fluidez 1-5")
    page.fill("#as-res", "3/5")
    page.fill("#as-score", "60")
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector("dialog[open]", state="detached")
    page.wait_for_selector(".skill-table")
    check("Expresión oral" in page.inner_text(".skill-table"), "evaluación por habilidad registrada")

    # Perfil educativo
    page.click("[data-tab=progreso]")
    page.select_option("#e-li", "a2")
    page.select_option("#e-lc", "b1")
    page.click("#edu-form label.chip:has-text('Expresión oral')")
    page.fill("#e-ng", "Entrevista en inglés en diciembre")
    page.click("#edu-form button[type=submit]")
    page.wait_for_timeout(900)
    check(sql(f"select level_initial||'|'||level_current||'|'||array_to_string(skills_focus,',') from sms_students where id='{laura}'") == "a2|b1|speaking", "perfil educativo guardado")

    # Convertir en estudiante
    page.click("[data-tab=resumen]")
    page.click("[data-act=convert]")
    page.select_option("#cv-plan", sql("select id from sms_plans where name='Impulso'"))
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector("dialog[open]", state="detached")
    page.wait_for_timeout(900)
    check(sql(f"select status from sms_students where id='{laura}'") == "active", "lead convertido en estudiante activo")
    check(sql("select count(*) from sms_students where email='laura.gomez@correo.com'") == "1", "conversión sin duplicar la ficha")

    # Progreso
    page.click("[data-tab=progreso]")
    page.locator("[data-step='1'] select").select_option("completed")
    page.wait_for_timeout(900)
    page.locator("[data-step='2'] select").select_option("in_progress")
    page.wait_for_timeout(900)
    check(sql(f"select count(*) from sms_progress where student_id='{laura}' and status='completed'") == "1", "progreso guardado")
    check(sql(f"select current_step from sms_students where id='{laura}'") == "2", "paso actual avanza")

    # Pagos
    page.click("[data-tab=pagos]")
    page.click("[data-act=pay]")
    page.select_option("#pay-plan", sql("select id from sms_plans where name='Impulso'"))
    page.fill("#pay-concept", "Impulso — noviembre")
    page.fill("#pay-amount", "140")
    page.fill("#pay-pe", "2026-11-30")
    page.fill("#pay-ref", "4111 1111 1111 1111")
    page.click("dialog[open] [data-submit]")
    check("tarjeta" in page.inner_text("dialog[open] [data-alert]"), "bloquea números de tarjeta en la referencia")
    page.fill("#pay-ref", "TRX-889")
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector("dialog[open]", state="detached")
    page.wait_for_timeout(700)
    check(sql(f"select amount||'|'||status from sms_payments where student_id='{laura}'") == "140.00|paid", "pago registrado")
    check(sql(f"select plan_renews_at from sms_students where id='{laura}'") == "2026-11-30", "renovación tomada del período pagado")

    # Agenda: confirmar la solicitud de Sofía
    page.goto(BASE + "/lecciones/admin/#/agenda?f=requested")
    page.wait_for_selector("#bookings .booking")
    page.click("#bookings [data-bk=confirm]")
    page.wait_for_timeout(1000)
    check(sql("select b.status from sms_bookings b join sms_students s on s.id=b.student_id where s.email='sofia@correo.com'") == "confirmed", "sesión confirmada desde la agenda")
    check(sql("select l.status from sms_leads l join sms_students s on s.id=l.student_id where s.email='sofia@correo.com'") == "booking_confirmed", "lead pasa a Reserva confirmada")
    page.click("[data-mode=week]")
    page.wait_for_selector(".week")
    check(page.locator(".week-day").count() == 7, "vista de calendario semanal")
    found = page.locator(".cal-item").count()
    for _ in range(3):
        if found: break
        page.click("[data-week='7']"); page.wait_for_timeout(700); found = page.locator(".cal-item").count()
    check(found > 0, "las sesiones aparecen en el calendario")
    page.click("[data-mode=list]")
    page.wait_for_timeout(600)
    n_rules = int(sql("select count(*) from sms_availability_rules"))
    page.click("#add-rule")
    page.select_option("#r-buf", "15")
    page.select_option("#r-day", "6")
    page.fill("#r-from", "09:00"); page.fill("#r-to", "11:00")
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector("dialog[open]", state="detached")
    page.wait_for_timeout(700)
    check(int(sql("select count(*) from sms_availability_rules")) == n_rules + 1, "franja de disponibilidad agregada")
    check(sql("select buffer_minutes from sms_availability_rules order by created_at desc limit 1") == "15", "pausa entre sesiones configurada")
    page.click("#new-booking")
    page.fill("#pick-q", "mateo")
    page.wait_for_selector("#pick-list button")
    page.click("#pick-list button")
    page.locator("#bk-free [data-start]").first.click()
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector("dialog[open]", state="detached")
    page.wait_for_timeout(700)
    check(sql("select count(*) from sms_bookings b join sms_students s on s.id=b.student_id where s.email='mateo@correo.com' and b.status='confirmed'") == "1", "sesión agendada manualmente")
    page.screenshot(path=f"{SHOTS}/admin-agenda.png", full_page=True)

    # Mensajes: el aviso de confirmación quedó en la cola
    page.goto(BASE + "/lecciones/admin/#/mensajes")
    page.wait_for_selector("#msgs .msg")
    check("Sofía" in page.inner_text("#msgs") and "Confirmación de sesión" in page.inner_text("#msgs"), "aviso de confirmación listo para enviar")
    msg = page.locator("#msgs .msg", has_text="Sofía").first
    msg.locator("[data-sent]").click()
    page.wait_for_timeout(900)
    check(sql("select count(*) from sms_outbox o join sms_students s on s.id=o.student_id where s.email='sofia@correo.com' and o.status='sent'") == "1", "mensaje marcado como enviado")

    # Tareas: vista general
    page.goto(BASE + "/lecciones/admin/#/tareas?f=done")
    page.wait_for_selector("#task-list .task")
    check("Enviar material de entrevistas" in page.inner_text("#task-list"), "vista general de tareas")

    # Ajustes: pregunta adicional e invitación al equipo
    page.goto(BASE + "/lecciones/admin/#/ajustes")
    page.wait_for_selector("#team .rows")
    page.click("#add-q")
    page.locator("#questions [data-k=label]").last.fill("¿En qué empresa trabajas?")
    page.click("#form-settings button[type=submit]")
    page.wait_for_timeout(900)
    check(sql("select data->'extra_questions'->0->>'id' from sms_settings") == "en_que_empresa_trabajas", "pregunta adicional guardada")
    page.click("#invite")
    page.fill("#i-mail", "asistente@correo.com")
    page.fill("#i-name", "Asistente")
    page.click("dialog[open] [data-submit]")
    page.wait_for_selector("dialog[open]", state="detached")
    page.wait_for_timeout(500)
    check(sql("select role from sms_staff_invites where email='asistente@correo.com'") == "staff", "invitación al equipo")
    check("Sesión de diagnóstico" in page.inner_text("#types"), "tipos de sesión configurables")
    page.fill("#lb-l-waitlist", "En fila")
    page.click("[data-section=labels] button[type=submit]")
    page.wait_for_timeout(900)
    check(sql("select data->'status_labels'->'lead'->>'waitlist' from sms_settings") == "En fila", "nombres de estados configurables")
    with page.expect_download() as dl2:
        page.click("#backup")
    backup = open(dl2.value.path(), encoding="utf-8").read()
    check('"profgermandario-sms-backup"' in backup and "ip_salt" not in backup, "respaldo completo descargable sin secretos")
    check(not errs, "sin errores de JavaScript (dueño): %s" % errs[:3])
    ctx.close()

    # El registro público ahora muestra la pregunta adicional
    ctx, page, e2 = ctx_page(browser, mobile=True)
    page.goto(BASE + "/lecciones/registro/")
    page.wait_for_selector("#form:not([hidden])")
    check("¿En qué empresa trabajas?" in page.inner_text("#extra-questions"), "pregunta configurable aparece en /registro")
    ctx.close()

    # ------------------------------------------------ asistente (rol staff) en móvil
    ctx, page, errs = ctx_page(browser, mobile=True)
    login(page, "asistente@correo.com")
    page.wait_for_selector("#shell:not([hidden])")
    page.wait_for_selector(".kpis")
    check(page.locator("#tabbar a").count() == 5, "navegación inferior en móvil")
    check("Cobrado este mes" not in page.inner_text(".kpis"), "staff no ve ingresos")
    page.goto(BASE + "/lecciones/admin/#/pagos")
    page.wait_for_timeout(800)
    check("solo para administradores" in page.inner_text("#view"), "staff no entra a pagos")
    page.goto(BASE + f"/lecciones/admin/#/persona/{laura}")
    page.wait_for_selector(".person-head")
    check(page.locator("[data-tab=pagos]").count() == 0, "staff no ve pestaña de pagos")
    page.screenshot(path=f"{SHOTS}/admin-ficha-movil.png", full_page=True)
    page.goto(BASE + "/lecciones/admin/#/inicio")
    page.wait_for_selector(".kpis")
    page.screenshot(path=f"{SHOTS}/admin-inicio-movil.png", full_page=True)
    check(not errs, "sin errores de JavaScript (staff): %s" % errs[:3])
    ctx.close()
    browser.close()

failed = [n for ok, n in results if not ok]
print("\n%d/%d pruebas E2E del panel OK" % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
