"""
Pruebas E2E v1.2: códigos de acceso desde el panel + journal en línea.
Recorre el flujo real: el profesor crea el código en la ficha, el estudiante lo
activa en journal.html (otro "teléfono"), autoriza compartir, el journal envía
avance/textos/reportes, el profesor corrige y la corrección vuelve al journal;
revocar y reactivar llegan al dispositivo; las lecciones (steps/) se abren.
Uso: BASE=http://127.0.0.1:8787 ANON_KEY=... SHOTS=/ruta python3 test_journal.py
"""
import os, subprocess, sys, json, re
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:8787")
SITE = BASE + "/lecciones"
PAGES = SITE + "/sistema-estudiantes"
ANON = os.environ["ANON_KEY"]
SHOTS = os.environ.get("SHOTS", "/tmp")
PSQL = ["psql", "-h", "127.0.0.1", "-p", os.environ.get("PGPORT", "54329"), "-U", "postgres", "-d", "smstest", "-At", "-c"]
sql = lambda q: subprocess.check_output(PSQL + [q]).decode().strip()
PANEL_INIT = "window.SMS_CONFIG = { supabaseUrl: '%s', supabaseKey: '%s', sdkUrl: '%s/sdk/supabase.js', sdkIntegrity: '%s' };" % (BASE, ANON, BASE, os.environ.get("SDK_SRI", ""))
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
TODAY = subprocess.check_output(["date", "+%Y-%m-%d"]).decode().strip()
SEED = {
    "version": 4, "onboarded": True, "name": "Valentina", "createdAt": NOW, "lastActiveDate": TODAY, "streak": 3,
    "startingPoint": {"level": "B1", "goal": "Job interviews", "fear": "I freeze when I have to speak", "learningStyle": "Speaking & doing", "baseline": ""},
    "completedMissions": [0, 1],
    "writingSamples": [{"id": "w-e2e-1", "createdAt": NOW, "week": 1, "missionId": 1, "kind": "mission", "prompt": "Tell me about yourself.",
                        "mode": "guided", "content": "I am Valentina. I work in marketing and I want to speak in meetings.", "wordCount": 13,
                        "topic": "Myself", "label": "Myself"}],
    "reflections": [{"id": "rf-e2e-1", "date": NOW, "kind": "mission", "missionId": 1, "topic": "Myself",
                     "managed": "I explained my job.", "difficult": "Past tense.", "better": "Use more connectors."}],
    "days": {TODAY: {"note": "Great class today."}}
}
JOURNAL_INIT = """
window.PG_ACCESS_API = { url: '%s', key: '%s' };
try { if (!localStorage.getItem('qkesl_state_v1')) localStorage.setItem('qkesl_state_v1', %s); } catch (e) {}
""" % (BASE, ANON, json.dumps(json.dumps(SEED)))

results = []
def check(cond, name):
    results.append((bool(cond), name)); print(("PASS: " if cond else "FAIL: ") + name)

IGNORED = ("fonts", "net::ERR_FAILED", "WebSocket", "realtime", "speechSynthesis")
def new_page(browser, init, mobile=False):
    ctx = browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1366, "height": 900},
                              locale="es-CO", timezone_id="America/Bogota")
    ctx.add_init_script(init)
    ctx.route("**/fonts.g*/**", lambda r: r.abort())
    ctx.route("https://palekor.github.io/**", lambda r: r.abort())  # logo absoluto del journal: externo en este entorno
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" and not any(x in m.text for x in IGNORED) else None)
    return ctx, page, errs

def login(page, email):
    page.goto(PAGES + "/admin/")
    page.wait_for_selector("#login:not([hidden])")
    page.fill("#login-email-input", email)
    page.click("#login-email button[type=submit]")
    page.wait_for_selector("#login-code:not([hidden])")
    page.fill("#login-code-input", "123456")
    page.click("#login-code button[type=submit]")
    page.wait_for_selector("#shell:not([hidden])")

def wait_sql(q, expect, tries=40):
    for _ in range(tries):
        v = sql(q)
        if v == expect: return True
        subprocess.run(["sleep", "0.25"])
    print("   (último valor: %r)" % v)
    return False

sql("delete from public.sms_rate_events where bucket like 'redeem:%' or bucket like 'dev:%'")
# Repetible: empieza siempre con una ficha limpia
sql("delete from public.sms_access_codes where student_id in (select id from public.sms_students where email = 'valentina.journal@correo.com')")
sql("delete from public.sms_students where email = 'valentina.journal@correo.com'")
stu = sql("""insert into public.sms_students (full_name, email, whatsapp, status, plan_renews_at)
             values ('Valentina Ríos', 'valentina.journal@correo.com', '+573005556677', 'active', current_date + 60)
             on conflict (email) do update set full_name = excluded.full_name returning id""").split("\n")[0]

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ------------------------------------------------ 1. El profesor crea el código
    pctx, panel, perrs = new_page(browser, PANEL_INIT)
    login(panel, "profgermandario@gmail.com")
    panel.goto(PAGES + f"/admin/#/persona/{stu}?tab=journal")
    panel.wait_for_selector("text=Acceso al journal")
    check("Sin código de acceso" in panel.inner_text("#view"), "ficha sin código muestra cómo empezar")
    panel.click("[data-act=new-code]")
    panel.wait_for_selector("dialog[open] #ac-tier")
    check(panel.input_value("dialog[open] #ac-until") == sql("select (current_date + 60)::text"), "vigencia propuesta = renovación del plan")
    panel.select_option("dialog[open] #ac-tier", "companion")
    panel.click("dialog[open] [data-q]:nth-child(2)")  # +3 meses
    panel.fill("dialog[open] #ac-note", "Pagó 3 meses")
    panel.click("dialog[open] footer button[type=submit]")
    panel.wait_for_selector(".code-card .mono")
    code = panel.inner_text(".code-card .mono").strip()
    check(re.match(r"^PG-[A-Z2-9]{4}-[A-Z2-9]{4}$", code), "código creado y visible en la ficha: " + code)
    card = panel.inner_text(".code-card")
    check("Companion" in card and "Vigente" in card and "aún sin activar" in card, "tarjeta con programa, vigencia y sin activar")
    wa = panel.get_attribute(".code-card a[href^='https://wa.me/']", "href") or ""
    check("573005556677" in wa and code in wa.replace("%2D", "-") and "journal.html" in wa, "botón de WhatsApp con el código y el enlace al journal")
    check("Acceso: vigente" in panel.inner_text(".person-head"), "encabezado de la ficha muestra el acceso")

    # ------------------------------------------------ 2. El estudiante lo activa en su teléfono
    jctx, jr, jerrs = new_page(browser, JOURNAL_INIT, mobile=True)
    jr.goto(SITE + "/journal.html#code=" + code)
    jr.wait_for_selector("#scrim.open [data-act=shareYes]", timeout=15000)
    sheet = jr.inner_text("#sheet")
    check("Welcome to Companion" in sheet, "el journal activa el código del panel (programa Companion)")
    check("Share your journal with ProfGermandario?" in sheet and "Política de tratamiento de datos" in sheet,
          "pide autorización expresa con enlace a la política")
    rec = json.loads(jr.evaluate("localStorage.getItem('pg_access_v1')"))
    check(rec.get("src") == "srv" and len(rec.get("token", "")) == 64 and "h" not in rec, "el dispositivo guarda su llave, no el código")
    check(sql(f"select count(*) from public.sms_journal_texts where student_id = '{stu}'") == "0", "nada se envía antes de autorizar")
    jr.screenshot(path=f"{SHOTS}/v12-journal-autorizacion.png")
    jr.click("[data-act=shareYes]")
    check(wait_sql(f"select sharing from public.sms_journal where student_id = '{stu}'", "t"), "autorización registrada en el servidor")
    check(wait_sql(f"select count(*) from public.sms_journal_texts where student_id = '{stu}'", "2"), "el journal envía escritos y reflexiones")
    check(wait_sql(f"select count(*) from public.sms_journal_reports where student_id = '{stu}' and content like '%Great class today.%'", "1"),
          "el reporte del día llega al servidor")
    check(sql(f"select (stats->>'missions')::int || '|' || streak || '|' || app_version || '|' || (profile->>'level') from public.sms_journal where student_id = '{stu}'")
          in ("2|3|11.2|B1", "2|3|11.3|B1"), "avance, racha, versión y perfil guardados")
    check(sql(f"select count(*) from public.sms_consents where student_id = '{stu}' and kind = 'journal_sharing' and granted") == "1",
          "consentimiento con fecha y versión del aviso")

    # Lecciones: el mismo dispositivo abre el contenido para miembros
    jr.goto(SITE + "/steps/step00a.html")
    jr.wait_for_load_state("load")
    jr.wait_for_timeout(600)
    check(jr.evaluate("document.documentElement.classList.contains('pg-member')") and jr.locator("#pga-lock").count() == 0,
          "las masterclasses (steps/) se abren con el código del panel")

    # ------------------------------------------------ 3. El profesor ve el journal y corrige
    panel.reload()
    panel.wait_for_selector("text=Acceso al journal")
    view = panel.inner_text("#view")
    check("En línea ahora" in view and "Racha: 3 días" in view, "ficha: en línea ahora y racha")
    check("2/17" in view and "1 dispositivo" in view, "ficha: misiones y dispositivos")
    check("Myself" in view and "Sin revisar (2)" in view, "textos por revisar listados")
    panel.screenshot(path=f"{SHOTS}/v12-ficha-journal-desk.png", full_page=True)
    form = panel.locator("form[data-fb]").first
    form.locator("textarea").fill("Great start! Say: \"I work in marketing, and I want to speak up in meetings.\"")
    form.locator("button[type=submit]").click()
    check(wait_sql(f"select count(*) from public.sms_journal_texts where student_id = '{stu}' and feedback like 'Great start!%'", "1"),
          "retroalimentación guardada")
    panel.click("[data-sub=reports]")
    check("Great class today." in panel.inner_text("#j-list"), "reportes del día visibles en la ficha")

    # ------------------------------------------------ 4. La corrección vuelve al journal
    jr.goto(SITE + "/journal.html#home")
    jr.wait_for_selector("#view")
    jr.wait_for_timeout(500)
    jr.evaluate("syncNow()")
    jr.wait_for_selector("[data-act=feedback]", timeout=10000)
    check("left feedback on 1" in jr.inner_text("#view"), "aviso de retroalimentación en el inicio del journal")
    jr.click("#view [data-act=feedback]")
    jr.wait_for_selector("#scrim.open")
    fb = jr.inner_text("#sheet")
    check("Great start!" in fb and "I am Valentina" in fb, "el estudiante ve la corrección junto a su texto")
    jr.screenshot(path=f"{SHOTS}/v12-journal-retro-movil.png")
    check(wait_sql(f"select feedback_seen_at is not null from public.sms_journal_texts where client_id = 'w-e2e-1'", "t"),
          "la ficha sabe que la corrección se entregó")
    jr.keyboard.press("Escape")
    panel.goto(PAGES + "/admin/#/inicio"); panel.wait_for_selector(".kpis")
    check("Valentina Ríos" in panel.inner_text("#view"), "Inicio: actividad del journal en las últimas 24 h")
    panel.goto(PAGES + "/admin/#/estudiantes?f=journal"); panel.wait_for_selector("#rows .row")
    check("Valentina Ríos" in panel.inner_text("#rows") and "En línea ahora" in panel.inner_text("#rows"), "Estudiantes: filtro journal con presencia")
    panel.goto(PAGES + f"/admin/#/persona/{stu}?tab=journal"); panel.wait_for_selector("text=Acceso al journal")

    # Un texto nuevo se envía solo (sin reenviar los anteriores)
    before = sql(f"select max(updated_at)::text from public.sms_journal_texts where client_id = 'w-e2e-1'")
    jr.evaluate("""() => { state.writingSamples.push({id:'w-e2e-2', createdAt:new Date().toISOString(), kind:'free', prompt:'Explain something.',
                    content:'First I open my laptop. Then I check the data.', wordCount:10, topic:'Explain', label:'Explain'}); save(); return syncNow(); }""")
    check(wait_sql(f"select count(*) from public.sms_journal_texts where student_id = '{stu}'", "3"), "un escrito nuevo llega al panel")
    check(sql(f"select max(updated_at)::text from public.sms_journal_texts where client_id = 'w-e2e-1'") == before, "los textos sin cambios no se reenvían")

    # ------------------------------------------------ 4b. Mensajes directos del profesor
    panel.reload(); panel.wait_for_selector("#msg-form")
    panel.fill("#msg-body", "Valentina, mañana repasamos el pasado simple.\nTrae tu texto de la clase 3.")
    panel.click("#msg-form button[type=submit]")
    panel.wait_for_selector("text=Le llega al abrir su journal")
    check(sql(f"select count(*) from public.sms_journal_messages where student_id = '{stu}'") == "1", "mensaje enviado desde la ficha")
    panel.fill("#msg-body", "Este lo voy a retirar")
    panel.click("#msg-form button[type=submit]")
    panel.wait_for_function("document.querySelectorAll('[data-withdraw]').length === 2")
    panel.locator("[data-withdraw]").first.click()   # el más reciente
    panel.wait_for_selector("dialog[open]"); panel.click("dialog[open] footer button[type=submit]")
    panel.wait_for_selector("text=Retirado")
    jr.reload()   # el estudiante abre (o vuelve a abrir) su journal
    jr.wait_for_selector("#scrim.open #sheet:has-text('From ProfGermandario')", timeout=15000)
    sheet = jr.inner_text("#sheet")
    check("mañana repasamos el pasado simple" in sheet and "Trae tu texto" in sheet, "al abrir el journal le aparece el mensaje")
    check("Este lo voy a retirar" not in sheet, "el mensaje retirado no le aparece")
    check(jr.locator("#sheet a[href^='https://wa.me/']").count() == 1, "puede responder por WhatsApp")
    jr.wait_for_timeout(500)
    jr.screenshot(path=f"{SHOTS}/v13-journal-mensaje.png")
    check(wait_sql(f"select read_at is not null from public.sms_journal_messages where student_id = '{stu}' and withdrawn_at is null", "t"),
          "el panel registra que lo leyó")
    jr.keyboard.press("Escape")
    jr.reload(); jr.wait_for_selector("#view"); jr.wait_for_timeout(2200)
    check(not jr.locator("#scrim.open").count(), "un mensaje leído no vuelve a abrirse solo")
    panel.reload(); panel.wait_for_selector("#msg-form")
    check("Leído" in panel.inner_text("#view"), "la ficha muestra 'Leído'")
    panel.screenshot(path=f"{SHOTS}/v13-ficha-mensajes.png", full_page=True)

    # ------------------------------------------------ 5. Revocar y reactivar llega al dispositivo
    panel.reload()
    panel.wait_for_selector("[data-revoke]")
    panel.click("[data-revoke]")
    panel.wait_for_selector("dialog[open]")
    panel.click("dialog[open] footer button[type=submit]")
    panel.wait_for_selector(".code-card .b-cancelled")
    st = jr.evaluate("PGAccess.refresh(true).then(s => s.state)")
    check(st == "revoked", "revocar en el panel quita el acceso en el teléfono")
    jr.goto(SITE + "/journal.html#home"); jr.wait_for_selector("#tierChip")
    check("Unlock" in jr.inner_text("#tierChip"), "el journal vuelve a modo vista previa")
    panel.click("[data-reactivate]")
    panel.wait_for_selector(".code-card .b-active")
    st = jr.evaluate("PGAccess.refresh(true).then(s => s.state + '|' + s.tier)")
    check(st == "active|companion", "reactivar devuelve el acceso sin volver a escribir el código")

    # Renovar: vence ayer → el dispositivo lo ve vencido; renovar +1 mes lo reabre
    sql(f"update public.sms_access_codes set valid_until = current_date - 1 where student_id = '{stu}'")
    st = jr.evaluate("PGAccess.refresh(true).then(s => s.state)")
    check(st == "expired", "vencimiento reflejado en el dispositivo")
    panel.reload(); panel.wait_for_selector("[data-renew]")
    check("Acceso: vencido" in panel.inner_text(".person-head"), "ficha: acceso vencido en el encabezado")
    panel.click("[data-renew]")
    panel.wait_for_selector("dialog[open] #ac-until")
    panel.click("dialog[open] [data-q]:nth-child(1)")  # +1 mes desde hoy
    panel.click("dialog[open] footer button[type=submit]")
    panel.wait_for_selector(".code-card .b-active")
    st = jr.evaluate("PGAccess.refresh(true).then(s => s.state)")
    check(st == "active", "renovar desde el panel reabre el acceso")
    check(int(sql(f"select count(*) from public.sms_activity where student_id = '{stu}' and kind = 'access'")) >= 4, "historial de accesos en la ficha")

    # ------------------------------------------------ 6. Dejar de compartir
    jr.goto(SITE + "/journal.html#toolbox"); jr.wait_for_selector("#view")
    jr.evaluate("membershipSheet()")
    jr.wait_for_selector("[data-act=shareStop]")
    check("Shared with ProfGermandario" in jr.inner_text("#sheet"), "Membership muestra que comparte")
    jr.once("dialog", lambda d: d.accept())
    jr.click("[data-act=shareStop]")
    check(wait_sql(f"select sharing from public.sms_journal where student_id = '{stu}'", "f"), "dejar de compartir desde el journal")
    check(sql(f"select count(*) from public.sms_consents where student_id = '{stu}' and kind = 'journal_sharing' and not granted") == "1",
          "el retiro queda registrado")
    sql(f"insert into public.sms_journal_messages (student_id, body) values ('{stu}', 'Llega aunque no compartas')")
    n = jr.evaluate("""async () => { for (let i = 0; i < 30 && SYNC.inbox; i++) await new Promise(r => setTimeout(r, 100));
                         await checkInbox(); return inboxList().filter(m => m.body === 'Llega aunque no compartas').length; }""")
    check(n == 1, "los mensajes llegan aunque el estudiante no comparta su journal")
    check(not jerrs, "sin errores de JavaScript en el journal: %s" % jerrs[:3])
    jctx.close()

    # ------------------------------------------------ 7. Sin conexión: mensaje claro
    octx, off, oerrs = new_page(browser, JOURNAL_INIT.replace(BASE, "http://127.0.0.1:9"), mobile=True)
    off.goto(SITE + "/journal.html#toolbox")
    off.wait_for_selector(".code-form input")
    off.fill(".code-form input", "PG-ABCD-EFGH")
    off.click(".code-form [data-act=applyCode]")
    off.wait_for_function("document.querySelector('.code-msg') && document.querySelector('.code-msg').textContent.length > 0")
    check("offline" in off.inner_text(".code-msg"), "sin conexión al servidor: avisa en vez de decir 'código inválido'")
    octx.close()

    # ------------------------------------------------ 8. Panel: Inicio y Estudiantes
    panel.goto(PAGES + "/admin/#/inicio"); panel.wait_for_selector(".kpis")
    k = panel.inner_text(".kpis")
    check("En el journal ahora" in k and "Textos del journal por revisar" in k and "Accesos por vencer" in k, "Inicio: indicadores del journal")
    panel.goto(PAGES + "/admin/#/estudiantes?f=access"); panel.wait_for_selector("#rows")
    panel.wait_for_timeout(500)
    check("Valentina" not in panel.inner_text("#rows"), "filtro de accesos por vencer excluye a quien acaba de renovar")
    sql(f"update public.sms_access_codes set valid_until = current_date + 3 where student_id = '{stu}'")
    panel.goto(PAGES + "/admin/#/inicio"); panel.wait_for_selector(".kpis")
    panel.goto(PAGES + "/admin/#/estudiantes?f=access"); panel.wait_for_selector("#rows")
    panel.wait_for_timeout(700)
    rows = panel.inner_text("#rows")
    check("Valentina Ríos" in rows and "Vence en 3 días" in rows, "filtro de accesos por vencer la muestra con su aviso")
    check(not perrs, "sin errores de JavaScript en el panel: %s" % perrs[:3])
    pctx.close()

    # ------------------------------------------------ 9. Equipo (rol staff): ve, corrige, no administra códigos
    sctx, sp, serrs = new_page(browser, PANEL_INIT, mobile=True)
    login(sp, "asistente@correo.com")
    sp.goto(PAGES + f"/admin/#/persona/{stu}?tab=journal")
    sp.wait_for_selector("text=Acceso al journal")
    check(sp.locator("[data-act=new-code], [data-renew], [data-revoke]").count() == 0, "el rol Equipo no crea, renueva ni revoca códigos")
    check(sp.locator("form[data-fb]").count() >= 1, "el rol Equipo sí puede corregir textos")
    sp.screenshot(path=f"{SHOTS}/v12-ficha-journal-movil.png", full_page=True)
    check(not serrs, "sin errores de JavaScript (Equipo): %s" % serrs[:3])
    sctx.close()
    browser.close()

failed = [n for ok, n in results if not ok]
print("\n%d/%d pruebas E2E del journal OK" % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
