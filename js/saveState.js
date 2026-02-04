/* ============================================================
   saveState.js — Sectioned Planner State (Schedule first)
   ============================================================ */

const SECTIONED_AUTH_BASE = "https://alveary-planning-api-sectioned.kim-b5d.workers.dev/api";
const UI_STORAGE_KEY = "alveary_schedule_ui_v1";
const SECTIONED_STATE_VERSION = 1;

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

/* ============================================================
   MEMBERSTACK HELPERS (minimal – mirrors auth.js approach)
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

  // Worker returns role already lowercased.
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
  // schedule.js persists dropdowns / filters / view toggles here.
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

function mergeScheduleIntoSectionedState(existingState, scheduleUiState, meta = {}) {
  const base =
    existingState && typeof existingState === "object" ? existingState : makeEmptySectionedState();

  normalizeSections(base);
  base.version = base.version || SECTIONED_STATE_VERSION;

  // Only touch the schedule section.
  base.sections.schedule = {
    source: meta.source || "schedule",
    // Store ONLY schedule UI/filter state.
    state: scheduleUiState || {},
  };

  return base;
}

/* ============================================================
   DEV GATE (Developer-only)
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

  const next = mergeScheduleIntoSectionedState(remote.state, localUi, { source: "schedule" });

  // 2) Set merged state
  const saved = await sectionedSetState(next);
  if (!saved?.ok) {
    console.error("Sectioned save failed:", saved);
    setStatus(statusEl, `Save failed (set): ${saved?.reason || "unknown"}`, "error");
    return { ok: false, reason: saved?.reason || "set_failed", detail: saved?.detail };
  }

  // (Display-only timestamp is fine; it is NOT stored in Airtable JSON.)
  setStatus(statusEl, `Saved ✓ (${new Date().toLocaleString()})`, "ok");
  return { ok: true, saved };
}

export async function loadScheduleSectionFromCloud({ statusEl = null } = {}) {
  setStatus(statusEl, "Loading schedule filters from account…");

  const remote = await sectionedGetState();
  if (!remote?.ok) {
    setStatus(statusEl, `Load failed: ${remote?.reason || "unknown"}`, "error");
    return { ok: false, reason: remote?.reason || "get_failed", detail: remote?.detail };
  }

  const schedUi = remote?.state?.sections?.schedule?.state;
  if (!schedUi || typeof schedUi !== "object") {
    setStatus(statusEl, "No saved schedule filters found in account yet.", "warn");
    return { ok: true, empty: true, remote };
  }

  setLocalScheduleState(schedUi);
  setStatus(statusEl, `Loaded ✓ (${new Date().toLocaleString()})`, "ok");
  return { ok: true, remote };
}

/* ============================================================
   WIRING (button hooks)
   ============================================================ */

export async function initScheduleSectionedSave({
  saveBtnId = "scheduleSaveToAccountBtn",
  loadBtnId = "scheduleLoadFromAccountBtn",
  statusId = "scheduleCloudStatus",
  gateStatusId = "scheduleGateStatus",
  devOnly = true,
} = {}) {
  const saveBtn = document.getElementById(saveBtnId);
  const loadBtn = document.getElementById(loadBtnId);
  const statusEl = document.getElementById(statusId);
  const gateEl = document.getElementById(gateStatusId);

  // Gate first
  if (devOnly) {
    const gate = await requireDeveloperForSchedule({
      statusEl: gateEl,
      onDenied: () => {
        if (saveBtn) saveBtn.disabled = true;
        if (loadBtn) loadBtn.disabled = true;
      },
    });

    if (!gate.ok) return gate;
  }

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

  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      loadBtn.disabled = true;
      try {
        await loadScheduleSectionFromCloud({ statusEl });
      } finally {
        loadBtn.disabled = false;
      }
    });
  }

  // Tiny debug surface for testing
  window.SectionedScheduleState = {
    SECTIONED_AUTH_BASE,
    UI_STORAGE_KEY,
    whoami: sectionedWhoami,
    getCloud: sectionedGetState,
    setCloud: sectionedSetState,
    getLocal: getLocalScheduleState,
    setLocal: setLocalScheduleState,
    save: () => saveScheduleSectionToCloud({ statusEl }),
    load: () => loadScheduleSectionFromCloud({ statusEl }),
  };

  return { ok: true };
}
