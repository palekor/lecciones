"""
Pruebas E2E v1.4.2: la ventana de prospectos aparece al frente al entrar al
panel y cuando llega alguien nuevo; permite escribir por WhatsApp con saludo,
marcar como contactado, archivar y posponer.
Uso: BASE=http://127.0.0.1:8787 ANON_KEY=... SHOTS=/ruta python3 test_prospects.py
"""
import os, subprocess, sys, urllib.parse
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:8787")
PAGES = BASE + "/lecciones/sistema-estudiantes"
ANON = os.environ["ANON_KEY"]
SHOTS = os.environ.get("SHOTS", "/tmp")
PSQL = ["psql", "-h", "127.0.0.1", "-p", os.environ.get("PGPORT", "54329"), "-U", "postgres", "-d", "smstest", "-At", "-c"]
sql = lambda q: subprocess.check_output(PSQL + [q]).decode().strip()
INIT = "window.SMS_CONFIG = { supabaseUrl: '%s', supabaseKey: '%s', sdkUrl: '%s/sdk/supabase.js', sdkIntegrity: '%s' };" % (BASE, ANON, BASE, os.environ.get("SDK_SRI", ""))

results = []
def check(cond, name):
    results.append((bool(cond), name)); print(("PASS: " if cond else "FAIL: ") + name)

IGNORED = ("fonts", "net::ERR_FAILED", "WebSocket", "realtime")
def new_page(browser, mobile=False):
    ctx = browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1366, "height": 900},
                              locale="es-CO", timezone_id="America/Bogota")
    ctx.add_init_script(INIT)
    ctx.route("**/fonts.g*/**", lambda r: r.abort())
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

def register(name, email, wa, urgency="asap"):
    """Registro real por la función pública (igual que el formulario)."""
    import json, uuid
    body = {"client_key": str(uuid.uuid4()), "elapsed_ms": 6000, "full_name": name, "email": email, "whatsapp": wa,
            "country": "CO", "english_level": "intermediate", "objective": "professional", "preferred_format": "individual",
            "preferred_contact": "whatsapp", "availability": {"days": ["mon"], "times": ["evening"]}, "urgency": urgency,
            "consent_privacy": True, "notice_version": sql("select data->>'privacy_notice_version' from sms_settings where id = 1")}
    q = "set role anon; select set_config('request.jwt.claims', '{\"role\":\"anon\"}', false); select public.sms_register('%s'::jsonb)->>'ok';" % json.dumps(body).replace("'", "''")
    out = subprocess.check_output(PSQL[:-2] + ["-At", "-c", q]).decode().strip().split("\n")[-1]
    return out == "true"

# Repetible: borra los registros de corridas anteriores de esta prueba
sql("delete from public.sms_students where email like '%.pros@correo.com'")
# Base limpia de prospectos: todo lo anterior queda como ya contactado
sql("update public.sms_leads set last_contact_at = coalesce(last_contact_at, now())")
sql("delete from public.sms_rate_events")
check(register("Camila Torres", "camila.pros@correo.com", "+573004441122"), "registro de un prospecto nuevo")
check(register("Robot Prueba", "prueba.pros@correo.com", "+573004441133", urgency="exploring"), "registro de prueba (para archivar)")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx, page, errs = new_page(browser)
    page.add_init_script("try { if (!sessionStorage.getItem('t')) { localStorage.removeItem('sms_prospects_snooze'); sessionStorage.setItem('t', '1'); } } catch (e) {}")
    login(page, "profgermandario@gmail.com")

    # 1. Al entrar, la ventana aparece sola al frente
    page.wait_for_selector("dialog.prospects[open]", timeout=8000)
    txt = page.inner_text("dialog.prospects")
    check("Prospectos por atender" in txt and "Camila Torres" in txt and "Robot Prueba" in txt, "al entrar aparecen los prospectos sin atender")
    first = page.locator("dialog.prospects article.pros").first.inner_text()
    check("Camila Torres" in first and "Lo antes posible" in first, "primero quien dijo 'lo antes posible'")
    check(page.inner_text("#pros-count") == "2" and page.title().startswith("(2)"), "contador en el botón y en la pestaña del navegador")
    href = page.get_attribute("dialog.prospects article.pros:first-child a[data-wa]", "href")
    msg = urllib.parse.unquote(href.split("text=")[1]) if href and "text=" in href else ""
    check("573004441122" in href and msg.startswith("Hola Camila") and "Germandario" in msg, "WhatsApp abre el chat con el saludo listo")
    page.screenshot(path=f"{SHOTS}/v142-prospectos-desk.png")

    # 2. Marcar como contactado
    page.click("dialog.prospects article.pros:first-child [data-done]")
    page.wait_for_function("!document.querySelector('dialog.prospects').innerText.includes('Camila Torres')")
    check(sql("select l.status || '|' || (l.last_contact_at is not null) from sms_leads l join sms_students s on s.id = l.student_id where s.email = 'camila.pros@correo.com'")
          == "contacted|true", "✓ Ya lo contacté: queda contactado y registrado en el historial")
    check(sql("select count(*) from sms_activity a join sms_students s on s.id = a.student_id where s.email = 'camila.pros@correo.com' and a.kind = 'contact'") == "1",
          "el contacto queda en su historial")

    # 3. Archivar un registro de prueba
    page.click("dialog.prospects [data-archive]")
    page.wait_for_selector("dialog.dlg:not(.prospects)[open]")
    page.click("dialog.dlg:not(.prospects)[open] footer button[type=submit]")
    page.wait_for_function("document.querySelector('dialog.prospects') && document.querySelector('dialog.prospects').innerText.includes('Todos atendidos')")
    check(sql("select l.status from sms_leads l join sms_students s on s.id = l.student_id where s.email = 'prueba.pros@correo.com'") == "archived",
          "'No es prospecto' lo archiva")
    page.click("dialog.prospects footer [data-later]")
    page.wait_for_function("!document.querySelector('dialog.prospects')")
    check(page.locator("#pros-count").is_hidden(), "sin prospectos pendientes, el contador desaparece")

    # 4. Llega alguien nuevo: la ventana vuelve a aparecer sola
    check(register("Daniel Ruiz", "daniel.pros@correo.com", "+573004441144", urgency="1_3_months"), "llega un registro nuevo")
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_selector("dialog.prospects[open]", timeout=8000)
    check("Daniel Ruiz" in page.inner_text("dialog.prospects"), "un prospecto nuevo hace aparecer la ventana")

    # 5. 'Más tarde' la pospone; el botón la vuelve a abrir
    page.click("dialog.prospects footer [data-later]")
    page.reload(); page.wait_for_selector("#shell:not([hidden])"); page.wait_for_timeout(1500)
    check(page.locator("dialog.prospects[open]").count() == 0 and page.inner_text("#pros-count") == "1", "'Más tarde' la pospone (el contador sigue visible)")
    page.click("#pros-btn")
    page.wait_for_selector("dialog.prospects[open]")
    check("Daniel Ruiz" in page.inner_text("dialog.prospects"), "el botón de prospectos la abre cuando quieras")
    page.click("dialog.prospects a[data-go][href*='persona']")
    page.wait_for_selector(".person-head")
    check("Daniel Ruiz" in page.inner_text(".person-head") and page.locator("dialog.prospects").count() == 0, "'Ficha' abre su ficha y cierra la ventana")
    check(not errs, "sin errores de JavaScript: %s" % errs[:3])
    ctx.close()

    # 6. Celular
    ctx, page, errs = new_page(browser, mobile=True)
    page.add_init_script("try { if (!sessionStorage.getItem('t')) { localStorage.removeItem('sms_prospects_snooze'); sessionStorage.setItem('t', '1'); } } catch (e) {}")
    login(page, "asistente@correo.com")
    page.wait_for_selector("dialog.prospects[open]", timeout=8000)
    check("Daniel Ruiz" in page.inner_text("dialog.prospects"), "también aparece para el rol Equipo en el celular")
    page.screenshot(path=f"{SHOTS}/v142-prospectos-movil.png")
    check(not errs, "sin errores de JavaScript (celular): %s" % errs[:3])
    ctx.close()
    browser.close()

failed = [n for ok, n in results if not ok]
print("\n%d/%d pruebas E2E de prospectos OK" % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
