/* ============================================================
   saveState.js — Sectioned Planner State (Schedule first)
   ============================================================ */

const SECTIONED_AUTH_BASE = "https://alveary-planning-api-sectioned.kim-b5d.workers.dev/api";
const UI_STORAGE_KEY = "alveary_schedule_ui_v1";
// Cards are persisted separately by schedule.js. For cloud saves we store only
// the *user-authored* + *user-placed* data (NOT the full catalog).
const CARDS_STORAGE_KEY = "alveary_schedule_cards_v1";

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

function simpleHash(str) {
  // small non-crypto hash (FNV-1a 32-bit)
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------
// Planner state helpers
// ---------------------------
// app.js stores the global planner state (including student roster) in localStorage
// under PLANNER_STATE_KEY. Schedule rendering depends on that roster existing.
function resolvePlannerKey() {
  // Prefer a globally-exposed key (if app.js sets it), otherwise auto-detect.
  try {
    if (window.PLANNER_STATE_KEY) return window.PLANNER_STATE_KEY;
  } catch {}
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("alveary_planner_")) keys.push(k);
    }
    // Newest-ish key last lexicographically because it embeds a version/date.
    keys.sort();
    return keys.length ? keys[keys.length - 1] : null;
  } catch {
    return null;
  }
}

function getPlannerState() {
  try {
    const key = resolvePlannerKey();
    if (!key) return {};
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setPlannerState(next) {
  try {
    const key = resolvePlannerKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(next || {}));
  } catch {
    // ignore
  }
}

function mergeStudentRosterIntoPlanner(roster) {
  if (!Array.isArray(roster) || roster.length === 0) return;

  const cur = getPlannerState();
  const existing = Array.isArray(cur.students) ? cur.students : [];

  // Merge by id, preferring existing values where present.
  const byId = new Map(existing.map((s) => [s?.id, s]));
  for (const s of roster) {
    if (!s || !s.id) continue;
    if (!byId.has(s.id)) byId.set(s.id, s);
  }

  const merged = Array.from(byId.values()).filter(Boolean);
  setPlannerState({ ...cur, students: merged });
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
   LOCAL SCHEDULE STATE
   - UI/FILTERS live in UI_STORAGE_KEY
   - Scheduled cards/custom cards live in CARDS_STORAGE_KEY
   For cloud saves we *compose* a single object that includes:
     { ui: <uiState>, cards: { placements, instancesById, choices, customTemplatesById } }
   ============================================================ */

function pickCustomTemplates(templatesById) {
  const out = {};
  if (!templatesById || typeof templatesById !== "object") return out;
  for (const [id, tpl] of Object.entries(templatesById)) {
    // Convention used in schedule.js: custom templates are "u:*".
    if (typeof id === "string" && id.startsWith("u:")) out[id] = tpl;
  }
  return out;
}

function readFullCardsState() {
  return safeParse(localStorage.getItem(CARDS_STORAGE_KEY) || "", null);
}

function writeFullCardsState(full) {
  try {
    if (!full || typeof full !== "object") return false;
    localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(full));
    return true;
  } catch {
    return false;
  }
}

export function getLocalScheduleState() {
  const ui = safeParse(localStorage.getItem(UI_STORAGE_KEY) || "", null);
  const fullCards = readFullCardsState();

  // Student roster is global planner state, but schedule needs it to render.
  // Include it as a small snapshot so a new browser/device can restore
  // schedule *and* its student dropdowns.
  const planner = getPlannerState();
  const students = Array.isArray(planner.students) ? planner.students : [];

  const cards = fullCards && typeof fullCards === "object"
    ? {
        // Only persist what we *must* recreate the user's board:
        placements: fullCards.placements || {},
        instancesById: fullCards.instancesById || {},
        choices: fullCards.choices || {},
        customTemplatesById: pickCustomTemplates(fullCards.templatesById),
      }
    : null;

  // Back-compat: if something expects the old shape, it can still read .ui
  // from this object.
  return { ui, cards, students };
}

export function setLocalScheduleState(incoming) {
  try {
    if (!incoming || typeof incoming !== "object") return false;

    // Accept either the new composed object, or the old "ui only" object.
    const uiState = incoming.ui && typeof incoming.ui === "object" ? incoming.ui : incoming;
    const cardsPart = incoming.cards && typeof incoming.cards === "object" ? incoming.cards : null;
    const studentsPart = Array.isArray(incoming.students) ? incoming.students : null;

    // 1) UI
    if (uiState && typeof uiState === "object") {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiState));
    }

    // 2) Cards (merge custom templates into the existing full cards state)
    if (cardsPart) {
      const full = readFullCardsState() || {};
      full.templatesById = full.templatesById && typeof full.templatesById === "object" ? full.templatesById : {};

      if (cardsPart.customTemplatesById && typeof cardsPart.customTemplatesById === "object") {
        for (const [id, tpl] of Object.entries(cardsPart.customTemplatesById)) {
          if (typeof id === "string" && id.startsWith("u:")) full.templatesById[id] = tpl;
        }
      }

      if (cardsPart.instancesById && typeof cardsPart.instancesById === "object") {
        full.instancesById = cardsPart.instancesById;
      }

      if (cardsPart.placements && typeof cardsPart.placements === "object") {
        full.placements = cardsPart.placements;
      }

      if (cardsPart.choices && typeof cardsPart.choices === "object") {
        full.choices = cardsPart.choices;
      }

      writeFullCardsState(full);
    }

    // 3) Students (merge into planner global state)
    if (studentsPart) {
      const planner = getPlannerState();
      const existing = Array.isArray(planner.students) ? planner.students : [];
      const byId = new Map(existing.map((s) => [s && s.id, s]));

      for (const s of studentsPart) {
        if (!s || typeof s !== "object") continue;
        if (!s.id || typeof s.id !== "string") continue;
        // Prefer incoming name/color if present
        const prev = byId.get(s.id) || {};
        byId.set(s.id, {
          ...prev,
          ...s,
          id: s.id,
        });
      }

      planner.students = Array.from(byId.values());
      // Keep cursor if app.js uses it for color assignment
      if (typeof planner.studentColorCursor !== "number") planner.studentColorCursor = 0;
      setPlannerState(planner);
    }

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
  const localSchedule = getLocalScheduleState();

  const hasUi = !!(localSchedule?.ui && typeof localSchedule.ui === "object");
  const hasCards = !!(localSchedule?.cards && typeof localSchedule.cards === "object");

  if (!hasUi && !hasCards) {
    setStatus(statusEl, "Nothing to save (no local schedule state).", "warn");
    return { ok: false, reason: "no_local_schedule_state" };
  }

  setStatus(statusEl, "Saving schedule to account…");

  // 1) Get existing sectioned state
  const remote = await sectionedGetState();
  if (!remote?.ok) {
    setStatus(statusEl, `Save failed (get): ${remote?.reason || "unknown"}`, "error");
    return { ok: false, reason: remote?.reason || "get_failed", detail: remote?.detail };
  }

  const next = mergeScheduleIntoSectionedState(remote.state, localSchedule);

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

  const localUi = getLocalScheduleState();
  const remoteStr = JSON.stringify(schedUi);
  const localStr = JSON.stringify(localUi || null);

  // Prevent reload loops across this session: only apply once per distinct remote payload.
  const remoteKey = String(simpleHash(remoteStr));
  const appliedMarker = sessionStorage.getItem(SESSION_APPLIED_CLOUD_KEY);

  if (appliedMarker === remoteKey) return { ok: true, skipped: true };

  // If identical, just mark as seen and move on.
  if (remoteStr === localStr) {
    sessionStorage.setItem(SESSION_APPLIED_CLOUD_KEY, remoteKey);
    return { ok: true, upToDate: true };
  }

  setLocalScheduleState(schedUi);
  sessionStorage.setItem(SESSION_APPLIED_CLOUD_KEY, remoteKey);

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
