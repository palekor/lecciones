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
PANEL_INIT = "window.SMS_CONFIG = { supabaseUrl: '%s', supabaseKey: '%s', sdkUrl: '%s/sdk/supabase.js', sdkIntegrity: '%s', prospectsPopup: false };" % (BASE, ANON, BASE, os.environ.get("SDK_SRI", ""))
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
    panel.wait_for_selector("#tab-body h2:has-text('Acceso al journal')")
    check("Sin código de acceso" in panel.inner_text("#view"), "ficha sin código muestra cómo empezar")
    panel.click("[data-act=new-code]")
    panel.wait_for_selector("dialog[open] #ac-tier")
    check(panel.is_checked("dialog[open] input[name=dur][value=plan]") and "Válido hasta el" in panel.inner_text("dialog[open] #ac-sum"),
          "validez propuesta = renovación de su plan, con la fecha exacta")
    dur = panel.eval_on_selector_all("dialog[open] input[name=dur]", "els => els.map(e => e.value)")
    check(dur == ["plan", "7d", "1m", "3m", "6m", "12m", "none", "date"], "opciones de validez: plan, 1 semana, 1/3/6 meses, 1 año, sin vencimiento, otra fecha")
    panel.select_option("dialog[open] #ac-tier", "companion")
    panel.click("dialog[open] label.dur:has(input[value='3m'])")
    check(sql("select to_char(current_date, 'YYYY')") in panel.inner_text("dialog[open] #ac-sum") or "Válido hasta" in panel.inner_text("dialog[open] #ac-sum"), "el resumen muestra hasta cuándo vale")
    panel.fill("dialog[open] #ac-note", "Pagó 3 meses")
    panel.click("dialog[open] footer button[type=submit]")
    panel.wait_for_selector("dialog[open] .code-created")
    check(re.search(r"PG-[A-Z2-9]{4}-[A-Z2-9]{4}", panel.inner_text("dialog[open] .code-created")) is not None
          and "Enviar por WhatsApp" in panel.inner_text("dialog[open] .code-created"), "al crear, muestra el código en grande con WhatsApp y copiar")
    check(sql(f"select valid_until = (current_date + interval '3 months')::date from public.sms_access_codes where student_id = '{stu}'") == "t", "validez de 3 meses guardada")
    panel.click("dialog[open] header [data-close]")
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
    panel.wait_for_selector("#tab-body h2:has-text('Acceso al journal')")
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
    panel.goto(PAGES + f"/admin/#/persona/{stu}?tab=journal"); panel.wait_for_selector("#tab-body h2:has-text('Acceso al journal')")

    # Un texto nuevo se envía solo (sin reenviar los anteriores)
    before = sql(f"select max(updated_at)::text from public.sms_journal_texts where client_id = 'w-e2e-1'")
    jr.evaluate("""() => { state.writingSamples.push({id:'w-e2e-2', createdAt:new Date().toISOString(), kind:'free', prompt:'Explain something.',
                    content:'First I open my laptop. Then I check the data.', wordCount:10, topic:'Explain', label:'Explain'}); save(); }""")
    jr.evaluate("""async () => { for (let i = 0; i < 50 && SYNC.busy; i++) await new Promise(r => setTimeout(r, 100)); return syncNow(); }""")
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

    # ------------------------------------------------ 4c. Tablero: quién entra y cómo va
    jtxt = panel.inner_text("#view")
    check("Entradas" in jtxt and "Hoy ·" in jtxt and panel.locator(".days-strip i.l1, .days-strip i.l2, .days-strip i.l3").count() >= 1,
          "ficha: entradas de hoy y tira de días")
    panel.goto(PAGES + "/admin/#/journal"); panel.wait_for_selector("#jb-rows .row")
    board = panel.inner_text("#view")
    check("Entradas recientes" in board and "Valentina Ríos" in board and "Hoy ·" in board, "tablero: entradas recientes con hora")
    row = panel.locator("#jb-rows a.row", has_text="Valentina Ríos").inner_text()
    check("En línea ahora" in row and "2/17" in row, "tablero: en línea y misiones en la fila del estudiante")
    check(panel.locator("#jb-rows a.row", has_text="Valentina Ríos").locator(".days-strip i").count() == 14, "tablero: tira de 14 días")
    kp = panel.inner_text(".kpis")
    check("Entraron hoy" in kp and "En el journal ahora" in kp, "tablero: indicadores")
    panel.click("[data-f=today]")
    check("Valentina Ríos" in panel.inner_text("#jb-rows"), "filtro 'Entraron hoy'")
    panel.click("[data-f=notsharing]")
    check("Valentina Ríos" not in panel.inner_text("#jb-rows"), "filtro 'No comparten' la excluye (sí comparte)")
    panel.screenshot(path=f"{SHOTS}/v14-tablero-desk.png", full_page=True)
    panel.goto(PAGES + f"/admin/#/persona/{stu}?tab=journal"); panel.wait_for_selector("#msg-form")

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
    panel.wait_for_selector("dialog[open] input[name=dur][value=keep]")
    panel.click("dialog[open] label.dur:has(input[value='1m'])")   # vencido: +1 mes desde hoy
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

    # ------------------------------------------------ 8. Panel: Inicio, Journal y Estudiantes
    panel.goto(PAGES + "/admin/#/journal?f=notsharing"); panel.wait_for_selector("#jb-rows")
    panel.wait_for_timeout(300)
    rtxt = panel.inner_text("#jb-rows")
    check("Valentina Ríos" in rtxt and "No comparte su journal" in rtxt and "2/17" not in rtxt,
          "tablero: al dejar de compartir solo se ve su acceso, sin conexión ni progreso")
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
    sp.wait_for_selector("#tab-body h2:has-text('Acceso al journal')")
    check(sp.locator("[data-act=new-code], [data-renew], [data-revoke]").count() == 0, "el rol Equipo no crea, renueva ni revoca códigos")
    check(sp.locator("form[data-fb]").count() >= 1, "el rol Equipo sí puede corregir textos")
    sp.screenshot(path=f"{SHOTS}/v12-ficha-journal-movil.png", full_page=True)
    sp.goto(PAGES + "/admin/#/journal"); sp.wait_for_selector("#jb-rows")
    check("Valentina Ríos" in sp.inner_text("#jb-rows"), "el rol Equipo ve el tablero del journal")
    sp.screenshot(path=f"{SHOTS}/v14-tablero-movil.png", full_page=True)
    check(not serrs, "sin errores de JavaScript (Equipo): %s" % serrs[:3])
    sctx.close()

    # ------------------------------------------------ 10. Dar acceso desde la sección Journal + aviso de base de datos
    sql("delete from public.sms_students where email = 'tomas.board@correo.com'")
    tomas = sql("insert into public.sms_students (full_name, email, whatsapp, status) values ('Tomás Board', 'tomas.board@correo.com', '+573007778899', 'active') returning id").split("\n")[0]
    actx, ap, aerrs = new_page(browser, PANEL_INIT)
    login(ap, "profgermandario@gmail.com")
    check(ap.locator("#schema-banner").count() == 0, "con la base de datos al día no aparece el aviso")
    ap.goto(PAGES + "/admin/#/journal"); ap.wait_for_selector("#give-access")
    ap.click("#give-access")
    ap.wait_for_selector("dialog[open] #pick-q")
    ap.fill("dialog[open] #pick-q", "Tomás")
    ap.wait_for_selector("dialog[open] #pick-list button[data-id]")
    ap.click("dialog[open] #pick-list button[data-id]")
    ap.click("dialog[open] footer [data-submit]")
    ap.wait_for_selector("dialog[open] #ac-tier")
    ap.click("dialog[open] footer button[type=submit]")
    ap.wait_for_selector("dialog[open] .code-created", timeout=10000)
    ap.click("dialog[open] .code-created a[href*='persona']")
    ap.wait_for_selector(".code-card .mono", timeout=10000)
    check(f"/persona/{tomas}" in ap.url and "tab=journal" in ap.url, "'Dar acceso a un estudiante' crea el código y lleva a su ficha")
    check(sql(f"select count(*) from public.sms_access_codes where student_id = '{tomas}'") == "1", "código creado para la persona elegida")
    ap.click("[data-tab=resumen]")
    ap.click(".person-head [data-goto=journal]")
    ap.wait_for_selector(".code-card")
    check(True, "el botón '🔑 Acceso al journal' de la ficha lleva a sus códigos")
    # Desde la lista de Estudiantes: columna "Acceso al journal" con botón en cada fila
    sql("delete from public.sms_students where email = 'sara.lista@correo.com'")
    sara = sql("insert into public.sms_students (full_name, email, whatsapp, status) values ('Sara Lista', 'sara.lista@correo.com', '+573006665544', 'active') returning id").split("\n")[0]
    ap.goto(PAGES + "/admin/#/estudiantes"); ap.wait_for_selector("#rows .row.clickable")
    check(ap.locator("#give-access").count() == 1 and "Acceso al journal" in ap.inner_text("#rows .row.head"), "Estudiantes: botón '🔑 Crear código' arriba y columna de acceso")
    row = ap.locator("#rows .row.clickable", has_text="Sara Lista")
    row.locator("[data-code-new]").click()
    ap.wait_for_selector("dialog[open] input[name=dur]")
    check("Crear código para Sara" in ap.inner_text("dialog[open] header"), "el botón de la fila abre el código para esa persona")
    ap.click("dialog[open] label.dur:has(input[value='7d'])")
    ap.click("dialog[open] footer button[type=submit]")
    ap.wait_for_selector("dialog[open] .code-created")
    check(sql(f"select valid_until = current_date + 7 from public.sms_access_codes where student_id = '{sara}'") == "t", "validez de 1 semana (prueba) guardada")
    wa = ap.get_attribute("dialog[open] .code-created a[href^='https://wa.me/']", "href") or ""
    check("573006665544" in wa, "WhatsApp listo para enviarle el código")
    ap.click("dialog[open] header [data-close]")
    ap.wait_for_function("document.querySelector('#rows') && [...document.querySelectorAll('#rows .row.clickable')].some(r => r.innerText.includes('Sara Lista') && r.querySelector('[data-code-renew]'))")
    row = ap.locator("#rows .row.clickable", has_text="Sara Lista")
    check("Vence en 7 días" in row.inner_text() or "Essential" in row.inner_text(), "la fila muestra el estado del acceso")
    row.locator("[data-code-renew]").click()
    ap.wait_for_selector("dialog[open] input[name=dur][value=keep]")
    ap.click("dialog[open] label.dur:has(input[value='none'])")
    ap.click("dialog[open] footer button[type=submit]")
    check(wait_sql(f"select valid_until is null from public.sms_access_codes where student_id = '{sara}'", "t"), "cambiar validez a 'sin vencimiento' desde la lista")
    ap.wait_for_timeout(500)
    ap.locator("#rows .row.clickable", has_text="Sara Lista").locator(".name").click()
    ap.wait_for_selector(".person-head")
    check("Sara Lista" in ap.inner_text(".person-head"), "tocar la fila abre la ficha")
    ap.screenshot(path=f"{SHOTS}/v144-ficha-sara.png")
    ap.goto(PAGES + "/admin/#/estudiantes"); ap.wait_for_selector("#rows .row.clickable")
    ap.screenshot(path=f"{SHOTS}/v144-estudiantes-desk.png", full_page=True)
    ap.click("#give-access"); ap.wait_for_selector("dialog[open] #pick-q")
    ap.fill("dialog[open] #pick-q", "Sara"); ap.wait_for_selector("dialog[open] #pick-list button[data-id]")
    ap.click("dialog[open] #pick-list button[data-id]"); ap.click("dialog[open] footer [data-submit]")
    ap.wait_for_selector("dialog[open] input[name=dur]")
    ap.click("dialog[open] label.dur:has(input[value='date'])")
    check(ap.locator("dialog[open] #ac-until").is_visible(), "'Otra fecha' muestra el calendario")
    ap.screenshot(path=f"{SHOTS}/v144-validez.png")
    ap.click("dialog[open] header [data-close]")

    # Simula que en Supabase falta ejecutar el SQL nuevo
    sql("alter function public.sms_journal_overview() rename to sms_journal_overview_off")
    sql("alter function public.sms_journal_board(int) rename to sms_journal_board_off")
    sql("alter table public.sms_journal_texts rename to sms_journal_texts_off")
    sql("notify pgrst, 'reload schema'"); subprocess.run(["sleep", "1.5"])
    try:
        ap.goto(PAGES + "/admin/#/inicio"); ap.reload(); ap.wait_for_selector("#schema-banner", timeout=10000)
        check("Falta actualizar la base de datos" in ap.inner_text("#schema-banner"), "si falta el SQL nuevo, el panel lo avisa arriba")
        ap.goto(PAGES + f"/admin/#/persona/{tomas}?tab=journal"); ap.wait_for_selector("text=todavía no está activado", timeout=10000)
        check("Run without RLS" in ap.inner_text("#view"), "la pestaña Journal explica qué hacer en vez de quedarse cargando")
        ap.goto(PAGES + "/admin/#/journal"); ap.wait_for_selector("text=todavía no está activado", timeout=10000)
        check(True, "la sección Journal también lo explica")
    finally:
        sql("alter function public.sms_journal_overview_off() rename to sms_journal_overview")
        sql("alter function public.sms_journal_board_off(int) rename to sms_journal_board")
        sql("alter table public.sms_journal_texts_off rename to sms_journal_texts")
        sql("notify pgrst, 'reload schema'"); subprocess.run(["sleep", "1.5"])
    actx.close()
    browser.close()

failed = [n for ok, n in results if not ok]
print("\n%d/%d pruebas E2E del journal OK" % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
