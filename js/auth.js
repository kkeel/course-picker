// auth.js
// Purpose: unify Memberstack session -> Worker whoami -> global flags + Alpine-friendly wiring.

const WHOAMI_URL = "https://alveary-planning-api.kim-b5d.workers.dev/api/whoami";

// ---------- Memberstack helpers ----------
async function waitForMemberstackDom(maxMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (window.$memberstackDom) return window.$memberstackDom;
    await new Promise(r => setTimeout(r, 50));
  }
  return null;
}

export async function getCurrentUser() {
  const ms = await waitForMemberstackDom(3000);
  if (!ms) return { ok: false, role: "anonymous", user: null, reason: "memberstack_not_ready" };

  try {
    const member = await ms.getCurrentMember();
    if (!member || !member.data || !member.data.id) {
      return { ok: false, role: "anonymous", user: null, reason: "not_logged_in" };
    }
    return { ok: true, role: "member", user: member.data };
  } catch (e) {
    return { ok: false, role: "anonymous", user: null, reason: "memberstack_error", error: String(e) };
  }
}

export async function ensureLogin() {
  const ms = await waitForMemberstackDom(3000);
  if (!ms) return false;
  try {
    await ms.openModal("LOGIN");
    return true;
  } catch {
    return false;
  }
}

export async function logout() {
  const ms = await waitForMemberstackDom(3000);
  if (!ms) return false;
  try {
    await ms.logout();
    return true;
  } catch {
    return false;
  }
}

// ---------- Worker role resolution ----------
async function whoami(memberstackId) {
  const res = await fetch(WHOAMI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberstackId })
  });
  if (!res.ok) {
    return { ok: false, role: "anonymous", user: null, reason: `whoami_http_${res.status}` };
  }
  return res.json();
}

// ---------- Public API used by pages ----------
export async function refreshAuth(opts = {}) {
  const { requireStaff = false } = opts;

  // default global flags (safe even before Alpine initializes)
  window.__auth = { ok: false, role: "anonymous", user: null };
  window.isStaff = false;
  window.isMember = false;
  window.memberstackId = null;

  // 1) Read Memberstack session
  const msUser = await getCurrentUser();
  if (!msUser.ok) {
    // anonymous
    window.__auth = msUser;
    if (requireStaff) {
      // if you want: redirect or show login modal
      // await ensureLogin();
    }
    // mark ready so the page doesn't stay hidden
    document.documentElement.style.setProperty("--auth-ready", 1);
    return window.__auth;
  }

  // 2) Ask Worker who they are + role
  const memberstackId = msUser.user.id;
  window.memberstackId = memberstackId;

  const who = await whoami(memberstackId);

  // Normalize
  const role = who?.role || "member";
  const ok = !!who?.ok;

  window.__auth = { ok, role, user: who?.user || msUser.user };

  window.isStaff = ok && role === "staff";
  window.isMember = ok && (role === "member" || role === "staff");

  // If staff is required and they aren't staff, you can optionally force a login modal:
  if (requireStaff && !window.isStaff) {
    // You can decide later whether to auto-open login or show a message.
    // await ensureLogin();
  }

  document.documentElement.style.setProperty("--auth-ready", 1);
  return window.__auth;
}

/**
 * patchPlannerFactory("coursePlanner")
 * Wraps the page's Alpine factory so auth state becomes part of the Alpine data object.
 */
export function patchPlannerFactory(factoryName) {
  const original = window[factoryName];
  if (typeof original !== "function") {
    console.warn(`[Auth] patchPlannerFactory: window.${factoryName} is not a function`);
    return;
  }

  window[factoryName] = function patchedPlannerFactory(...args) {
    const base = original.apply(this, args) || {};

    // Ensure these exist so x-show bindings never explode
    base.authReady = false;
    base.isStaff = !!window.isStaff;
    base.isMember = !!window.isMember;

    // Helper to refresh auth and update Alpine state
    base.refreshAuth = async (options = {}) => {
      const a = await refreshAuth(options);
      base.authReady = true;
      base.isStaff = !!window.isStaff;
      base.isMember = !!window.isMember;
      return a;
    };

    return base;
  };

  console.log(`[Auth] patched ${factoryName}()`);
}

/**
 * initAuthForPage({ requireStaff, patchFactoryName })
 * This is what your books.html is already trying to import + call.
 */
export async function initAuthForPage(opts = {}) {
  const { requireStaff = false, patchFactoryName = null } = opts;

  if (patchFactoryName) patchPlannerFactory(patchFactoryName);

  // Run immediately (module script runs after HTML parse), then return auth
  const auth = await refreshAuth({ requireStaff });
  return auth;
}
