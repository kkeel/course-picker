/* ============================================================
   saveState.js — Sectioned Planner State (Schedule first)
   ============================================================ */

const SECTIONED_AUTH_BASE = "https://alveary-planning-api-sectioned.kim-b5d.workers.dev/api";
const UI_STORAGE_KEY = "alveary_schedule_ui_v1";

const SECTIONED_STATE_VERSION = 1;

// Used only for client-side sync behavior (NOT stored in Airtable JSON)
const LOCAL_LAST_SEEN_CLOUD_KEY = "alveary_schedule_cloud_last_seen_v1";
const SESSION_APPLIED_CLOUD_KEY = "alveary_schedule_cloud_applied_v1";

/* ============================================================
   UTILS
   ============================================================ */

function safeParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function setStatus(el, msg, kind = "") {
  if (!el) return;
  el.textContent = msg || "";
  el.dataset.kind = kind; // optional hook for CSS
}

function parseAirtableLastUpdated(value) {
  // Airtable Last Modified Time often comes as an ISO-ish string.
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : null;
}

function getLocalLastSeenCloud() {
  return parseAirtableLastUpdated(localStorage.getItem(LOCAL_LAST_SEEN_CLOUD_KEY));
}

function setLocalLastSeenCloudFromRemote(remoteLastUpdated) {
  // Store the remote timestamp if available; otherwise store "now".
  const iso =
    typeof remoteLastUpdated === "string" && remoteLastUpdated.trim()
      ? remoteLastUpdated.trim()
      : new Date().toISOString();
  try {
    localStorage.setItem(LOCAL_LAST_SEEN_CLOUD_KEY, iso);
  } catch {}
}

/* ============================================================
   MEMBERSTACK HELPERS (minimal)
   ============================================================ */

async function getMemberstackDom({ timeoutMs = 4000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof window !== "undefined" && window.$memberstackDom) return window.$memberstackDom;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function getCurrentMember() {
  const dom = await getMemberstackDom();
  if (!dom || typeof dom.getCurrentMember !== "function") return null;

  try {
    const res = await dom.getCurrentMember();
    return res?.data || null;
  } catch {
    return null;
  }
}

/* ============================================================
   SECTIONED WORKER CALLS
   ============================================================ */

async function sectionedWhoami() {
  const member = await getCurrentMember();
  if (!member?.id) return { ok: false, role: "public", reason: "no_memberstack_session" };

  const res = await fetch(`${SECTIONED_AUTH_BASE}/whoami`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberstackId: String(member.id) }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    return { ok: false, role: "public", reason: json?.reason || `http_${res.status}` };
  }

  const role = String(json.role || "member").toLowerCase();
  return { ok: true, role, user: json.user || {} };
}

async function sectionedGetState() {
  const member = await getCurrentMember();
  if (!member?.id) return { ok: false, reason: "no_memberstack_session" };

  const res = await fetch(`${SECTIONED_AUTH_BASE}/state/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberstackId: String(member.id) }),
  });

  const json = await res.json().catch(() => ({}));
  return res.ok ? json : { ok: false, reason: json?.reason || `http_${res.status}`, detail: json };
}

async function sectionedSetState(state) {
  const member = await getCurrentMember();
  if (!member?.id) return { ok: false, reason: "no_memberstack_session" };

  const res = await fetch(`${SECTIONED_AUTH_BASE}/state/set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberstackId: String(member.id), state }),
  });

  const json = await res.json().catch(() => ({}));
  return res.ok ? json : { ok: false, reason: json?.reason || `http_${res.status}`, detail: json };
}

/* ============================================================
   LOCAL SCHEDULE STATE (UI/FILTERS ONLY)
   ============================================================ */

export function getLocalScheduleState() {
  return safeParse(localStorage.getItem(UI_STORAGE_KEY) || "", null);
}

export function setLocalScheduleState(uiState) {
  try {
    if (!uiState || typeof uiState !== "object") return false;
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiState));
    return true;
  } catch {
    return false;
  }
}

/* ============================================================
   SECTIONED STATE SHAPE (cloud)
   ============================================================ */

function makeEmptySectionedState() {
  return {
    version: SECTIONED_STATE_VERSION,
    sections: {
      schedule: null,
      courses: null,
      books: null,
      atAGlance: null,
    },
  };
}

function normalizeSections(base) {
  if (!base.sections || typeof base.sections !== "object") {
    base.sections = {
      schedule: null,
      courses: null,
      books: null,
      atAGlance: null,
    };
  }
}

function mergeScheduleIntoSectionedState(existingState, scheduleUiState) {
  const base =
    existingState && typeof existingState === "object" ? existingState : makeEmptySectionedState();

  normalizeSections(base);
  base.version = base.version || SECTIONED_STATE_VERSION;

  // Only touch the schedule section.
  base.sections.schedule = {
    source: "schedule",
    state: scheduleUiState || {},
  };

  return base;
}

/* ============================================================
   DEV GATE (Developer-only while testing)
   ============================================================ */

export async function requireDeveloperForSchedule({ onDenied = null, statusEl = null } = {}) {
  setStatus(statusEl, "Checking developer access…");

  const who = await sectionedWhoami();

  if (!who.ok) {
    setStatus(statusEl, "Not signed in.", "error");
    if (typeof onDenied === "function") onDenied(who);
    return { ok: false, reason: who.reason || "not_signed_in" };
  }

  const role = String(who.role || "").toLowerCase();
  const isDeveloper = role === "developer";

  if (!isDeveloper) {
    setStatus(statusEl, "Developer access required for this page.", "error");
    if (typeof onDenied === "function") onDenied({ ...who, denied: true });
    return { ok: false, reason: "not_developer", role };
  }

  setStatus(statusEl, "Developer access granted.", "ok");
  return { ok: true, role, user: who.user || {} };
}

/* ============================================================
   CLOUD SAVE / LOAD (Schedule section only)
   ============================================================ */

export async function saveScheduleSectionToCloud({ statusEl = null } = {}) {
  const localUi = getLocalScheduleState();

  if (!localUi || typeof localUi !== "object") {
    setStatus(statusEl, "Nothing to save (no local schedule UI state).", "warn");
    return { ok: false, reason: "no_local_ui_state" };
  }

  setStatus(statusEl, "Saving schedule filters to account…");

  // 1) Get existing sectioned state
  const remote = await sectionedGetState();
  if (!remote?.ok) {
    setStatus(statusEl, `Save failed (get): ${remote?.reason || "unknown"}`, "error");
    return { ok: false, reason: remote?.reason || "get_failed", detail: remote?.detail };
  }

  const next = mergeScheduleIntoSectionedState(remote.state, localUi);

  // 2) Set merged state
  const saved = await sectionedSetState(next);
  if (!saved?.ok) {
    console.error("Sectioned save failed:", saved);
    setStatus(statusEl, `Save failed (set): ${saved?.reason || "unknown"}`, "error");
    return { ok: false, reason: saved?.reason || "set_failed", detail: saved?.detail };
  }

  // Update local marker so we don't immediately "pull" over our own changes.
  setLocalLastSeenCloudFromRemote(remote?.lastUpdated || null);

  setStatus(statusEl, `Saved ✓`, "ok");
  return { ok: true, saved };
}

/* ============================================================
   AUTO-SYNC ON LOAD / FOCUS
   ============================================================ */

async function maybeHydrateFromCloud({ statusEl = null, reloadIfApplied = true } = {}) {
  const remote = await sectionedGetState();
  if (!remote?.ok) return { ok: false, reason: remote?.reason || "get_failed" };

  const schedUi = remote?.state?.sections?.schedule?.state;
  if (!schedUi || typeof schedUi !== "object") return { ok: true, empty: true };

  const remoteTs = parseAirtableLastUpdated(remote?.lastUpdated);
  const localTs = getLocalLastSeenCloud();

  // If we can't compare timestamps, be conservative and only apply once per session.
  const appliedMarker = sessionStorage.getItem(SESSION_APPLIED_CLOUD_KEY);

  const shouldApply =
    (remoteTs && (!localTs || remoteTs > localTs)) || (!remoteTs && !appliedMarker);

  if (!shouldApply) return { ok: true, skipped: true };

  setLocalScheduleState(schedUi);
  setLocalLastSeenCloudFromRemote(remote?.lastUpdated || null);

  // Prevent reload loops
  sessionStorage.setItem(SESSION_APPLIED_CLOUD_KEY, String(remote?.lastUpdated || Date.now()));

  if (reloadIfApplied) {
    setStatus(statusEl, "Updated from account — refreshing…", "ok");
    window.location.reload();
  } else {
    setStatus(statusEl, "Updated from account.", "ok");
  }

  return { ok: true, applied: true, remote };
}

/* ============================================================
   WIRING (Schedule page only)
   ============================================================ */

export async function initScheduleSectionedSave({
  saveBtnId = "scheduleSaveToAccountBtn",
  statusId = "scheduleCloudStatus",
  gateStatusId = "scheduleGateStatus",
  devOnly = true,
  autoLoadOnInit = true,
  autoCheckOnFocus = true,
} = {}) {
  const saveBtn = document.getElementById(saveBtnId);
  const statusEl = document.getElementById(statusId);
  const gateEl = document.getElementById(gateStatusId);

  // Gate first
  if (devOnly) {
    const gate = await requireDeveloperForSchedule({
      statusEl: gateEl,
      onDenied: () => {
        if (saveBtn) saveBtn.disabled = true;
      },
    });
    if (!gate.ok) return gate;
  }

  // Auto-load cloud state (so refresh matches Airtable)
  if (autoLoadOnInit) {
    await maybeHydrateFromCloud({ statusEl, reloadIfApplied: true });
  }

  // Wire Save button
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        await saveScheduleSectionToCloud({ statusEl });
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // Check cloud when tab/window regains focus (helps when saving from another device)
  if (autoCheckOnFocus) {
    window.addEventListener("focus", () => {
      maybeHydrateFromCloud({ statusEl, reloadIfApplied: true }).catch(() => {});
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        maybeHydrateFromCloud({ statusEl, reloadIfApplied: true }).catch(() => {});
      }
    });
  }

  // Debug surface
  window.SectionedScheduleState = {
    SECTIONED_AUTH_BASE,
    UI_STORAGE_KEY,
    whoami: sectionedWhoami,
    getCloud: sectionedGetState,
    setCloud: sectionedSetState,
    getLocal: getLocalScheduleState,
    setLocal: setLocalScheduleState,
    save: () => saveScheduleSectionToCloud({ statusEl }),
  };

  return { ok: true };
}
