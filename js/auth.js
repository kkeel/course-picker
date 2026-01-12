// js/auth.js
// Memberstack client + Airtable role lookup (Cloudflare Worker)

const WHOAMI_URL = "https://alveary-planning-api.kim-b5d.workers.dev/api/whoami";

// Your pages already create/use this global (books.html sets defaults before Alpine)
window.$memberstackDom = window.$memberstackDom || null;

// ---- Core: get current user + role ----
export async function getCurrentUser() {
  try {
    const ms = window.$memberstackDom;
    if (!ms || typeof ms.getCurrentMember !== "function") {
      return { ok: false, role: "anonymous", user: null };
    }

    const member = await ms.getCurrentMember();
    const memberstackId = member?.id;
    if (!memberstackId) return { ok: false, role: "anonymous", user: null };

    const res = await fetch(WHOAMI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberstackId }),
    });

    const data = await res.json().catch(() => ({}));
    return {
      ok: !!data?.ok,
      role: (data?.role || "member"),
      user: data?.user || null,
    };
  } catch (err) {
    console.error("[Auth] getCurrentUser error:", err);
    return { ok: false, role: "anonymous", user: null };
  }
}

// ---- Convenience actions (Memberstack) ----
export async function openLogin() {
  const ms = window.$memberstackDom;
  if (!ms?.openModal) throw new Error("Memberstack not loaded: openModal missing");
  return ms.openModal("LOGIN");
}

export async function openSignup() {
  const ms = window.$memberstackDom;
  if (!ms?.openModal) throw new Error("Memberstack not loaded: openModal missing");
  return ms.openModal("SIGNUP");
}

export async function logout() {
  const ms = window.$memberstackDom;
  if (!ms?.logout) throw new Error("Memberstack not loaded: logout missing");
  return ms.logout();
}

// ---- NEW: functions your index.html already imports ----

// Patches a global factory (ex: window.coursePlanner) so every instance has auth fields immediately.
// Your index.html currently calls: patchPlannerFactory("coursePlanner")
export function patchPlannerFactory(factoryNameOrFn) {
  const name = typeof factoryNameOrFn === "string" ? factoryNameOrFn : null;
  const original =
    typeof factoryNameOrFn === "function"
      ? factoryNameOrFn
      : (name && typeof window[name] === "function" ? window[name] : null);

  if (!original) {
    console.warn("[Auth] patchPlannerFactory: factory not found:", factoryNameOrFn);
    return;
  }

  const patched = function (...args) {
    const base = original(...args);

    // Ensure these ALWAYS exist so Alpine expressions never throw
    if (typeof base.authReady === "undefined") base.authReady = false;
    if (typeof base.authRole === "undefined") base.authRole = "anonymous";
    if (typeof base.authUser === "undefined") base.authUser = null;
    if (typeof base.isStaff === "undefined") base.isStaff = false;

    // Optional listener bucket used by your pages
    base._authListeners = base._authListeners || [];

    // Small helper: refresh and notify
    base.refreshAuth = async () => {
      const result = await refreshAuth(base);
      try {
        base._authListeners.forEach((fn) => {
          try { fn(result); } catch (_) {}
        });
      } catch (_) {}
      return result;
    };

    return base;
  };

  if (name) window[name] = patched;
  return patched;
}

// Refreshes auth on an existing Alpine data object (planner)
export async function refreshAuth(base) {
  const auth = await getCurrentUser();

  base.authReady = true;
  base.authRole = auth.role || "anonymous";
  base.authUser = auth.user || null;
  base.isStaff = (base.authRole || "").toLowerCase() === "staff";

  // Keep your “safe globals” in sync if you’re using them anywhere
  window.isStaff = !!base.isStaff;
  window.authRole = base.authRole;
  window.authReady = !!base.authReady;

  return auth;
}
