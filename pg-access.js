/*! ProfGermandario · Access layer · pg-access.js
 * One file decides who sees what — in journal.html and in every lesson page.
 *
 * ADD CODES ─ Open journal.html › Toolbox › Teacher console › Create codes.
 *             Copy the lines it gives you, paste them inside CODES (below the
 *             marker line) and commit. Codes go live about a minute later.
 * REMOVE    ─ Delete the code's line and commit. That student returns to
 *             preview mode on their next visit.
 * EXPIRY    ─ The second value is the last valid day (YYYY-MM-DD). "" = no end.
 *
 * Codes are stored only as slow PBKDF2 hashes: nobody can read or rebuild a
 * code from this file. This is a front-end lock — it separates members from
 * spectators; it is not bank-grade security (that needs a server).
 */
(function () {
  "use strict";

  /* ─────────────────────────── REGISTRY ─────────────────────────── */
  var CODES = {
    /* "hash": ["program", "last valid day", "note"], */
    /* ↓↓↓ paste new lines below this one ↓↓↓ */

    /* LEGACY — these two codes were readable in older versions of journal.html.
       Delete both lines once your students are using personal codes. */
    "76fec40ce5565fb429a9cf42073b804c61580dabb0b3d107ac6367fa73aa6113": ["companion", "", "Legacy companion code"],
    "631c4241c6da25c84103470352a93f89c3aec6f2f9659e7541d4d71dd6bebf5a": ["mastery", "", "Legacy mastery code"]
  };

  /* Teacher master code(s). Change it from Teacher console › Settings. */
  var MASTER = [
    "826d24f9891abcac9c023f704bccda57f9c066db79aaacb79a39c6e507fb0aa8"
  ];

  /* ─────────────────────────── SETTINGS ─────────────────────────── */
  var CONFIG = {
    whatsapp: "573197894038",
    journal: "https://palekor.github.io/lecciones/journal.html",
    editUrl: "https://github.com/palekor/lecciones/edit/main/pg-access.js"
  };
  var SALT = "profgermandario/lecciones/v1", ITER = 120000;
  var KEY = "pg_access_v1", PREV = "pg_access_preview";
  var RANK = { spectator: 0, essential: 1, companion: 2, mastery: 3, teacher: 9 };
  var NAMES = { spectator: "Preview", essential: "Essential", companion: "Companion", mastery: "Mastery Program", teacher: "Teacher" };
  var ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; /* no 0/O, 1/I/L */

  /* ─────────────────────────── CORE ─────────────────────────── */
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function write(o) { try { if (o) localStorage.setItem(KEY, JSON.stringify(o)); else localStorage.removeItem(KEY); } catch (e) {} }
  function previewOn() { try { return localStorage.getItem(PREV) === "1"; } catch (e) { return false; } }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function canon(c) { return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function enc(s) { return new TextEncoder().encode(s); }

  function status() {
    var a = read(), base = { tier: "spectator", state: "none", member: false, teacher: false, preview: false, exp: "", since: (a && a.at) || "", tail: (a && a.tail) || "", name: NAMES.spectator, lastTier: "" };
    if (!a || !a.h) return base;
    if (MASTER.indexOf(a.h) >= 0) {
      if (previewOn()) { base.state = "preview"; base.teacher = true; base.preview = true; return base; }
      base.tier = "teacher"; base.state = "active"; base.member = true; base.teacher = true; base.name = NAMES.teacher; return base;
    }
    var e = CODES[a.h];
    if (!e) { base.state = "revoked"; return base; }
    var t = RANK[e[0]] ? e[0] : "essential", x = e[1] || "";
    if (x && x < today()) { base.state = "expired"; base.exp = x; base.lastTier = t; return base; }
    base.tier = t; base.state = "active"; base.member = true; base.exp = x; base.name = NAMES[t];
    return base;
  }

  function cache(s) { var a = read(); if (a) { a.cache = { tier: s.tier, member: s.member, exp: s.exp }; write(a); } }

  function kdf(code) {
    return crypto.subtle.importKey("raw", enc(canon(code)), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc(SALT), iterations: ITER, hash: "SHA-256" }, k, 256);
    }).then(hex);
  }
  function sha(code) { return crypto.subtle.digest("SHA-256", enc(String(code || "").trim().toUpperCase())).then(hex); }

  function redeem(code) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve({ ok: false, reason: "secure" });
    var c = canon(code);
    if (c.length < 6) return Promise.resolve({ ok: false, reason: "short" });
    return Promise.all([kdf(code), sha(code)]).then(function (h) {
      var hit = MASTER.indexOf(h[0]) >= 0 ? h[0] : CODES[h[0]] ? h[0] : CODES[h[1]] ? h[1] : null;
      if (!hit) return { ok: false, reason: "invalid" };
      var e = CODES[hit];
      if (e && e[1] && e[1] < today()) return { ok: false, reason: "expired", exp: e[1] };
      write({ h: hit, at: new Date().toISOString(), tail: c.slice(-4) });
      try { localStorage.removeItem(PREV); } catch (x) {}
      var s = status(); cache(s); emit();
      return { ok: true, status: s };
    });
  }
  function signOut() { write(null); try { localStorage.removeItem(PREV); } catch (e) {} emit(); }
  function setPreview(on) { try { if (on) localStorage.setItem(PREV, "1"); else localStorage.removeItem(PREV); } catch (e) {} emit(); }

  function newCode() {
    var r = new Uint32Array(8), s = "";
    crypto.getRandomValues(r);
    for (var i = 0; i < 8; i++) s += ALPHA[r[i] % ALPHA.length];
    return "PG-" + s.slice(0, 4) + "-" + s.slice(4);
  }
  function line(hash, tier, exp, note) {
    return '    "' + hash + '": ["' + tier + '", "' + (exp || "") + '", "' + String(note || "").replace(/["\\]/g, "") + '"],';
  }
  function isLive(hash) { var e = CODES[hash]; return !!e && !(e[1] && e[1] < today()); }
  function inRegistry(hash) { return !!CODES[hash]; }
  function isMaster(hash) { return MASTER.indexOf(hash) >= 0; }
  function waLink(text, number) { return "https://wa.me/" + (number === "" ? "" : (number || CONFIG.whatsapp)) + "?text=" + encodeURIComponent(text); }

  /* ─────────────────────────── EVENTS ─────────────────────────── */
  var root = document.documentElement;
  function paint(s) {
    root.classList.toggle("pg-member", s.member);
    root.classList.toggle("pg-locked", !s.member);
    root.setAttribute("data-pg-tier", s.tier);
  }
  function emit() {
    var s = status(); paint(s);
    if (gateReady) applyGate(s);
    try { window.dispatchEvent(new CustomEvent("pg-access", { detail: s })); } catch (e) {}
  }
  window.addEventListener("storage", function (e) { if (e.key === KEY || e.key === PREV) emit(); });

  /* ─────────────────── LESSON-PAGE GATE (steps/*.html) ───────────────────
     Any element with data-tier="member" is hidden for spectators. A single
     luxury panel replaces the hidden part, with the unlock form inside it. */
  var CSS = [
    "html.pg-locked [data-tier=member]{display:none!important}",
    ".pga-wrap{padding:30px 0 70px}",
    ".pga-card{position:relative;overflow:hidden;width:min(1120px,calc(100% - 32px));margin:auto;border-radius:34px;padding:clamp(26px,5vw,56px);color:#f3ede2;background:radial-gradient(70% 90% at 100% 0%,rgba(214,180,106,.20),transparent 60%),radial-gradient(60% 80% at 0% 100%,rgba(138,118,194,.22),transparent 60%),#16111f;box-shadow:0 34px 90px rgba(22,17,31,.32);font-family:Figtree,system-ui,sans-serif}",
    ".pga-card:before{content:'';position:absolute;inset:10px;border:1px solid rgba(214,180,106,.28);border-radius:26px;pointer-events:none}",
    ".pga-top{display:flex;align-items:center;gap:12px;margin-bottom:22px}",
    ".pga-seal{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;border:1px solid #d6b46a;color:#d6b46a;font:600 15px Fraunces,Georgia,serif;letter-spacing:.04em;flex:none}",
    ".pga-eyebrow{font:500 .68rem/1.3 'DM Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#d6b46a}",
    ".pga-h{font:700 clamp(2rem,5vw,3.6rem)/1.02 Fraunces,Georgia,serif;letter-spacing:-.035em;margin:0 0 14px;max-width:820px}",
    ".pga-h em{font-style:italic;font-weight:500;color:#d6b46a}",
    ".pga-p{color:#cfc7d9;font-size:1.05rem;max-width:640px;margin:0}",
    ".pga-feats{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 26px;padding:0;list-style:none}",
    ".pga-feats li{display:flex;align-items:center;gap:8px;padding:8px 13px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-weight:600;font-size:.88rem}",
    ".pga-feats li:before{content:'';width:12px;height:12px;flex:none;background:#d6b46a;-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-9A1.5 1.5 0 0 1 5.5 10zm2 0h6V7a3 3 0 0 0-6 0z'/%3E%3C/svg%3E\") center/contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-9A1.5 1.5 0 0 1 5.5 10zm2 0h6V7a3 3 0 0 0-6 0z'/%3E%3C/svg%3E\") center/contain no-repeat}",
    ".pga-form{display:flex;gap:10px;flex-wrap:wrap;max-width:560px}",
    ".pga-form input{flex:1;min-width:200px;min-height:56px;border-radius:16px;border:1px solid rgba(214,180,106,.45);background:rgba(255,255,255,.06);color:#fff;padding:0 18px;font:600 1.15rem 'DM Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;outline:none}",
    ".pga-form input::placeholder{color:rgba(243,237,226,.35);letter-spacing:.12em}",
    ".pga-form input:focus{border-color:#d6b46a;box-shadow:0 0 0 4px rgba(214,180,106,.18)}",
    ".pga-form button{min-height:56px;padding:0 26px;border:0;border-radius:999px;background:linear-gradient(135deg,#e6c77f,#c39a4a);color:#1b1307;font-weight:800;font-size:1rem;cursor:pointer;transition:transform .15s}",
    ".pga-form button:hover{transform:translateY(-2px)}.pga-form button[disabled]{opacity:.6;cursor:wait;transform:none}",
    ".pga-msg{min-height:24px;margin:12px 0 0;font-size:.95rem;color:#cfc7d9}.pga-msg.bad{color:#ff9d8a}.pga-msg.ok{color:#8fe0c4}",
    ".pga-alt{display:flex;flex-wrap:wrap;gap:10px 22px;margin-top:18px;font-size:.92rem}",
    ".pga-alt a{color:#d6b46a;font-weight:700;text-decoration:underline;text-underline-offset:3px}",
    ".pga-shake{animation:pgaShake .4s}@keyframes pgaShake{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}",
    ".pga-card.pga-open{animation:pgaFade .6s ease forwards}@keyframes pgaFade{to{opacity:0;transform:scale(.98)}}",
    "a[data-pga-href]{opacity:.55}",
    ".pga-pill{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));z-index:60;display:flex;gap:10px;align-items:center;white-space:nowrap;max-width:calc(100vw - 24px);padding:10px 12px 10px 16px;border-radius:999px;background:#16111f;color:#f3ede2;font:600 13px Figtree,system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);border:1px solid rgba(214,180,106,.4)}",
    ".pga-pill button{border:0;border-radius:999px;padding:7px 12px;background:#d6b46a;color:#1b1307;font-weight:800;cursor:pointer}",
    ".pga-toast{position:fixed;left:50%;top:22px;transform:translate(-50%,-20px);opacity:0;z-index:70;padding:13px 20px;border-radius:999px;background:#16111f;color:#f3ede2;border:1px solid #d6b46a;font:700 14px Figtree,system-ui,sans-serif;transition:all .35s ease;pointer-events:none}",
    ".pga-toast.show{opacity:1;transform:translate(-50%,0)}",
    "@media(max-width:600px){.pga-card{border-radius:24px;width:calc(100% - 24px)}.pga-card:before{border-radius:18px}.pga-form button{width:100%}}"
  ].join("");
  (function injectCSS() {
    var st = document.createElement("style"); st.id = "pga-css"; st.textContent = CSS;
    (document.head || root).appendChild(st);
  })();
  paint(status());

  var gateReady = false, panel = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toastMsg(t) {
    var el = document.querySelector(".pga-toast");
    if (!el) { el = document.createElement("div"); el.className = "pga-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = t; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove("show"); }, 2800);
  }
  function lockedIds() {
    var ids = [];
    document.querySelectorAll("[data-tier=member]").forEach(function (sec) {
      if (sec.id) ids.push(sec.id);
      sec.querySelectorAll("[id]").forEach(function (x) { ids.push(x.id); });
    });
    return ids;
  }
  function featureNames() {
    var ids = lockedIds(), seen = {}, out = [];
    document.querySelectorAll(".nav-shell a[href^='#'], nav a[href^='#']").forEach(function (a) {
      var id = (a.getAttribute("data-pga-href") || a.getAttribute("href")).slice(1), t = a.textContent.trim();
      if (ids.indexOf(id) >= 0 && t && !seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }
  function relinks(locked) {
    var ids = lockedIds();
    document.querySelectorAll("a[href^='#'], a[data-pga-href]").forEach(function (a) {
      if (a.closest(".pga-card")) return;
      var orig = a.getAttribute("data-pga-href");
      if (locked) {
        var id = (a.getAttribute("href") || "").slice(1);
        if (!orig && ids.indexOf(id) >= 0) { a.setAttribute("data-pga-href", "#" + id); a.setAttribute("href", "#pga-lock"); }
      } else if (orig) { a.setAttribute("href", orig); a.removeAttribute("data-pga-href"); }
    });
  }
  function messageFor(s) {
    if (s.state === "expired") return "Your access ended on " + fmt(s.exp) + ". Renew it with ProfGermandario to continue.";
    if (s.state === "revoked") return "The code on this device is no longer active. Enter your current code.";
    return "";
  }
  function fmt(k) { try { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); } catch (e) { return k; } }
  function mountPanel(s) {
    var first = document.querySelector("[data-tier=member]");
    if (!first) return;
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "pga-lock"; panel.className = "pga-wrap";
      first.parentNode.insertBefore(panel, first);
    }
    var feats = featureNames(), lesson = (document.title || "").split("·").slice(0, 2).join("·").trim();
    var wa = waLink("Hola Profe, estoy viendo " + lesson + " y quiero acceso completo al sistema ProfGermandario.");
    panel.innerHTML =
      '<div class="pga-card"><div class="pga-top"><span class="pga-seal">PG</span><span class="pga-eyebrow">Members · The ProfGermandario System</span></div>' +
      '<h2 class="pga-h">You have seen the logic.<br><em>Members train it.</em></h2>' +
      '<p class="pga-p">The rest of this class opens with your access code: voice practice that listens to you, endless random tests, and a progress report you send to your teacher.</p>' +
      (feats.length ? '<ul class="pga-feats">' + feats.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>" : '<div style="height:22px"></div>') +
      '<form class="pga-form" novalidate><label class="sr-only" for="pgaCode" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Access code</label><input id="pgaCode" placeholder="PG-XXXX-XXXX" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" inputmode="text"><button type="submit">Unlock</button></form>' +
      '<p class="pga-msg ' + (messageFor(s) ? "bad" : "") + '" role="status">' + esc(messageFor(s)) + "</p>" +
      '<div class="pga-alt"><a href="' + wa + '" target="_blank" rel="noopener">Request access on WhatsApp</a><a href="' + CONFIG.journal + '#toolbox">Open my Fluency OS</a></div></div>';
    var form = panel.querySelector("form"), input = panel.querySelector("input"), btn = panel.querySelector("button"), msg = panel.querySelector(".pga-msg");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      btn.disabled = true; btn.textContent = "Checking…"; msg.className = "pga-msg"; msg.textContent = "";
      redeem(input.value).then(function (r) {
        btn.disabled = false; btn.textContent = "Unlock";
        if (r.ok) return;
        msg.className = "pga-msg bad";
        msg.textContent = r.reason === "expired" ? "That code ended on " + fmt(r.exp) + "." : r.reason === "secure" ? "Open this page with https to use codes." : r.reason === "short" ? "Type the complete code." : "That code isn't valid. Check it with ProfGermandario.";
        var card = panel.querySelector(".pga-card"); card.classList.remove("pga-shake"); void card.offsetWidth; card.classList.add("pga-shake");
      });
    });
  }
  function unmountPanel(welcome) {
    if (!panel) return;
    var p = panel; panel = null;
    var card = p.querySelector(".pga-card");
    if (welcome && card) {
      card.classList.add("pga-open");
      setTimeout(function () {
        var next = p.nextElementSibling; p.remove();
        if (next && next.scrollIntoView) next.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 550);
    } else p.remove();
  }
  function pill(s) {
    var el = document.querySelector(".pga-pill");
    if (!s.preview) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div"); el.className = "pga-pill";
      el.innerHTML = "<span>Previewing as a spectator</span><button type='button'>Exit preview</button>";
      el.querySelector("button").addEventListener("click", function () { setPreview(false); });
      document.body.appendChild(el);
    }
  }
  var wasMember = null;
  function applyGate(s) {
    if (!document.querySelector("[data-tier=member]")) { pill(s); return; }
    if (s.member) { relinks(false); unmountPanel(wasMember === false); if (wasMember === false) toastMsg("Welcome, " + s.name + " member. Everything is unlocked."); }
    else { relinks(true); mountPanel(s); }
    pill(s); wasMember = s.member;
  }
  function boot() {
    gateReady = true;
    var h = location.hash || "";
    if (/^#code=/i.test(h)) {
      var code = decodeURIComponent(h.slice(6));
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      if (document.querySelector("[data-tier=member]")) {
        applyGate(status());
        redeem(code).then(function (r) { if (!r.ok) { var m = panel && panel.querySelector(".pga-msg"); if (m) { m.className = "pga-msg bad"; m.textContent = r.reason === "expired" ? "That code ended on " + fmt(r.exp) + "." : "That link's code isn't valid."; } } });
        return;
      }
    }
    var s = status(); cache(s); applyGate(s);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  /* ─────────────────────────── PUBLIC API ─────────────────────────── */
  window.PGAccess = {
    status: status, redeem: redeem, signOut: signOut, setPreview: setPreview,
    kdf: kdf, sha: sha, canon: canon, newCode: newCode, line: line,
    isLive: isLive, inRegistry: inRegistry, isMaster: isMaster, waLink: waLink,
    NAMES: NAMES, RANK: RANK, CONFIG: CONFIG, today: today, version: "1.0"
  };
})();
