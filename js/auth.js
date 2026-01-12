// js/auth.js
// Memberstack v2 + Cloudflare Worker whoami endpoint
// Returns a normalized user object (or null) used by index.html / books.html wrappers.

const AUTH_API_URL = "https://alveary-planning-api.kim-b5d.workers.dev/api/whoami";

// Turn OFF for launch
const AUTH_DEV_MODE = false;

// Optional: allowlist roles that can use the app
const ALLOWED_ROLES = new Set(["staff", "member"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForMemberstack(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.$memberstackDom && typeof window.$memberstackDom.getCurrentMember === "function") {
      return window.$memberstackDom;
    }
    await sleep(100);
  }
  return null;
}

async function openLoginModal() {
  const ms = await waitForMemberstack(5000);
  if (!ms) return;

  // Memberstack v2 supports openModal in most setups.
  // If openModal isn't available, the site may be configured for redirects instead.
  if (typeof ms.openModal === "function") {
    try {
      await ms.openModal("LOGIN");
    } catch (e) {
      // ignore
    }
  }
}

async function getMemberstackIdentity() {
  const ms = await waitForMemberstack(15000);
  if (!ms) return null;

  const { data } = await ms.getCurrentMember();
  if (!data) return null;

  return {
    memberstackId: data.id || null,
    email: (data.email || "").trim() || null,
  };
}

async function whoami(payload) {
  const res = await fetch(AUTH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Normalize failures
  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch (e) {}
    return { ok: false, status: res.status, detail: text };
  }

  return res.json();
}

function normalizeUser(apiJson, identity) {
  const role = (apiJson?.role || "").toLowerCase();
  return {
    ok: true,
    role,
    memberstackId: identity?.memberstackId || null,
    email: apiJson?.user?.email || identity?.email || null,
    firstName: apiJson?.user?.firstName || null,
    lastName: apiJson?.user?.lastName || null,
    plannerId: apiJson?.user?.plannerId || null,
  };
}

/**
 * Main function used by your pages:
 *   const currentUser = await getCurrentUser();
 *   if (!currentUser) return;
 *   document.documentElement.style.setProperty("--auth-ready", "1");
 *   coursePlanner();
 */
export async function getCurrentUser() {
  // Dev bypass (ONLY for local testing)
  if (AUTH_DEV_MODE) {
    return {
      ok: true,
      role: "staff",
      memberstackId: "DEV",
      email: "dev@example.com",
      firstName: "Dev",
      lastName: "Mode",
      plannerId: null,
    };
  }

  // 1) Must have Memberstack loaded
  const identity = await getMemberstackIdentity();

  // If not logged in, prompt login and stop boot
  if (!identity || (!identity.memberstackId && !identity.email)) {
    await openLoginModal();
    return null;
  }

  // 2) Prefer Memberstack ID lookup (solves “work email differs from Memberstack email”)
  const payload = identity.memberstackId
    ? { memberstackId: identity.memberstackId }
    : { email: identity.email };

  const apiJson = await whoami(payload);

  if (!apiJson?.ok) {
    // Not allowed / not found / error
    // If 403, treat as unauthorized; if 400+ other, still block app
    console.warn("Auth failed:", apiJson);
    return null;
  }

  const user = normalizeUser(apiJson, identity);

  // 3) Enforce role allowlist
  if (!ALLOWED_ROLES.has(user.role)) {
    console.warn("Role not allowed:", user.role);
    return null;
  }

  return user;
}
