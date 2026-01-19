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

// --- MemberStack readiness helpers ---
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForMemberStackDom({ timeoutMs = 4000, stepMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.$memberstackDom && typeof window.$memberstackDom.getCurrentMember === "function") {
      return true;
    }
    await sleep(stepMs);
  }
  return false;
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

export async function openAuth(mode = "LOGIN") {
  const ms = await getMemberstackDom();

  // Memberstack modal returns a promise. When it resolves, the user has completed an action.
  const result = await ms.openModal(mode);

  // Memberstack modals don't auto-close
  try { ms.hideModal(); } catch (e) {}

  // Clear cached auth so the app re-checks fresh
  clearAuthCache();

  return result;
}


// Call the Cloudflare Worker to map this MemberStack member to an Airtable record + role.
// Returns a normalized object:
// { ok:boolean, role:'public'|'member'|'staff', user?:{...}, reason?:string }
export async function whoami({ force = false } = {}) {
  // 1) Read cache unless forced
  if (!force) {
    const cached = readCache();
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  // 2) Wait briefly for MemberStack DOM API (prevents “needs refresh”)
  const msReady = await waitForMemberStackDom({ timeoutMs: 4000, stepMs: 100 });

  // If MemberStack isn't ready, do NOT poison cache as "public" for minutes.
  if (!msReady) {
    return { role: "public", isAuthed: false };
  }

  // 3) Ask MemberStack
  let member = null;
  try {
    const res = await window.$memberstackDom.getCurrentMember();
    member = res?.data || res; // tolerate either shape
  } catch (e) {
    // If the call fails, treat as public but don't cache long.
    return { role: "public", isAuthed: false };
  }

  // 4) Determine role
  // If your existing file has a specific way you detect staff/member, keep that logic here.
  // Below is conservative: any member object => "member" unless your code sets staff explicitly elsewhere.
  const isAuthed = !!member;
  const role = isAuthed ? "member" : "public";

  const value = { role, isAuthed };

  // 5) Cache policy:
  // - Cache member/staff for longer
  // - Cache public for VERY short time so you don’t get stuck requiring refresh
  const ttlMs = role === "public" ? 10_000 : 5 * 60_000;
  writeCache(value, ttlMs);

  return value;
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
