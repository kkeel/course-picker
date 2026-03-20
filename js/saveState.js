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
  try {
    if (window.PLANNER_STATE_KEY) return window.PLANNER_STATE_KEY;
  } catch {}

  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("alveary_planner_")) keys.push(k);
    }
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

function canonicalStudentId(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";

  // already canonical
  if (/^s_\d+(?:_[A-Za-z0-9]+)?$/.test(v)) return v;

  // legacy compact format like s17737722896273df4cefc6225e
  if (/^s[A-Za-z0-9]+$/.test(v)) {
    const body = v.slice(1);
    const digitPrefix = (body.match(/^\d+/) || [""])[0];

    if (digitPrefix.length >= 13) {
      const first = digitPrefix.slice(0, 13);
      const rest = body.slice(13);
      return rest ? `s_${first}_${rest}` : `s_${first}`;
    }

    if (digitPrefix.length > 0) {
      const rest = body.slice(digitPrefix.length);
      return rest ? `s_${digitPrefix}_${rest}` : `s_${digitPrefix}`;
    }
  }

  return v;
}

function canonicalizeStudentRoster(roster) {
  if (!Array.isArray(roster)) return { roster: [], aliasMap: {} };

  const aliasMap = {};
  const byId = new Map();

  for (const s of roster) {
    if (!s) continue;

    const originalId = String(s.id || "").trim();
    const nextId = canonicalStudentId(originalId);
    if (!nextId) continue;

    if (originalId && originalId !== nextId) {
      aliasMap[originalId] = nextId;
    }

    if (!byId.has(nextId)) {
      byId.set(nextId, {
        ...s,
        id: nextId,
      });
    }
  }

  return {
    roster: Array.from(byId.values()),
    aliasMap,
  };
}

function remapStudentId(value, aliasMap) {
  const v = String(value || "").trim();
  if (!v) return "";
  return aliasMap[v] || canonicalStudentId(v);
}

function remapUiStudentIds(ui, aliasMap) {
  if (!ui || typeof ui !== "object") return ui;

  const next = {
    ...ui,
    panels: Array.isArray(ui.panels)
      ? ui.panels.map((p) => ({
          ...p,
          studentId: remapStudentId(p?.studentId, aliasMap),
        }))
      : ui.panels,

    dayViewStudentSlots: Array.isArray(ui.dayViewStudentSlots)
      ? ui.dayViewStudentSlots.map((id) => remapStudentId(id, aliasMap))
      : ui.dayViewStudentSlots,

    activeTargetStudentId: remapStudentId(ui.activeTargetStudentId, aliasMap),
  };

  if (ui.activeTarget && typeof ui.activeTarget === "object") {
    next.activeTarget = {
      ...ui.activeTarget,
      studentId: remapStudentId(ui.activeTarget.studentId, aliasMap),
    };
  }

  return next;
}

function remapCardsStudentIds(cards, aliasMap) {
  if (!cards || typeof cards !== "object") return cards;

  const nextPlacements = {};
  const placements = cards.placements && typeof cards.placements === "object"
    ? cards.placements
    : {};

  for (const [studentId, days] of Object.entries(placements)) {
    const nextStudentId = remapStudentId(studentId, aliasMap);
    if (!nextStudentId) continue;
    nextPlacements[nextStudentId] = days;
  }

  return {
    ...cards,
    placements: nextPlacements,
  };
}

function mergeStudentRosterIntoPlanner(roster) {
  if (!Array.isArray(roster) || roster.length === 0) return;

  const cur = getPlannerState();
  const existing = Array.isArray(cur.students) ? cur.students : [];

  const byId = new Map();

  for (const s of existing) {
    if (!s?.id) continue;
    byId.set(String(s.id), s);
  }

  for (const s of roster) {
    if (!s?.id) continue;
    byId.set(String(s.id), {
      ...(byId.get(String(s.id)) || {}),
      ...s,
    });
  }

  setPlannerState({
    ...cur,
    students: Array.from(byId.values()),
  });
}

function mergePlannerCoreIntoPlanner(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;

  const cur = getPlannerState();
  const next = { ...(cur || {}) };

  if (typeof snapshot.version === "string" && snapshot.version.trim()) {
    next.version = snapshot.version;
  }

  if (snapshot.globalTopicTags && typeof snapshot.globalTopicTags === "object") {
    next.globalTopicTags = snapshot.globalTopicTags;
  }

  if (snapshot.globalTopicNotes && typeof snapshot.globalTopicNotes === "object") {
    next.globalTopicNotes = snapshot.globalTopicNotes;
  }

  if (snapshot.globalTopicStudents && typeof snapshot.globalTopicStudents === "object") {
    next.globalTopicStudents = snapshot.globalTopicStudents;
  }

  if (typeof snapshot.studentColorCursor === "number") {
    next.studentColorCursor = snapshot.studentColorCursor;
  }

  if (snapshot.studentRailCollapsed && typeof snapshot.studentRailCollapsed === "object") {
    next.studentRailCollapsed = snapshot.studentRailCollapsed;
  }

  if (snapshot.courses && typeof snapshot.courses === "object") {
    next.courses = snapshot.courses;
  }

  if (snapshot.topics && typeof snapshot.topics === "object") {
    next.topics = snapshot.topics;
  }

  if (snapshot.extras && typeof snapshot.extras === "object") {
    next.extras = snapshot.extras;
  }

  if (Array.isArray(snapshot.students)) {
    const { roster } = canonicalizeStudentRoster(snapshot.students);
    next.students = roster;
  }

  setPlannerState(next);
  return true;
}

function dispatchPlannerHydrated() {
  try {
    window.dispatchEvent(
      new CustomEvent("planner:hydrated", {
        detail: {
          key: resolvePlannerKey(),
          source: "schedule_sectioned_state",
        },
      })
    );
  } catch {}
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
  try {
    if (window.AlvearyAuth && typeof window.AlvearyAuth.whoami === "function") {
      // Returns {ok:true, user:{...}} or {ok:false,...}
      return await window.AlvearyAuth.whoami({ force: true });
    }
  } catch (err) {
    console.warn("sectionedWhoami via AlvearyAuth failed", err);
  }
  // Fallback: if auth isn't ready yet, treat as not signed in.
  return { ok: false, error: "auth_not_ready" };
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
  const planner = getPlannerState();

  const cards = fullCards && typeof fullCards === "object"
    ? {
        placements: fullCards.placements || {},
        instancesById: fullCards.instancesById || {},
        choices: fullCards.choices || {},
        customTemplatesById: pickCustomTemplates(fullCards.templatesById),
      }
    : null;

  const students = Array.isArray(planner?.students)
    ? planner.students
        .filter((s) => s && s.id)
        .map((s) => ({
          id: canonicalStudentId(s.id),
          name: typeof s.name === "string" ? s.name : "",
          color: typeof s.color === "string" ? s.color : "",
        }))
    : [];

  const plannerCore = planner && typeof planner === "object"
    ? {
        version: typeof planner.version === "string" ? planner.version : "",
        globalTopicTags: planner.globalTopicTags || {},
        globalTopicNotes: planner.globalTopicNotes || {},
        globalTopicStudents: planner.globalTopicStudents || {},
        students,
        studentColorCursor:
          typeof planner.studentColorCursor === "number" ? planner.studentColorCursor : 0,
        studentRailCollapsed: planner.studentRailCollapsed || {},
        courses: planner.courses || {},
        topics: planner.topics || {},
        extras: planner.extras || {},
      }
    : null;

  return { ui, cards, students, plannerCore };
}

export function setLocalScheduleState(incoming) {
  try {
    if (!incoming || typeof incoming !== "object") return false;

    const rawUiState =
      incoming.ui && typeof incoming.ui === "object"
        ? incoming.ui
        : incoming;

    const rawCardsPart =
      incoming.cards && typeof incoming.cards === "object"
        ? incoming.cards
        : null;

    const rawPlannerCore =
      incoming.plannerCore && typeof incoming.plannerCore === "object"
        ? incoming.plannerCore
        : null;

    const rawStudents = Array.isArray(rawPlannerCore?.students)
      ? rawPlannerCore.students
      : (Array.isArray(incoming.students) ? incoming.students : []);

    const { roster, aliasMap } = canonicalizeStudentRoster(rawStudents);

    const uiState = remapUiStudentIds(rawUiState, aliasMap);
    const cardsPart = remapCardsStudentIds(rawCardsPart, aliasMap);

    // 1) Merge full planner snapshot first when available
    if (rawPlannerCore) {
      const plannerCore = {
        ...rawPlannerCore,
        students: roster,
      };
      mergePlannerCoreIntoPlanner(plannerCore);
      dispatchPlannerHydrated();
    } else if (roster.length) {
      mergeStudentRosterIntoPlanner(roster);
      dispatchPlannerHydrated();
    }

    // 2) UI
    if (uiState && typeof uiState === "object") {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiState));
    }

    // 3) Cards
    if (cardsPart) {
      const full = readFullCardsState() || {};
      full.templatesById =
        full.templatesById && typeof full.templatesById === "object"
          ? full.templatesById
          : {};

      if (cardsPart.customTemplatesById && typeof cardsPart.customTemplatesById === "object") {
        for (const [id, tpl] of Object.entries(cardsPart.customTemplatesById)) {
          if (typeof id === "string" && id.startsWith("u:")) {
            full.templatesById[id] = tpl;
          }
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

    return true;
  } catch {
    return false;
  }
}

// =====================================
// Canonical Planner State (read-only v1)
// =====================================

export const CANONICAL_STATE_VERSION = 2;

function deepClone(value) {
  try {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function emptyCanonicalState() {
  return {
    version: CANONICAL_STATE_VERSION,
    shared: {
      students: [],
      studentColorCursor: 0,
      studentRailCollapsed: {},
      globalTopicTags: {},
      globalTopicNotes: {},
      globalTopicStudents: {},
      courses: {},
      topics: {},
      extras: {},
    },
    sections: {
      courses: {},
      books: {},
      schedule: {},
      atAGlance: {},
    },
  };
}

/**
 * Reads the current legacy planner state from local storage.
 * This is the shared cross-page state currently managed by app.js.
 */
export function readLegacyPlannerState() {
  try {
    const planner = getPlannerState();
    return asObject(planner);
  } catch {
    return {};
  }
}

/**
 * Reads the current legacy sectioned state from local storage if present.
 * Right now this is mainly being used by schedule cloud/local sync.
 */
export function readLegacySectionedState() {
  try {
    const raw =
      localStorage.getItem("SECTIONED_PLANNER_STATE") ||
      localStorage.getItem("sectioned_planner_state") ||
      "";

    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return asObject(parsed);
  } catch {
    return {};
  }
}

/**
 * Builds a canonical state object in memory using the current legacy shapes.
 * This is read-only for now. We are NOT writing this shape yet.
 */
export function buildCanonicalPlannerState({
  plannerState,
  sectionedState,
} = {}) {
  const planner = asObject(plannerState || readLegacyPlannerState());
  const sectioned = asObject(sectionedState || readLegacySectionedState());
  const out = emptyCanonicalState();

  // -----------------
  // Shared planner data
  // -----------------
  out.shared.students = deepClone(asArray(planner.students));
  out.shared.studentColorCursor =
    Number.isFinite(Number(planner.studentColorCursor))
      ? Number(planner.studentColorCursor)
      : 0;

  out.shared.studentRailCollapsed = deepClone(asObject(planner.studentRailCollapsed));
  out.shared.globalTopicTags = deepClone(asObject(planner.globalTopicTags));
  out.shared.globalTopicNotes = deepClone(asObject(planner.globalTopicNotes));
  out.shared.globalTopicStudents = deepClone(asObject(planner.globalTopicStudents));
  out.shared.courses = deepClone(asObject(planner.courses));
  out.shared.topics = deepClone(asObject(planner.topics));
  out.shared.extras = deepClone(asObject(planner.extras));

  // -----------------
  // Section data
  // -----------------
  const legacySections = asObject(sectioned.sections);

  out.sections.courses = deepClone(asObject(legacySections.courses));
  out.sections.books = deepClone(asObject(legacySections.books));
  out.sections.schedule = deepClone(asObject(legacySections.schedule));
  out.sections.atAGlance = deepClone(
    asObject(legacySections.atAGlance || legacySections.aag)
  );

  return out;
}

/**
 * Convenience helper used by pages later.
 */
export function loadCanonicalPlannerState() {
  return buildCanonicalPlannerState();
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

async function savePlannerCoreToCloud() {
  try {
    if (!window.AlvearyAuth?.setPlannerState) {
      return { ok: false, reason: "planner_api_unavailable" };
    }

    const planner = getPlannerState();
    if (!planner || typeof planner !== "object") {
      return { ok: false, reason: "no_local_planner_state" };
    }

    const res = await window.AlvearyAuth.setPlannerState(planner);
    return res?.ok ? { ok: true, detail: res } : { ok: false, reason: res?.reason || "planner_set_failed", detail: res };
  } catch (e) {
    console.warn("[planner] Failed to save planner core from schedule save", e);
    return { ok: false, reason: "planner_set_exception", detail: e };
  }
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

  // 1) Save shared planner state too (students, assignments, notes, etc.)
  const plannerSaved = await savePlannerCoreToCloud();
  if (!plannerSaved?.ok) {
    console.warn("[planner] Shared planner save from schedule page failed:", plannerSaved);
  }

  // 2) Get existing sectioned state
  const remote = await sectionedGetState();
  if (!remote?.ok) {
    setStatus(statusEl, `Save failed (get): ${remote?.reason || "unknown"}`, "error");
    return {
      ok: false,
      reason: remote?.reason || "get_failed",
      detail: remote?.detail,
      plannerSaved,
    };
  }

  const next = mergeScheduleIntoSectionedState(remote.state, localSchedule);

  // 3) Set merged sectioned state
  const saved = await sectionedSetState(next);
  if (!saved?.ok) {
    console.error("Sectioned save failed:", saved);
    setStatus(statusEl, `Save failed (set): ${saved?.reason || "unknown"}`, "error");
    return {
      ok: false,
      reason: saved?.reason || "set_failed",
      detail: saved?.detail,
      plannerSaved,
    };
  }

  // Update local marker so we don't immediately "pull" over our own changes.
  setLocalLastSeenCloudFromRemote(remote?.lastUpdated || null);

  if (plannerSaved?.ok) {
    setStatus(statusEl, `Saved ✓`, "ok");
  } else {
    setStatus(statusEl, `Saved schedule ✓ (shared planner save needs follow-up)`, "warn");
  }

  return { ok: true, saved, plannerSaved };
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
  devOnly = false,
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
    initScheduleSectionedSave: (opts) => initScheduleSectionedSave(opts),
  };

  return { ok: true };
}
