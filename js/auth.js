// Alveary Planning App — Auth helpers (MemberStack + Cloudflare Worker)
//
// Responsibilities:
// 1) Read MemberStack session on the current origin via window.$memberstackDom
// 2) Call the Cloudflare Worker to map MemberStack -> Airtable -> role
// 3) Provide helpers for "Sign in" UI + caching

export const AUTH_ENDPOINT = "https://alveary-planning-api.kim-b5d.workers.dev/api/whoami";

const CACHE_KEY = "alveary_auth_cache_v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function nowMs() {
  return Date.now();
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (!data.t || (nowMs() - data.t) > CACHE_TTL_MS) return null;
    return data.v || null;
  } catch {
    return null;
  }
}

function writeCache(value) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: nowMs(), v: value }));
  } catch {
    // ignore
  }
}

export function clearAuthCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

// Wait for MemberStack DOM library to exist on this page.
// Returns null if not available (script not included).
export async function getMemberstackDom({ timeoutMs = 4000 } = {}) {
  const start = nowMs();
  while (nowMs() - start < timeoutMs) {
    if (typeof window !== "undefined" && window.$memberstackDom) {
      return window.$memberstackDom;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

export async function getCurrentMember() {
  const dom = await getMemberstackDom();
  if (!dom || typeof dom.getCurrentMember !== "function") return null;

  try {
    const res = await dom.getCurrentMember();
    // MemberStack DOM v1 shape: { data: { id, ... } } or { data: null }
    return res?.data || null;
  } catch {
    return null;
  }
}

// Open the MemberStack modal. Mode is optional; "LOGIN" works for most setups.
export async function openAuth(mode = "LOGIN") {
  const dom = await getMemberstackDom();
  if (!dom) throw new Error("MemberStack DOM not loaded on this page.");

  if (typeof dom.openModal === "function") {
    return dom.openModal(mode);
  }
  throw new Error("MemberStack openModal() not available.");
}

// Call the Cloudflare Worker to map this MemberStack member to an Airtable record + role.
// Returns a normalized object:
// { ok:boolean, role:'public'|'member'|'staff', user?:{...}, reason?:string }
export async function whoami({ force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }

  const member = await getCurrentMember();
  if (!member?.id) {
    const out = { ok: false, role: "public", reason: "no_memberstack_session" };
    writeCache(out);
    return out;
  }

  try {
    const res = await fetch(AUTH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberstackId: String(member.id) }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json?.ok) {
      const out = {
        ok: false,
        role: "public",
        reason: json?.reason || `http_${res.status}`,
      };
      writeCache(out);
      return out;
    }

    const role = String(json.role || "member").toLowerCase();
    const out = {
      ok: true,
      role: role === "staff" ? "staff" : "member",
      user: json.user || {},
    };
    writeCache(out);
    return out;
  } catch (err) {
    const out = { ok: false, role: "public", reason: String(err) };
    writeCache(out);
    return out;
  }
}

// Backwards-compatible export used in your HTML modules (if you still have any)
export async function getCurrentUser(opts = {}) {
  return whoami(opts);
}

// Expose minimal global for Alpine templates
if (typeof window !== "undefined") {
  window.AlvearyAuth = window.AlvearyAuth || {};
  window.AlvearyAuth.openAuth = openAuth;
  window.AlvearyAuth.whoami = whoami;
  window.AlvearyAuth.clearAuthCache = clearAuthCache;
}
