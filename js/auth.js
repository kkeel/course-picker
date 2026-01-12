// js/auth.js

const WHOAMI_ENDPOINT = "https://alveary-planning-api.kim-b5d.workers.dev/api/whoami";

// Small helper: your HTML hides everything until this becomes 1.
function setAuthReadyCSS(val) {
  try {
    document.documentElement.style.setProperty("--auth-ready", val ? "1" : "0");
  } catch (_) {}
}

// Returns { memberstackId, email } when logged in, otherwise null
export async function getCurrentUser() {
  try {
    // Memberstack v2 puts an object on window.$memberstackDom
    const ms = window.$memberstackDom;
    if (!ms?.getCurrentMember) return null;

    const member = await ms.getCurrentMember();
    const data = member?.data;
    if (!data?.id) return null;

    // email can be in different places depending on Memberstack config
    const email =
      data.auth?.email ||
      data.email ||
      member?.email ||
      null;

    return { memberstackId: data.id, email };
  } catch (e) {
    return null;
  }
}

async function whoami(payload) {
  const r = await fetch(WHOAMI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

// Use Memberstack ID first (your Airtable uses that), fallback to email if needed
export async function whoamiByMemberstackId(memberstackId) {
  return whoami({ memberstackId });
}
export async function whoamiByEmail(email) {
  return whoami({ email });
}

// This runs once at boot (and you can call it later).
// Always sets --auth-ready to 1 so public pages don’t stay blank.
export async function refreshAuth() {
  try {
    const user = await getCurrentUser();

    let result = { ok: false, role: "anonymous", user: null };

    if (user?.memberstackId) {
      result = await whoamiByMemberstackId(user.memberstackId);
    } else if (user?.email) {
      result = await whoamiByEmail(user.email);
    }

    // Normalize a bit
    const ok = !!result?.ok;
    const role = result?.role || (ok ? "member" : "anonymous");

    window.__auth = { ok, role, user: result?.user || null };

    // IMPORTANT: reveal the page once auth check is done (even if anonymous)
    setAuthReadyCSS(true);

    return window.__auth;
  } catch (e) {
    window.__auth = { ok: false, role: "anonymous", user: null };
    setAuthReadyCSS(true); // still reveal so public pages work
    return window.__auth;
  }
}

// Patches a planner factory so Alpine always has stable auth fields.
export function patchPlannerFactory(factoryName) {
  const original = window[factoryName];
  if (typeof original !== "function") return;

  window[factoryName] = function patchedFactory(...args) {
    const base = original(...args) || {};

    // Stable defaults so Alpine expressions don’t throw
    base.authReady = false;
    base.isStaff = false;
    base.authRole = "anonymous";
    base.authUser = null;

    base.refreshAuth = async () => {
      const a = await refreshAuth();
      base.authReady = true;
      base.isStaff = a.role === "staff";
      base.authRole = a.role;
      base.authUser = a.user;
      return a;
    };

    return base;
  };
}
