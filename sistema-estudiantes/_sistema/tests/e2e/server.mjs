// =====================================================================
// Servidor local de pruebas (sin dependencias):
//   /lecciones/*  → archivos estáticos del repositorio completo (como GitHub
//                   Pages): el sistema queda en /lecciones/sistema-estudiantes/
//   /rest/v1/*    → PostgREST (misma API que usa Supabase)
//   /auth/v1/*    → simulador mínimo de Supabase Auth (código 123456)
//   /sdk/supabase.js → SDK local (variable SUPABASE_UMD)
// Uso: JWT_SECRET=... PGRST_URL=http://127.0.0.1:3001 node server.mjs
// =====================================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(process.env.SITE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../.."));
const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.JWT_SECRET;
const PGRST = new URL(process.env.PGRST_URL || "http://127.0.0.1:3001");
const UMD = process.env.SUPABASE_UMD;
const PSQL = ["-h", process.env.PGHOST || "127.0.0.1", "-p", process.env.PGPORT || "54329", "-U", "postgres", "-d", process.env.PGDATABASE || "smstest", "-At", "-c"];

const b64u = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${b64u(crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest())}`;
}
function verify(token) {
  const [h, p, s] = String(token || "").split(".");
  if (!s) return null;
  const good = b64u(crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest());
  if (good !== s) return null;
  const payload = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  return payload.exp && payload.exp * 1000 < Date.now() ? null : payload;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };

function readBody(req) {
  return new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
}
function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(obj === undefined ? "" : JSON.stringify(obj));
}

const refreshTokens = new Map();
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: user.id, role: "authenticated", aud: "authenticated", email: user.email, iat: now, exp: now + 3600 });
  const refresh = crypto.randomBytes(16).toString("hex");
  refreshTokens.set(refresh, user);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user };
}
function userFor(email) {
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) throw new Error("bad email");
  const id = execFileSync("psql", [...PSQL,
    `insert into auth.users(email, email_confirmed_at) values ('${email}', now())
     on conflict (email) do update set email = excluded.email returning id`]).toString().trim().split("\n")[0];
  return { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date().toISOString(),
           app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() };
}

async function auth(req, res, url) {
  const p = url.pathname.replace("/auth/v1", "");
  if (p === "/otp" && req.method === "POST") return json(res, 200, {});
  if (p === "/verify" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (body.token !== "123456") return json(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
    return json(res, 200, session(userFor(String(body.email).toLowerCase())));
  }
  if (p === "/token" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const u = refreshTokens.get(body.refresh_token);
    if (!u) return json(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
    return json(res, 200, session(u));
  }
  if (p === "/user") {
    const claims = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!claims || !claims.email) return json(res, 401, { msg: "invalid token" });
    return json(res, 200, { id: claims.sub, aud: "authenticated", role: "authenticated", email: claims.email,
      email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} });
  }
  if (p === "/logout") { res.writeHead(204); return res.end(); }
  return json(res, 404, { msg: "not found" });
}

function proxy(req, res, url) {
  const headers = { ...req.headers };
  delete headers.host;
  headers["x-forwarded-for"] = req.headers["x-test-ip"] || "127.0.0.1";
  const target = url.pathname.replace("/rest/v1", "") + url.search;
  const preq = http.request({ hostname: PGRST.hostname, port: PGRST.port, path: target, method: req.method, headers }, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  preq.on("error", (e) => json(res, 502, { message: e.message }));
  req.pipe(preq);
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname.replace(/^\/lecciones/, "")) || "/";
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" }); return res.end("404");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/rest/v1")) return proxy(req, res, url);
  if (url.pathname.startsWith("/auth/v1")) return auth(req, res, url);
  if (url.pathname === "/sdk/supabase.js" && UMD) {
    res.writeHead(200, { "content-type": MIME[".js"] });
    return fs.createReadStream(UMD).pipe(res);
  }
  if (url.pathname.startsWith("/lecciones")) return serveStatic(req, res, url);
  res.writeHead(302, { location: "/lecciones/sistema-estudiantes/registro/" }); res.end();
});
server.listen(PORT, "127.0.0.1", () => {
  const anon = sign({ role: "anon", iss: "test", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 30 });
  console.log(`READY http://127.0.0.1:${PORT}/lecciones/sistema-estudiantes/  ANON_KEY=${anon}`);
});
