// saveState.js
// Sectioned save/load for planner state (cloud + local)
// V1: schedule section only, safely merges into shared Sectioned_Planner_State_JSON
// Adds a schedule-owned students snapshot so Schedule works even if app.js storage isn’t present
// (we are not replacing app.js everywhere yet — just giving schedule a safe fallback)

const SECTIONED_AUTH_BASE =
  window.SECTIONED_AUTH_BASE || "https://alveary-planning-api-sectioned.kim-b5d.workers.dev/api";

const STORAGE_KEY = "alveary_schedule_ui_v1"; // schedule local UI cache
const CLOUD_CACHE_KEY = "alveary_schedule_cloud_cache_v1"; // keeps last cloud state we loaded

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read member identity from auth.js (Memberstack) OR from the existing auth payload.
 * This must match what your worker expects: { memberstackId, email }
 */
async function getAuthIdentity() {
  // auth.js sets window.AlvearyAuth / window.AlvearyUser (depending on page)
  // We try multiple known shapes so we don’t break if one page differs.

  // 1) If auth.js provides a function, use it.
  if (window.AlvearyAuth?.getIdentity) {
    return await window.AlvearyAuth.getIdentity();
  }

  // 2) If auth.js has already cached identity
  const cached =
    window.AlvearyAuth?.identity ||
    window.AlvearyUser?.identity ||
    window.AlvearyUser ||
    window.user ||
    null;

  const memberstackId =
    cached?.memberstackId ||
    cached?.memberstack_id ||
    cached?.member?.id ||
    cached?.id ||
    null;

  const email = cached?.email || cached?.member?.email || null;

  // 3) Try Memberstack global if present
  const ms = window.MemberStack || window.memberstack || null;
  if ((!memberstackId || !email) && ms?.onReady) {
    try {
      const m = await ms.onReady;
      const mem = await m.getCurrentMember?.();
      const msId = mem?.data?.id || mem?.id || null;
      const msEmail = mem?.data?.email || mem?.email || null;
      return { memberstackId: msId || memberstackId, email: msEmail || email };
    } catch (e) {
      // ignore
    }
  }

  return { memberstackId, email };
}

async function postJson(path, payload) {
  const res = await fetch(`${SECTIONED_AUTH_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  return { res, json };
}

/**
 * Load sectioned state from cloud and cache it locally.
 */
async function loadSectionFromCloud(sectionName) {
  const identity = await getAuthIdentity();

  const { res, json } = await postJson("/state/get", identity);

  if (!res.ok || !json?.ok) {
    return { ok: false, reason: json?.reason || "state_get_failed", detail: json };
  }

  // json.state is the full Sectioned Planner State object
  const cloudState = json.state || null;

  // cache so we can merge without re-fetching each time
  localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(cloudState));

  const section = cloudState?.sections?.[sectionName] || null;

  return {
    ok: true,
    plannerId: json.plannerId,
    state: section?.state || null,
    full: cloudState,
    lastUpdated: json.lastUpdated || null,
  };
}

function getCachedCloudState() {
  const raw = localStorage.getItem(CLOUD_CACHE_KEY);
  return raw ? safeParse(raw) : null;
}

/**
 * Merge schedule section into the full sectioned object without clobbering other sections.
 * Schema:
 * {
 *   version: 1,
 *   sections: {
 *     schedule: { source:'schedule', state: {...} },
 *     courses:  { ... },
 *     books:    { ... },
 *     atAGlance:{ ... }
 *   }
 * }
 */
function mergeSection(fullState, sectionName, sectionState) {
  const base = fullState && typeof fullState === "object" ? fullState : {};
  const version = base.version || 1;
  const sections = base.sections && typeof base.sections === "object" ? base.sections : {};

  return {
    version,
    sections: {
      ...sections,
      [sectionName]: {
        source: sectionName,
        state: sectionState,
      },
    },
  };
}

/**
 * Read schedule local UI from STORAGE_KEY
 */
function getLocalScheduleUi() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? safeParse(raw) : null;
}

/**
 * Save schedule local UI to STORAGE_KEY
 */
function setLocalScheduleUi(nextUi) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUi));
}

/**
 * --- Students snapshot (schedule-owned) ---
 * We are NOT removing app.js storage yet.
 * But schedule must work if the "planner local" keys aren’t present (incognito/new device).
 *
 * Strategy:
 * - On Save: try to read current students from the schedule runtime, fall back to app.js local, then store into sectioned JSON.
 * - On Load: if app.js local has no students, hydrate from sectioned JSON (schedule.students).
 */

// Try to read the students from schedule runtime
function readStudentsFromScheduleRuntime() {
  // schedule.js may store students on Alpine data or on a global helper.
  // We try safe options:
  // 1) window.ScheduleState or similar
  const ss = window.ScheduleState || window.AlvearySchedule || null;
  if (ss?.students && Array.isArray(ss.students)) return ss.students;

  // 2) If schedule uses Alpine store
  try {
    const store = window.Alpine?.store?.("schedule");
    if (store?.students && Array.isArray(store.students)) return store.students;
  } catch {}

  // 3) If schedule exposes a getter
  if (window.getScheduleStudents) {
    try {
      const st = window.getScheduleStudents();
      if (Array.isArray(st)) return st;
    } catch {}
  }

  return null;
}

// Try to read students from app.js local planner state
function readStudentsFromAppLocal() {
  // Your older app uses per-planner keys like "alveary_planner_<PlannerID>" or similar.
  // We’ll scan localStorage for a likely planner key and check known student shapes.

  const keys = Object.keys(localStorage || {});
  const plannerKey =
    keys.find((k) => k.startsWith("alveary_planner_")) ||
    keys.find((k) => k.startsWith("alveary-planner_")) ||
    keys.find((k) => k.includes("planner") && k.includes("alveary")) ||
    null;

  if (!plannerKey) return null;

  const raw = localStorage.getItem(plannerKey);
  const parsed = safeParse(raw);
  if (!parsed) return null;

  // common shapes:
  // - { students: [...] }
  // - { studentList: [...] }
  // - { planner: { students: [...] } }
  const students =
    (Array.isArray(parsed.students) && parsed.students) ||
    (Array.isArray(parsed.studentList) && parsed.studentList) ||
    (Array.isArray(parsed?.planner?.students) && parsed.planner.students) ||
    null;

  return students || null;
}

// Write students into app.js local planner state IF needed (hydration)
function writeStudentsIntoAppLocal(students) {
  if (!Array.isArray(students) || students.length === 0) return false;

  const keys = Object.keys(localStorage || {});
  const plannerKey =
    keys.find((k) => k.startsWith("alveary_planner_")) ||
    keys.find((k) => k.startsWith("alveary-planner_")) ||
    keys.find((k) => k.includes("planner") && k.includes("alveary")) ||
    null;

  if (!plannerKey) return false;

  const raw = localStorage.getItem(plannerKey);
  const parsed = safeParse(raw) || {};

  // Don’t overwrite if it already has students
  if (Array.isArray(parsed.students) && parsed.students.length) return true;

  parsed.students = students;
  localStorage.setItem(plannerKey, JSON.stringify(parsed));
  return true;
}

/**
 * Build the schedule section state we want to store:
 * {
 *   ui: { ...filters/panels/dayview/activeTarget... }   (NO big catalog data)
 *   cards: { placements, instancesById, choices, customTemplatesById }  (these are required)
 *   students: [ { id, name, color }, ... ] (needed for new device/incognito)
 * }
 */
function buildScheduleSectionStateFromRuntime() {
  // schedule.js should expose getters or globals by now.
  // We assume these exist (you already had placements saving):
  const ui = window.getScheduleUiState?.() || null;
  const cards = window.getScheduleCardsState?.() || null;

  // students: runtime > app local > null
  const students = readStudentsFromScheduleRuntime() || readStudentsFromAppLocal() || null;

  return {
    ui: ui || null,
    cards: cards || null,
    students: Array.isArray(students) ? students : null,
  };
}

/**
 * Apply schedule section state into runtime:
 * - hydrate students (so manager + dropdowns work)
 * - apply ui
 * - apply cards
 */
async function applyScheduleSectionStateToRuntime(sectionState) {
  if (!sectionState || typeof sectionState !== "object") return;

  // 1) Students: hydrate app local if missing
  if (Array.isArray(sectionState.students) && sectionState.students.length) {
    writeStudentsIntoAppLocal(sectionState.students);

    // also try to push into schedule runtime if it has a setter
    if (window.setScheduleStudents) {
      try {
        window.setScheduleStudents(sectionState.students);
      } catch {}
    }

    // Alpine store
    try {
      const store = window.Alpine?.store?.("schedule");
      if (store && Array.isArray(store.students) === false) {
        store.students = sectionState.students;
      }
    } catch {}
  }

  // 2) Cards
  if (sectionState.cards && window.applyScheduleCardsState) {
    try {
      window.applyScheduleCardsState(sectionState.cards);
    } catch (e) {
      console.warn("applyScheduleCardsState failed", e);
    }
  }

  // 3) UI filters/panels/etc
  if (sectionState.ui) {
    // Update local cache so refresh uses it even before cloud load finishes
    setLocalScheduleUi(sectionState.ui);

    if (window.applyScheduleUiState) {
      try {
        window.applyScheduleUiState(sectionState.ui);
      } catch (e) {
        console.warn("applyScheduleUiState failed", e);
      }
    }
  }

  // give Alpine a tick
  await sleep(0);
}

/**
 * Save ONLY schedule section to cloud, merging with other sections.
 */
async function saveScheduleSectionToCloud() {
  const identity = await getAuthIdentity();

  // Pull the latest cached cloud state (or load once if none)
  let cached = getCachedCloudState();
  if (!cached) {
    const loaded = await loadSectionFromCloud("schedule");
    cached = loaded.full || null;
  }

  const scheduleState = buildScheduleSectionStateFromRuntime();

  const merged = mergeSection(cached, "schedule", scheduleState);

  const { res, json } = await postJson("/state/set", {
    ...identity,
    state: merged,
  });

  if (!res.ok || !json?.ok) {
    return { ok: false, reason: json?.reason || "state_set_failed", detail: json };
  }

  // Update cache
  localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(merged));

  return { ok: true, plannerId: json.plannerId, updatedAt: json.updatedAt };
}

/**
 * Public init: wire up save button + initial load (cloud -> runtime)
 */
export async function initScheduleSectionedSave({ devOnly = true } = {}) {
  // 1) gate by role if devOnly
  if (devOnly) {
    const identity = await getAuthIdentity();
    const { res, json } = await postJson("/whoami", identity);
    if (!res.ok || !json?.ok) throw new Error(json?.reason || "whoami_failed");

    const role = (json.role || "").toLowerCase();
    const okRole = role === "developer" || role === "staff"; // adjust later
    if (!okRole) throw new Error("not_authorized");
  }

  // 2) Load from cloud
  const loaded = await loadSectionFromCloud("schedule");
  if (loaded.ok && loaded.state) {
    await applyScheduleSectionStateToRuntime(loaded.state);
  }

  // 3) Wire save button
  const btn = document.getElementById("schedule-save-btn");
  const status = document.getElementById("schedule-save-status");

  const setStatus = (txt) => {
    if (status) status.textContent = txt || "";
  };

  if (btn) {
    btn.addEventListener("click", async () => {
      try {
        setStatus("Saving schedule to account…");
        btn.disabled = true;

        const result = await saveScheduleSectionToCloud();
        if (!result.ok) {
          console.error("Save failed", result);
          setStatus(`Save failed (set): ${result.reason}`);
          return;
        }

        setStatus("Saved ✓");
        await sleep(800);
        setStatus("");
      } catch (e) {
        console.error("Save error", e);
        setStatus("Save failed (exception)");
      } finally {
        btn.disabled = false;
      }
    });
  } else {
    console.warn("schedule-save-btn not found");
  }

  // 4) Expose helpers for console testing
  window.SectionedScheduleState = {
    whoami: async () => {
      const identity = await getAuthIdentity();
      const { res, json } = await postJson("/whoami", identity);
      return json;
    },
    getCloud: async () => {
      const loaded = await loadSectionFromCloud("schedule");
      return loaded;
    },
    setCloud: async () => {
      return await saveScheduleSectionToCloud();
    },
    getLocal: () => getLocalScheduleUi(),
  };
}
