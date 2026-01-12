// /js/auth.js
// Uses Memberstack (v2) to detect the logged-in member, then asks our Cloudflare Worker
// who they are in Airtable (role: staff/member).
//
// Worker expects either: { memberstackId: "..." } OR { email: "..." }

const WHOAMI_URL = "https://alveary-planning-api.kim-b5d.workers.dev/api/whoami";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForMemberstack(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.$memberstackDom && typeof window.$memberstackDom.getCurrentMember === "function") {
      return true;
    }
    await sleep(50);
  }
  return false;
}

export async function getCurrentUser() {
  // 1) Wait for Memberstack
  const ok = await waitForMemberstack();
  if (!ok) {
    return { role: "anonymous", error: "memberstack_not_loaded" };
  }

  // 2) Ask Memberstack who is logged in
  let member = null;
  try {
    member = await window.$memberstackDom.getCurrentMember();
  } catch (e) {
    return { role: "anonymous", error: "memberstack_getCurrentMember_failed" };
  }

  const msId = member?.data?.id || null;
  const email = member?.data?.email || null;

  // Not logged in
  if (!msId && !email) {
    return { role: "anonymous" };
  }

  // 3) Ask our API (Cloudflare Worker) for role from Airtable
  const payload = msId ? { memberstackId: msId } : { email };

  try {
    const res = await fetch(WHOAMI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return { role: "anonymous", error: `whoami_http_${res.status}` };
    }

    const out = await res.json();

    if (!out?.ok) {
      return { role: "anonymous", error: out?.reason || "whoami_not_ok" };
    }

    return {
      role: out.role || "member",
      user: out.user || { email: email || null },
      memberstack: { id: msId, email },
    };
  } catch (e) {
    return { role: "anonymous", error: "whoami_fetch_failed" };
  }
}

export async function openLogin() {
  const ok = await waitForMemberstack();
  if (!ok) return false;
  try {
    await window.$memberstackDom.openModal("login");
    return true;
  } catch (e) {
    return false;
  }
}

export async function openSignup() {
  const ok = await waitForMemberstack();
  if (!ok) return false;
  try {
    await window.$memberstackDom.openModal("signup");
    return true;
  } catch (e) {
    return false;
  }
}

export async function logout() {
  const ok = await waitForMemberstack();
  if (!ok) return false;
  try {
    await window.$memberstackDom.logout();
    return true;
  } catch (e) {
    return false;
  }
}
