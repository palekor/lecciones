# Sistema de Estudiantes ProfGermandario · v1.4

Plataforma de gestión educativa y comercial para ProfGermandario: registro de prospectos, lista de espera, reservas, panel administrativo y seguimiento del progreso y de la relación comercial. Está construida dentro de este repositorio (GitHub Pages) sobre el **mismo proyecto Supabase** que ya usa `palekor-sync.js`, sin modificar ninguna app existente.

> La carpeta `_sistema/` no se publica en GitHub Pages (Jekyll ignora carpetas que empiezan por `_`). Aquí viven la base de datos, las pruebas y esta guía.

---

## 1. Descripción y alcance

| Módulo | Dónde | Qué incluye |
|---|---|---|
| 1. Registro | `/registro/` (público) | Datos de contacto, país, zona horaria, ocupación opcional, nivel, objetivo, formato, urgencia, disponibilidad, medio de contacto, preguntas configurables, consentimiento separado para marketing. Detección de duplicados, anti-spam, confirmación con siguiente paso. |
| 2. Lista de espera e interesados | `/lista-de-espera/` (público) y panel → Leads / Lista de espera | 11 estados (con nombres configurables), prioridad manual transparente, filtros por estado, fecha, objetivo, urgencia, disponibilidad; orden por registro, último contacto, seguimiento, incorporación estimada; historial de interacciones con canal, resumen y próxima acción; alta manual; "Necesitan atención"; CSV. |
| 3. Reservas | `/reservar/` (público) y panel → Agenda | Franjas semanales con duración y pausa entre sesiones, días bloqueados, aperturas especiales, tipos de sesión configurables, zona horaria explícita, solicitudes vs. confirmadas, imposibilidad de cruces (restricción en la base de datos), calendario semanal y lista, confirmar/rechazar/reprogramar/cancelar/realizada/ausencia, política de cancelación. |
| 4. Panel | `/admin/` | **Ventana de prospectos (v1.4.2):** al entrar al panel y cada vez que alguien se registra, aparece al frente la lista de quienes nadie ha contactado (primero "lo antes posible"), con WhatsApp con saludo listo (plantilla "Primer contacto" en Ajustes), llamar, correo, ficha, "✓ Ya lo contacté" y "No es prospecto"; "Más tarde" la pospone 2 h salvo que llegue alguien nuevo; botón con contador junto a la campana, contador en la pestaña del navegador y aviso opcional del navegador. Indicadores calculados con datos reales, directorio con búsqueda, filtros, orden y paginación, ficha individual por pestañas, notificaciones, mensajes por enviar, exportaciones. |
| 5. Progreso y comercial | Ficha → Progreso, Evaluaciones, Tareas, Pagos | Perfil educativo (nivel inicial/actual estimado, habilidades, observaciones, próximos objetivos, fecha de revisión), ruta de 18 pasos configurable, evaluaciones por habilidad con historial, tareas y recordatorios, plan, fechas, precio acordado, pagos, saldo, renovación. |
| 6. Acceso y journal (v1.2) | Ficha → Journal · `journal.html` · `pg-access.js` · lecciones `steps/` | Códigos de acceso por estudiante creados en el panel (programa, vigencia, nota), activos al instante, sin editar GitHub; renovar, cambiar programa, revocar y reactivar llegan al dispositivo; hasta 5 dispositivos por código. Con autorización expresa del estudiante, el journal envía su avance, racha y última conexión, sus escritos y reflexiones y sus reportes del día; el profesor corrige cada texto en la ficha y la corrección vuelve al journal. **Mensajes directos (v1.3):** escribes en la ficha → Journal y al estudiante le aparece en pantalla al abrir su journal (no requiere que comparta); la ficha muestra *Entregado* y *Leído*, y puedes retirar un mensaje antes de que lo lea. **Tablero Journal (v1.4):** en el menú del panel, todos los estudiantes juntos: quién está en línea, quién entró hoy, entradas recientes con hora y tiempo aproximado, tira de días activos (14 días), misiones, racha, estrellas y textos por revisar; además "Necesitan tu atención" (no entran hace 3+ días, acceso por vencer, con acceso pero sin compartir). Indicadores en Inicio y filtros en Estudiantes. |

**Fuera del alcance de la v1.4** (decisiones documentadas en la sección 18): cuentas de estudiante, sesiones grupales con capacidad mayor a uno, envío automático real de correos/WhatsApp y cobros en línea.

## 2. Arquitectura general

```
Navegador (GitHub Pages: HTML + JavaScript sin compilación)
   │  llave publicable de Supabase (no da acceso por sí sola)
   ▼
Supabase
   ├─ Auth: inicio de sesión con código al correo (sesión compartida "palekor-auth")
   ├─ PostgREST: tablas sms_* protegidas con Row Level Security
   └─ Funciones SQL "security definer": el servidor de los formularios públicos
      y de las operaciones sensibles (validación, límites, auditoría)
```

GitHub Pages es solo alojamiento estático: no guarda datos ni ejecuta lógica privada. Toda la persistencia, la autorización y la validación ocurren en Supabase. Los datos personales nunca se guardan en el repositorio, en archivos JSON públicos ni como sustituto en el almacenamiento del navegador.

**Modelo de datos** (todas las tablas con prefijo `sms_`):

| Entidad | Tabla |
|---|---|
| Usuarios y roles del panel | `sms_staff`, `sms_staff_invites` (las cuentas viven en Supabase Auth) |
| Personas (prospectos y estudiantes; una sola ficha por persona) | `sms_students` |
| Etapas comerciales | `sms_leads` |
| Historial de interacciones y auditoría | `sms_activity` (los cambios de estado los escriben triggers; nadie los puede editar) |
| Tareas y seguimientos | `sms_tasks` (+ `next_follow_up_at` y `next_action` en lead y ficha) |
| Disponibilidad | `sms_availability_rules`, `sms_availability_exceptions` |
| Reservas | `sms_bookings` (restricción de exclusión contra cruces) |
| Tipos de sesión | `sms_session_types` |
| Planes y pagos | `sms_plans`, `sms_payments` |
| Pasos del programa y progreso | `sms_journey_steps`, `sms_progress` |
| Evaluaciones | `sms_assessments` |
| Consentimientos | `sms_consents` |
| Mensajes para la persona | `sms_outbox` |
| Avisos al equipo | `sms_notifications` |
| Códigos de acceso y dispositivos | `sms_access_codes`, `sms_access_devices` (solo la huella SHA-256 de la llave de cada dispositivo) |
| Journal compartido | `sms_journal` (avance y conexión), `sms_journal_texts` (textos + retroalimentación), `sms_journal_reports` (reporte de cada día) |
| Mensajes del profesor | `sms_journal_messages` (texto, enviado, entregado, leído, retirado) |
| Entradas al journal | `sms_journal_visits` (por estudiante y día: primera y última señal, entradas, tiempo activo aproximado; solo de quienes comparten) |
| Técnicas internas (sin acceso desde la API) | `sms_settings`, `sms_secrets`, `sms_submissions`, `sms_rate_events` |

## 3. Tecnologías

- HTML, CSS y JavaScript (módulos ES) sin dependencias de compilación; tipografía Figtree.
- `@supabase/supabase-js` 2.116.0 desde jsDelivr con huella de integridad (SRI).
- Supabase: PostgreSQL 15+, Auth (código por correo), PostgREST, Realtime (opcional).
- Pruebas: PostgreSQL 16, PostgREST 12, Node 22 y Playwright (Chromium).

## 4. Requisitos previos

- Acceso al proyecto Supabase `bbrdmddytqvwpbuuaqsc` (el mismo de `palekor-sync.js`) con permiso para usar el SQL Editor.
- Acceso de escritura al repositorio `palekor/lecciones` con GitHub Pages activo.
- Para correr las pruebas localmente: PostgreSQL 16, el binario de PostgREST 12, Node 22, Python 3 con Playwright.

## 5. Instalación local

No hay compilación. Para ver las páginas en tu computador:

```bash
python3 -m http.server 8000      # desde la raíz del repositorio
# abre http://localhost:8000/sistema-estudiantes/registro/
```

Las páginas se conectan al Supabase real configurado en `sistema/config.js`. Para trabajar contra una base de pruebas usa la pila local de la sección 11 (no toca datos reales).

## 6. Variables de entorno

El sitio no usa variables de entorno ni secretos: la configuración pública está en `sistema/config.js` (URL del proyecto y **llave publicable**, diseñada para el navegador). **Nunca** pongas allí la `service_role` ni una `secret key`.

`.env.example` (en la raíz) documenta solo las variables de la pila de pruebas y las de integraciones futuras, sin valores reales. `.gitignore` excluye `.env`, credenciales y respaldos.

## 7. Configuración de la base de datos

Todo está en un único archivo: `_sistema/supabase/001_sistema_estudiantes.sql`.

1. Revisa la sección `0. CONFIGURACIÓN INICIAL` del archivo (correo del dueño).
2. Supabase → **SQL Editor** → pega el archivo completo → **Run**.

El script es **idempotente**: sirve para instalar desde cero y para actualizar una instalación anterior (v1.0 a v1.3 → v1.4) sin perder datos. Se puede ejecutar varias veces. Si Supabase pregunta por RLS al ejecutar, elige **Run without RLS**: el script activa RLS en todas sus tablas por su cuenta (sección 10).

## 8. Migraciones y creación del esquema

- La sección `1` crea las tablas originales; la sección `1b` (v1.1) y la `1c` (v1.2, acceso y journal) agregan columnas, tablas y restricciones nuevas de forma segura (`add column if not exists`, reemplazo de restricciones con nombre). Las funciones del journal están en la sección `8b`.
- Las funciones se definen con `create or replace`; las vistas se recrean.
- Para una actualización futura: edita el mismo archivo manteniendo la regla "re-ejecutable", agrega pruebas en `_sistema/tests/` y vuelve a ejecutarlo en Supabase.

## 9. Creación segura del primer administrador

- No hay registro público de administradores ni credenciales en el repositorio.
- El SQL deja una **invitación** para el correo del dueño definido en la sección 0. La primera vez que esa persona entra a `/admin/` con el código que llega a su correo, queda como **Dueño**. Si ese correo ya tenía cuenta (por ejemplo, por `demoney.html`), queda activo de inmediato.
- Otras personas del equipo se invitan desde **Ajustes → Equipo**. Solo un Dueño puede crear otro Dueño y siempre debe quedar al menos uno.

## 10. Ejecución en desarrollo

Edita los archivos y recarga el navegador (no hay paso de compilación). Para probar contra datos falsos, levanta la pila local:

```bash
export POSTGREST_BIN=/ruta/postgrest SUPABASE_UMD=/ruta/supabase.js LOGDIR=/tmp
bash _sistema/tests/e2e/start_stack.sh
# sirve el repositorio completo en http://127.0.0.1:8787/lecciones/ (código de acceso: 123456)
```

## 11. Ejecución de pruebas

```bash
POSTGREST_BIN=… SUPABASE_UMD=… SDK_SRI=… bash _sistema/tests/e2e/run_all.sh
```

Resultados de la última ejecución (Postgres 16 con un entorno equivalente a Supabase + PostgREST 12 + Chromium real, con la versión exacta del SDK y la verificación SRI activa):

| Suite | Resultado |
|---|---|
| SQL v1.0 (`test_schema.sql`) | 94 / 94 |
| SQL v1.1 (`test_v11.sql`) | 49 / 49 |
| SQL v1.2 (`test_v12.sql`, acceso y journal) | 83 / 83 |
| SQL v1.3 (`test_v13.sql`, mensajes) | 23 / 23 |
| SQL v1.4 (`test_v14.sql`, entradas y tablero) | 22 / 22 |
| Unitarias del cliente (`core.test.mjs`) | 11 / 11 |
| E2E páginas públicas (`test_public.py`, incluye el campo trampa vs. autocompletado) | 32 / 32 |
| E2E panel (`test_admin.py`) | 55 / 55 |
| E2E prospectos (`test_prospects.py`: aparece al entrar y al llegar alguien nuevo, saludo por WhatsApp, contactado, archivar, posponer, celular) | 18 / 18 |
| E2E journal (`test_journal.py`: código en el panel → teléfono → autorización → envío → corrección → mensajes → tablero → revocar/reactivar/renovar) | 64 / 64 |

Las pruebas E2E sirven el repositorio completo con la misma estructura de GitHub Pages (`/lecciones/sistema-estudiantes/…`, `/lecciones/journal.html`, `/lecciones/steps/…`). Además: actualizaciones v1.0 → v1.1, v1.1 → v1.2, v1.2 → v1.3 y v1.3 → v1.4 probadas con datos existentes; auditoría automática de que todas las tablas tienen RLS, todas las funciones tienen `search_path` fijo y el rol público no tiene permisos directos sobre ninguna tabla.

**No probado** (requiere el Supabase real o credenciales): envío real del correo con código, Realtime, cabeceras de IP del proxy de Supabase, `pg_cron` y las llamadas del journal con la llave publicable real (`sb_publishable_…` en la cabecera `apikey`; en las pruebas se usa una llave local equivalente).

## 12. Construcción de producción

No aplica: los archivos se publican tal cual. Antes de publicar, ejecuta las pruebas y verifica sintaxis con:

```bash
for f in sistema/*.js sistema/admin/*.js sistema/admin/views/*.js; do node --experimental-default-type=module --check "$f"; done
```

## 13. Despliegue

1. Ejecuta el SQL en Supabase (sección 7).
2. Integra los archivos en la rama que publica GitHub Pages. `journal.html` y `pg-access.js` van en la raíz del repositorio (los usan el journal y todas las lecciones de `steps/`). El sistema vive en la carpeta `sistema-estudiantes/` del repositorio. Páginas: `https://palekor.github.io/lecciones/sistema-estudiantes/` + `registro/`, `lista-de-espera/`, `reservar/`, `privacidad/`, `admin/`.
3. En Supabase → Authentication → URL Configuration, agrega `https://palekor.github.io/lecciones/**` (y tu dominio propio si lo usas) a **Redirect URLs** para que el enlace del correo vuelva al panel. El código de 6 dígitos funciona aunque no lo agregues.
4. Verifica que la plantilla del correo de inicio de sesión incluya el código (`{{ .Token }}`); `palekor-sync.js` ya la usa.
5. Entra a `/admin/`, activa tus franjas en **Agenda** (las de ejemplo vienen inactivas) y revisa **Ajustes**.

## 14. Dominio y HTTPS

- `palekor.github.io` ya sirve por HTTPS.
- Para usar `profgermandario.com`: en GitHub → Settings → Pages agrega el dominio, configura los registros DNS que GitHub indique y activa **Enforce HTTPS**. Luego agrega el dominio a las Redirect URLs de Supabase y actualiza el enlace de la política en **Ajustes → Privacidad**.

## 15. Correo y otras integraciones

| Integración | Estado | Cómo habilitarla |
|---|---|---|
| Código de acceso por correo | Activo (Supabase Auth) | Ya configurado en el proyecto. |
| Avisos al equipo | Activo en el panel (campana + contadores) | Para recibirlos por correo: Supabase → Database Webhooks sobre `sms_notifications` hacia un servicio de correo. |
| Mensajes para la persona (confirmación, cancelación, reprogramación, recordatorio) | Cola `sms_outbox` + envío con un toque desde **Mensajes** (WhatsApp o correo del equipo) | Para envío automático: una Edge Function que lea los pendientes, envíe con un proveedor (correo o WhatsApp Business API) y los marque. No se incluye porque requiere credenciales y no se puede probar aquí. |
| Recordatorios automáticos 24 h antes | Se preparan al abrir el panel (y cada 5 min con el panel abierto) | Opcional, sin probar aquí: `create extension if not exists pg_cron;` y `select cron.schedule('sms-recordatorios', '*/15 * * * *', $$select public.sms__enqueue_reminders()$$);` |
| Journal (Fluency OS) | Activo con códigos del panel y autorización del estudiante | El journal envía cada 3 minutos mientras está abierto, al guardar y al cerrar; sin conexión, reintenta. Las grabaciones de audio nunca salen del dispositivo. |
| Google Calendar, pasarela de pagos, analítica, app móvil | No implementadas | La arquitectura está desacoplada (todo pasa por la base de datos y funciones); cada integración requiere cuenta y credenciales propias. |

## 16. Respaldos y recuperación

- **Desde el panel:** Ajustes → Respaldo → *Descargar respaldo completo* (JSON con todas las tablas `sms_`, sin secretos; queda registrado en el historial). Sirve como copia y para portabilidad; no hay botón de restauración automática.
- **Respaldo de la base completa:** con la cadena de conexión que Supabase muestra en su panel de base de datos, `pg_dump --schema=public --table='sms_*' "postgresql://…" > respaldo.sql`; para restaurar en otro proyecto: ejecutar primero el SQL del sistema y luego `psql "postgresql://…" < respaldo.sql`.
- Revisa en Supabase qué respaldos automáticos incluye tu plan; este sistema no crea respaldos automáticos propios.
- Guarda los respaldos en un lugar privado: contienen datos personales.

## 17. Consideraciones de seguridad

- El público (rol `anon`) **no puede leer ni escribir ninguna tabla**. Solo puede llamar a 10 funciones: las 5 de los formularios (`sms_public_config`, `sms_register`, `sms_join_waitlist`, `sms_public_slots`, `sms_request_booking`) y las 5 del journal (`sms_access_redeem`, `sms_access_status`, `sms_journal_consent`, `sms_journal_sync`, `sms_journal_inbox`, que exigen la llave del dispositivo). Todas validan en el servidor y nunca devuelven datos de otras personas.
- Anti-spam: campo trampa, tiempo mínimo de llenado, límites de frecuencia (10 envíos / 10 min por IP, 6 / hora por correo, 10 / hora por enlace de seguimiento). La IP se guarda solo como *hash* con sal secreta. Los intentos de inicio de sesión están limitados por Supabase Auth.
- Idempotencia: un doble clic o un reintento de red no duplica registros.
- Duplicados: el correo es único; un formulario público **no sobrescribe** la identidad de una ficha existente (marca "Revisar"). WhatsApp repetido → "Posible duplicado" con opción de fusionar.
- Roles: Dueño y Administrador (todo); Equipo (leads, estudiantes, agenda, tareas, mensajes; sin pagos, ajustes, respaldos ni borrados). Todo se verifica en la base de datos, no ocultando botones.
- Historial inalterable; borrados reales solo de notas y por un administrador. La eliminación de datos personales conserva lo contable sin identificar a la persona.
- XSS: todo el contenido se escapa al pintarlo; los enlaces guardados deben ser `https://`. CSV protegido contra inyección de fórmulas. CSRF no aplica (autenticación por token, no por cookies).
- Consentimiento: privacidad obligatoria, marketing separado y nunca premarcado; compartir el journal es una tercera autorización aparte (se pide en el journal, se puede retirar desde Membership y el retiro también queda registrado). Cada autorización se guarda con versión, fecha y origen.
- Códigos de acceso: se validan en el servidor; cada dispositivo recibe su propia llave aleatoria de 244 bits y en la base solo queda su huella SHA-256 (ni el equipo puede leerla). Límites: 20 intentos cada 10 min por IP y 300 intentos fallidos por hora en total (hay 31⁸ ≈ 850 mil millones de códigos posibles), 240 llamadas por hora por dispositivo. Crear, renovar y revocar: solo Dueño y Administrador; el rol Equipo ve el journal y corrige textos. El código legible lo ve solo el equipo, para reenviarlo.
- SDK cargado con SRI; todas las funciones con `search_path` fijo; vistas con `security_invoker`.

## 18. Limitaciones conocidas

- **Cuentas de estudiante:** no hay en la v1.1 (la especificación lo permite). Formularios y reservas funcionan sin cuenta; un usuario autenticado que no es del equipo no ve ningún dato.
- **Sesiones grupales:** todas las sesiones tienen capacidad 1. Para grupos se necesita un modelo de cupos (pendiente).
- **Mensajes:** se preparan solos, pero se envían con un toque por una persona del equipo hasta conectar un proveedor.
- **Cancelación por la propia persona:** se hace escribiendo por WhatsApp; el equipo la registra en la agenda.
- **Política de privacidad:** borrador para Colombia (Ley 1581 de 2012); debe revisarla un abogado antes del lanzamiento. No es asesoría jurídica.
- **Ruta de 18 pasos:** los pasos 1–11 toman su nombre de `steps/` y `steps/map.txt`; del 12 al 18 quedan "por definir". Descripción, objetivo, recursos y criterios se completan en Ajustes (no se inventaron).
- **Idioma:** español completo; inglés preparado parcialmente en `sistema/i18n.js`.
- **Códigos antiguos (`pg-access.js`):** siguen funcionando igual, pero esos dispositivos no se conectan al panel. Para conectarlos, registra el código en la ficha (Journal → Nuevo código → "Registrar un código que ya existe") o crea uno nuevo, y pide al estudiante que lo escriba en Membership → "Use a different code".
- **Journal:** envía mientras está abierto (el "En línea" tiene un margen de unos 7 minutos). Los datos viven primero en el teléfono del estudiante: si borra el navegador sin haber compartido, el panel no tiene copia. La retroalimentación se escribe en el panel y se lee en el journal; el estudiante no responde desde ahí.
- **Entradas:** se registran solo de quienes aceptaron compartir su journal (así lo dice la política). De quien no comparte ves su acceso y que activó su código, pero no cuándo entra. El tiempo activo es aproximado (el journal da señal cada ~3 min mientras está abierto); una pausa de más de 7 minutos cuenta como otra entrada.
- **Mensajes:** van en una sola dirección (el estudiante responde por WhatsApp con un botón). Aparecen al abrir el journal o al volver a él; si lo tiene abierto, a más tardar en 3 minutos. Con el acceso vencido los sigue recibiendo (útil para renovar); con el código revocado, no.
- **Vencimiento sin conexión:** un dispositivo sin internet conserva el último estado conocido; la fecha de vencimiento se aplica igual, pero una revocación llega en su próxima conexión.

## 19. Costos potenciales

No se asumen precios; verifica en el sitio de cada proveedor antes de decidir.

| Servicio | Situación |
|---|---|
| GitHub Pages | Incluido para repositorios públicos. |
| Supabase | Tiene plan gratuito con límites y planes de pago; revisa límites de base de datos, correos de Auth, respaldos y si tu plan pausa proyectos sin actividad. |
| Correo transaccional (si se automatiza) | Los proveedores suelen tener plan gratuito con límites y planes de pago. |
| WhatsApp Business API (si se automatiza) | Meta cobra por conversación según país y categoría; requiere cuenta verificada. |
| Dominio propio | Pago anual al registrador. |

## 20. Actualizar la aplicación

1. Ejecuta las pruebas (sección 11).
2. Si cambió el SQL, vuelve a ejecutar `001_sistema_estudiantes.sql` en Supabase (es re-ejecutable).
3. Publica los archivos.
4. Si cambias la política de privacidad, sube su versión en **Ajustes → Privacidad** (los consentimientos nuevos quedan con la versión vigente).
5. Si cambias la versión del SDK en `sistema/config.js`, actualiza también `sdkIntegrity` con la huella del archivo nuevo.

---

## Riesgos a resolver antes de guardar datos reales de estudiantes

1. Revisar la política de privacidad con un abogado y confirmar el correo de contacto para derechos.
2. Ejecutar el SQL en Supabase y hacer una prueba completa real: registro, lista, reserva, ingreso al panel con el correo del dueño.
3. Confirmar en Supabase las Redirect URLs y la plantilla del correo con código.
4. Verificar que llegue la IP del visitante a la base (una llamada de prueba a `sms_register` debe generar un `ip_hash` en `sms_consents`); si no llega, siguen activos los límites por correo y por enlace, pero conviene evaluar un CAPTCHA (por ejemplo, Cloudflare Turnstile).
5. Definir dónde y cada cuánto se guardan los respaldos.
6. Confirmar quién más tendrá acceso al panel y con qué rol.
7. Con el SQL v1.2 ejecutado: crear un código de prueba en una ficha, activarlo en tu teléfono, autorizar y comprobar que el avance aparece en la ficha → Journal.

## Estructura

```
../journal.html      Fluency OS del estudiante (envía su avance con autorización)
../pg-access.js      acceso por código del journal y de las lecciones steps/ (servidor + respaldo local)
registro/ lista-de-espera/ reservar/ privacidad/ admin/   páginas
sistema/            configuración, textos (i18n), validación, API, UI, estilos
sistema/admin/      panel: acceso y navegación, formularios, vistas
_sistema/supabase/  001_sistema_estudiantes.sql (instalación y actualización)
_sistema/tests/     pruebas SQL, unitarias y E2E (+ servidor local de pruebas); córrelas con `bash`
.env.example        variables de la pila de pruebas e integraciones futuras (sin secretos)
```
