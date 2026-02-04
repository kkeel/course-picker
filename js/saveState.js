/* ============================================================
   CONFIG -----  saveState.js (SECTIONED MIGRATION STARTER)
   ============================================================ */

const SECTIONED_AUTH_BASE =
  "https://alveary-planning-api-sectioned.kim-b5d.workers.dev/api";

// Local storage key for schedule page state.
// (If your schedule page already uses a different key, change it here.)
const STORAGE_KEY = "alveary_schedule_ui_v1";

// Cloud state schema version for your new sectioned blob (feel free to rename)
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

function nowIso() {
  return new Date().toISOString();
}

function setStatus(el, msg, kind = "") {
  if (!el) return;
  el.textContent = msg || "";
  el.dataset.kind = kind; // optional hook for CSS if you want
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

  // IMPORTANT: Your worker returns role already lowercased.
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
  return res.ok ? json : { ok: false, reason: json?.reason || `http_${res.status}` };
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
  return res.ok ? json : { ok: false, reason: json?.reason || `http_${res.status}` };
}

/* ============================================================
   LOCAL SCHEDULE STATE
   ============================================================ */

export function getLocalScheduleState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return safeParse(raw, null);
}

export function setLocalScheduleState(stateObj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateObj || {}));
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
    updatedAt: nowIso(),
    sections: {
      schedule: null,
      courses: null,
      books: null,
      atAGlance: null,
    },
  };
}

function mergeScheduleIntoSectionedState(existingState, scheduleState, meta = {}) {
  const base =
    existingState && typeof existingState === "object"
      ? existingState
      : makeEmptySectionedState();

  // Normalize structure if older/blank
  if (!base.sections || typeof base.sections !== "object") {
    base.sections = {
      schedule: null,
      courses: null,
      books: null,
      atAGlance: null,
    };
  }

  base.version = base.version || SECTIONED_STATE_VERSION;
  base.updatedAt = nowIso();

  base.sections.schedule = {
    savedAt: nowIso(),
    source: meta.source || "schedule",
    // Put the entire schedule local state here
    state: scheduleState || {},
  };

  return base;
}

/* ============================================================
   DEV GATE (Developer-only)
   ============================================================ */

export async function requireDeveloperForSchedule({
  onDenied = null,
  statusEl = null,
} = {}) {
  setStatus(statusEl, "Checking developer access…");

  const who = await sectionedWhoami();

  // If not logged in, treat as denied
  if (!who.ok) {
    setStatus(statusEl, "Not signed in.", "error");
    if (typeof onDenied === "function") onDenied(who);
    return { ok: false, reason: who.reason || "not_signed_in" };
  }

  // Developer-only
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
  const local = getLocalScheduleState();

  if (!local || typeof local !== "object") {
    setStatus(statusEl, "Nothing to save (no local schedule state).", "warn");
    return { ok: false, reason: "no_local_state" };
  }

  setStatus(statusEl, "Saving schedule to account…");

  // 1) Get existing sectioned state
  const remote = await sectionedGetState();
  if (!remote?.ok) {
    setStatus(statusEl, `Save failed (get): ${remote?.reason || "unknown"}`, "error");
    return { ok: false, reason: remote?.reason || "get_failed" };
  }

  const next = mergeScheduleIntoSectionedState(remote.state, local, { source: "schedule" });

  // 2) Set merged state
  const saved = await sectionedSetState(next);
  if (!saved?.ok) {
    setStatus(statusEl, `Save failed (set): ${saved?.reason || "unknown"}`, "error");
    return { ok: false, reason: saved?.reason || "set_failed" };
  }

  setStatus(statusEl, `Saved ✓ (${new Date().toLocaleString()})`, "ok");
  return { ok: true, saved };
}

export async function loadScheduleSectionFromCloud({ statusEl = null } = {}) {
  setStatus(statusEl, "Loading schedule from account…");

  const remote = await sectionedGetState();
  if (!remote?.ok) {
    setStatus(statusEl, `Load failed: ${remote?.reason || "unknown"}`, "error");
    return { ok: false, reason: remote?.reason || "get_failed" };
  }

  const sched = remote?.state?.sections?.schedule?.state;
  if (!sched || typeof sched !== "object") {
    setStatus(statusEl, "No saved schedule found in account yet.", "warn");
    return { ok: true, empty: true, remote };
  }

  setLocalScheduleState(sched);
  setStatus(statusEl, `Loaded ✓ (${new Date().toLocaleString()})`, "ok");
  return { ok: true, remote };
}

/* ============================================================
   WIRING (button hooks)
   ============================================================ */

/**
 * Call this from schedule.html (after DOM loads).
 *
 * Expected markup (you can rename ids; pass options):
 *  - <button id="scheduleSaveToAccountBtn">Save to Account</button>
 *  - <button id="scheduleLoadFromAccountBtn">Load from Account</button> (optional)
 *  - <span id="scheduleCloudStatus"></span>
 */
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
        // Disable controls if present
        if (saveBtn) saveBtn.disabled = true;
        if (loadBtn) loadBtn.disabled = true;
      },
    });

    if (!gate.ok) return gate;
  }

  // Wire buttons
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
        // Optional: after loading, you may need to refresh the UI.
        // If your schedule page has a known rerender hook, call it here.
        // e.g. window.Schedule?.render?.()
      } finally {
        loadBtn.disabled = false;
      }
    });
  }

  // Expose a tiny debug surface for testing
  window.SectionedScheduleState = {
    SECTIONED_AUTH_BASE,
    STORAGE_KEY,
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
