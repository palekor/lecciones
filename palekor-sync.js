/* ============================================================
   palekor-sync.js — UNA cuenta para todas las apps de
   palekor.github.io/lecciones (demoney, moneye, journal, wallet…)

   Cómo se usa en cualquier app:
     <script src="palekor-sync.js"></script>
     PalekorSync.ready().then(...)

   La llave de abajo es la PUBLISHABLE key: está diseñada para ir
   dentro del HTML. Lo que protege los datos son las reglas de
   Row Level Security de la base de datos (palekor-schema.sql):
   cada usuario solo puede ver y editar sus propias filas.

   NUNCA pongas aquí la "secret key" (sb_secret_...).
   ============================================================ */
(function (global) {
  "use strict";

  var CONFIG = {
    url: "https://bbrdmddytqvwpbuuaqsc.supabase.co",
    key: "sb_publishable_0rvgSNuKBN-ZTY_Y3n89dg_Kj_FAm4W",
    sdk: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js",
    // Todas las apps del mismo dominio comparten esta sesión:
    // entras una vez y todas te reconocen.
    storageKey: "palekor-auth"
  };

  var client = null, readyP = null, authFns = [], currentUser = null;

  function loadSdk() {
    if (global.supabase && global.supabase.createClient) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = CONFIG.sdk;
      s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error("sdk_no_disponible")); };
      document.head.appendChild(s);
    });
  }

  function ready() {
    if (readyP) return readyP;
    readyP = loadSdk().then(function () {
      client = global.supabase.createClient(CONFIG.url, CONFIG.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,   // el enlace mágico del correo también funciona
          storageKey: CONFIG.storageKey
        }
      });
      client.auth.onAuthStateChange(function (_ev, session) {
        currentUser = session ? session.user : null;
        authFns.forEach(function (f) { try { f(currentUser); } catch (e) { console.error(e); } });
      });
      return client.auth.getSession().then(function (r) {
        currentUser = r && r.data && r.data.session ? r.data.session.user : null;
        return client;
      });
    }).catch(function (e) {
      console.warn("PalekorSync: sin conexión con la nube —", e.message);
      readyP = null;      // se puede reintentar más tarde
      throw e;
    });
    return readyP;
  }

  /* ---------- cuenta ---------- */
  function user() { return currentUser; }
  function onAuth(fn) { authFns.push(fn); }

  // Envía un correo con un código de 6 dígitos (y un enlace mágico)
  function sendCode(email) {
    return ready().then(function (c) {
      return c.auth.signInWithOtp({
        email: String(email || "").trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: location.origin + location.pathname
        }
      });
    }).then(unwrap);
  }

  function verifyCode(email, code) {
    return ready().then(function (c) {
      return c.auth.verifyOtp({
        email: String(email || "").trim().toLowerCase(),
        token: String(code || "").replace(/\D/g, ""),
        type: "email"
      });
    }).then(unwrap).then(function (d) {
      currentUser = d && d.user ? d.user : currentUser;
      return currentUser;
    });
  }

  function signOut() {
    return ready().then(function (c) { return c.auth.signOut(); }).then(function () {
      currentUser = null;
    });
  }

  /* ---------- datos ---------- */
  // Trae todas las filas de una app → { key: { data, updated_at } }
  function pull(app) {
    return ready().then(function (c) {
      if (!currentUser) throw new Error("sin_sesion");
      return c.from("docs").select("key,data,updated_at").eq("app", app);
    }).then(unwrap).then(function (rows) {
      var out = {};
      (rows || []).forEach(function (r) { out[r.key] = { data: r.data, updated_at: r.updated_at }; });
      return out;
    });
  }

  // Guarda un bloque FUSIONÁNDOLO en el servidor de forma atómica.
  // Devuelve el resultado combinado (incluye lo de otros dispositivos).
  // Es lo que deben usar las apps: dos dispositivos guardando a la vez
  // nunca se pisan.
  function merge(app, key, data) {
    return ready().then(function (c) {
      if (!currentUser) throw new Error("sin_sesion");
      return c.rpc("docs_merge", { p_app: app, p_key: key, p_data: data });
    }).then(unwrap);
  }

  // Reemplaza un bloque completo (sin fusionar). Úsalo solo para datos
  // que un único dispositivo escribe.
  function push(app, key, data) {
    return ready().then(function (c) {
      if (!currentUser) throw new Error("sin_sesion");
      return c.from("docs").upsert(
        { user_id: currentUser.id, app: app, key: key, data: data },
        { onConflict: "user_id,app,key" }
      );
    }).then(unwrap);
  }

  function unwrap(r) {
    if (r && r.error) {
      var e = new Error(r.error.message || "error");
      e.code = r.error.code || r.error.status;
      throw e;
    }
    return r ? r.data : null;
  }

  /* ============================================================
     Fusión — genérica para cualquier app.
     Una colección es { items: {id: objeto}, tomb: {id: fecha} }.
     Cada objeto lleva "_u" = cuándo se modificó por última vez.
     Gana la versión más reciente de CADA elemento, no del bloque
     completo: si agregas una acción en el celular y una nota en
     el computador, se conservan las dos.
     ============================================================ */
  var TOMB_DAYS = 90;

  function mergeCollection(a, b) {
    a = a || { items: {}, tomb: {} };
    b = b || { items: {}, tomb: {} };
    var tomb = {}, items = {}, id;
    [a.tomb || {}, b.tomb || {}].forEach(function (t) {
      for (id in t) if (!tomb[id] || t[id] > tomb[id]) tomb[id] = t[id];
    });
    [a.items || {}, b.items || {}].forEach(function (src) {
      for (id in src) {
        var x = src[id];
        if (!items[id] || (x._u || 0) > (items[id]._u || 0)) items[id] = x;
      }
    });
    for (id in tomb) {
      if (items[id] && (items[id]._u || 0) <= tomb[id]) delete items[id];
    }
    var cutoff = Date.now() - TOMB_DAYS * 86400000;
    for (id in tomb) if (tomb[id] < cutoff) delete tomb[id];
    return { items: items, tomb: tomb };
  }

  function mergeObject(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (b._u || 0) > (a._u || 0) ? b : a;
  }

  // Huella estable de un objeto, ignorando campos temporales ("_…")
  function fingerprint(o) {
    if (o === null || typeof o !== "object") return JSON.stringify(o);
    if (Array.isArray(o)) return "[" + o.map(fingerprint).join(",") + "]";
    return "{" + Object.keys(o).filter(function (k) { return k.charAt(0) !== "_"; }).sort()
      .map(function (k) { return JSON.stringify(k) + ":" + fingerprint(o[k]); }).join(",") + "}";
  }

  // Copia limpia para subir: sin campos calculados, pero conservando _u
  function clean(o) {
    var out = {};
    for (var k in o) {
      if (k === "_u" || k.charAt(0) !== "_") out[k] = o[k];
    }
    return out;
  }

  global.PalekorSync = {
    config: { url: CONFIG.url },
    ready: ready, user: user, onAuth: onAuth,
    sendCode: sendCode, verifyCode: verifyCode, signOut: signOut,
    pull: pull, merge: merge, push: push,
    mergeCollection: mergeCollection, mergeObject: mergeObject,
    fingerprint: fingerprint, clean: clean
  };
})(window);
