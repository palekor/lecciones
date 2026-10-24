/* =====================================================================
   Conexión con Supabase (misma base y misma sesión que palekor-sync.js).
   ===================================================================== */
import { CONFIG } from "./config.js";

let clientP = null;

function loadSdk() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CONFIG.sdkUrl;
    s.async = true;
    s.crossOrigin = "anonymous";
    if (CONFIG.sdkIntegrity) s.integrity = CONFIG.sdkIntegrity;
    s.onload = () => resolve();
    s.onerror = () => reject(new ApiError("network", "No se pudo cargar el SDK"));
    document.head.appendChild(s);
  });
}

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    this.details = details;
  }
}

export function client() {
  if (!clientP) {
    clientP = loadSdk().then(() =>
      window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: CONFIG.storageKey
        }
      })
    ).catch((e) => { clientP = null; throw e; });
  }
  return clientP;
}

function wrap(r) {
  if (r && r.error) {
    const e = r.error;
    const msg = String(e.message || "");
    let code = "generic";
    if (e.code === "42501" || /forbidden|permission denied/i.test(msg)) code = "forbidden";
    else if (e.code === "23P01") code = "overlap";
    else if (e.code === "23505") code = "duplicate";
    else if (e.code === "23514") code = "check";
    else if (e.code === "22023") code = "invalid";
    else if (e.code === "P0002") code = "not_found";
    else if (/Failed to fetch|NetworkError|network/i.test(msg)) code = "network";
    throw new ApiError(code, msg, e);
  }
  return r ? r.data : null;
}

export async function rpc(name, args) {
  const c = await client();
  try {
    return wrap(await c.rpc(name, args || {}));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("network", e.message);
  }
}

/** Consulta con el constructor de supabase-js: q(c => c.from("tabla").select()) */
export async function q(build) {
  const c = await client();
  try {
    return wrap(await build(c));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("network", e.message);
  }
}

/* ---------- sesión (panel) ---------- */
export async function currentSession() {
  const c = await client();
  const { data } = await c.auth.getSession();
  return data ? data.session : null;
}

export async function sendLoginCode(email, redirectTo) {
  const c = await client();
  return wrap(await c.auth.signInWithOtp({
    email: String(email || "").trim().toLowerCase(),
    options: { shouldCreateUser: true, emailRedirectTo: redirectTo }
  }));
}

export async function verifyLoginCode(email, code) {
  const c = await client();
  return wrap(await c.auth.verifyOtp({
    email: String(email || "").trim().toLowerCase(),
    token: String(code || "").replace(/\D/g, ""),
    type: "email"
  }));
}

export async function signOut() {
  const c = await client();
  await c.auth.signOut();
}

export async function onAuthChange(fn) {
  const c = await client();
  c.auth.onAuthStateChange((_ev, session) => fn(session));
}
