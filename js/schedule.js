// schedule.js
// Schedule page UI state (Student View / "track") + persistence
// + Phase 2.5: Card templates + instances + ordered placements + rail + grade-band choice (Picture Study)
(function () {
  // -----------------------------
  // Storage keys
  // -----------------------------
  const UI_STORAGE_KEY = "alveary_schedule_ui_v1";
  const WORKSPACE_H_KEY = "alveary_schedule_workspace_h_v1";
  const CARDS_STORAGE_KEY = "alveary_schedule_cards_v1";
  const MA_COURSES_URL = "data/MA_Courses.json";
  const MA_SCHED_URL = "data/MA_Scheduling.json";

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function loadKey(key) {
    const raw = localStorage.getItem(key);
    return raw ? safeParse(raw) : null;
  }

  function saveKey(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }

  // -----------------------------
  // Day View student column "slots"
  // -----------------------------
  function normalizeDayViewSlots(slots, studentsOrIds) {
    const desired = 5;
    const studentIds = Array.isArray(studentsOrIds)
      ? studentsOrIds
          .map((s) => (typeof s === "string" ? s : s?.id))
          .filter(Boolean)
      : [];

    // If slots are missing, seed from available students.
    // If slots ARE provided (even if blank), respect them (so the user can clear slots to show fewer columns).
    const slotsProvided = Array.isArray(slots);
    const incoming = slotsProvided ? slots.slice(0, desired) : [];
    const cleaned = incoming
      .map((v) => (typeof v === "string" ? v : "").trim())
      .filter(Boolean);

    // Drop invalid ids.
    const valid = cleaned.map((id) => (studentIds.includes(id) ? id : ""));

    // If we have no valid selections yet, only auto-seed when nothing was provided at all.
    // (Keeps Day View usable on first load, but allows clearing later.)
    const hasAny = valid.some(Boolean);
    let seeded = valid;
    if (!slotsProvided && !hasAny && studentIds.length) {
      seeded = studentIds.slice(0, desired);
    }

    // Pad to fixed size.
    while (seeded.length < desired) seeded.push("");

    // If duplicates exist, de-dupe by keeping first occurrence and clearing the rest.
    const seen = new Set();
    seeded = seeded.map((id) => {
      if (!id) return "";
      if (seen.has(id)) return "";
      seen.add(id);
      return id;
    });

    return seeded;
  }

  // -----------------------------
  // Planner state (shared with course list / book list)
  // -----------------------------
  function getPlannerStateKey() {
    // app.js declares PLANNER_STATE_KEY and APP_CACHE_VERSION as top-level consts
    // (not always on window), so use typeof checks.
    try {
      if (typeof PLANNER_STATE_KEY === "string" && PLANNER_STATE_KEY) return PLANNER_STATE_KEY;
    } catch {}
    try {
      if (typeof APP_CACHE_VERSION === "string" && APP_CACHE_VERSION) return `alveary_planner_${APP_CACHE_VERSION}`;
    } catch {}
    return "alveary_planner_v1";
  }

  function loadPlannerState() {
    const key = getPlannerStateKey();
    return loadKey(key) || { students: [], courses: {}, topics: {} };
  }

  function savePlannerState(planner) {
    const key = getPlannerStateKey();
    saveKey(key, planner || {});
  }

  function plannerStudents(planner) {
    const arr = Array.isArray(planner?.students) ? planner.students : [];
    return arr
      .map((s, idx) => ({
        id: s?.id || `S${idx + 1}`,
        name: (s?.name || s?.label || `Student ${idx + 1}`).trim(),
        color: s?.color || s?.hex || s?.colour || null,
      }))
      .filter((s) => s.id && s.name);
  }

  function plannerHasBookmarkedCourse(planner, courseKey) {
    const rec = planner?.courses?.[courseKey];
    return !!(rec && rec.isBookmarked);
  }

  function plannerHasBookmarkedTopic(planner, topicId) {
    const topics = planner?.topics || {};
    for (const k of Object.keys(topics)) {
      if (k.endsWith(`::${topicId}`) && topics[k]?.isBookmarked) return true;
    }
    return false;
  }

  function plannerCourseAssignedToStudent(planner, courseKey, studentId) {
    const rec = planner?.courses?.[courseKey];
    const list = Array.isArray(rec?.students) ? rec.students : [];
    return list.includes(studentId);
  }

  function plannerTopicAssignedToStudent(planner, topicId, studentId) {
    const topics = planner?.topics || {};
    for (const k of Object.keys(topics)) {
      if (!k.endsWith(`::${topicId}`)) continue;
      const list = Array.isArray(topics[k]?.students) ? topics[k].students : [];
      if (list.includes(studentId)) return true;
    }
    return false;
  }

  // -----------------------------
  // UI state (existing)
  // -----------------------------
  function defaultUiState() {
    return {
      view: "track",
      visibleDays: [0, 1, 2, 3, 4],
      panels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" },
      ],
      dayViewPanels: [
        { slot: "D1", dayIdx: 0 }, // Mon
        { slot: "D2", dayIdx: 1 }, // Tue
      ],
      dayViewStudentSlots: ["S1", "S2", "S3", "S4", "S5"],
      // Left rail UI
      railDockOpen: true,
      railTopCollapsed: false,
      railDockCollapsed: false,
      showCompleted: false,
      // Rail filters (affect rail ONLY — never the schedule columns)
      railGradeFilter: "", // "" = all; otherwise "G1".."G12"
      railMyCoursesOnly: false,
      railStudentAssignedOnly: false,

      railSearch: "", // rail title search

      // Rail header "target student" selector (persists across refresh)
      activeTargetStudentId: "S1",
      activeTargetDayIndex: 0,

      // Schedule board card style (Phase 1 persistence only)
      boardAddSymbols: true,
      boardAddTracking: true,
      boardScaleByTime: false,

      expandedMode: false,
    };
  }

  function normalizeUiState(state, allStudentIds) {
    const d = defaultUiState();

    const view = typeof state?.view === "string" ? state.view : d.view;

    let visibleDays = Array.isArray(state?.visibleDays)
      ? state.visibleDays.slice()
      : d.visibleDays.slice();

    visibleDays = visibleDays
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 4);

    if (!visibleDays.length) visibleDays = d.visibleDays.slice();
    visibleDays = Array.from(new Set(visibleDays)).sort((a, b) => a - b);

    
let panels = Array.isArray(state?.panels) ? state.panels.slice() : d.panels.slice();

// Normalize student panels: 1..5 panels, valid studentIds, no duplicates
const maxPanels = 5;
const minPanels = 1;

const defaultPanels = Array.isArray(d.panels) ? d.panels.slice() : [{ slot: "P1", studentId: "S1" }, { slot: "P2", studentId: "S2" }];
const studentIds = (Array.isArray(allStudentIds) && allStudentIds.length) ? allStudentIds.slice() : ["S1","S2","S3","S4","S5"];

panels = panels
  .map((p, idx) => {
    const slot = p?.slot || `P${idx + 1}`;
    let studentId = p?.studentId || studentIds[idx] || studentIds[0] || "S1";

    if (!studentIds.includes(studentId)) {
      studentId = studentIds[idx] || studentIds[0] || "S1";
    }

    return { slot, studentId };
  })
  .slice(0, maxPanels);

// Ensure at least one panel; default remains 2-panels for first-time users
if (panels.length < minPanels) panels = defaultPanels.slice();

// Re-slot sequentially (P1..Pn) so saved states stay predictable
panels = panels.map((p, idx) => ({ ...p, slot: `P${idx + 1}` }));

// De-dupe studentIds across panels
const used = new Set();
panels = panels.map((p) => {
  if (!p.studentId || used.has(p.studentId)) {
    const nextId = studentIds.find((id) => !used.has(id)) || studentIds[0] || "S1";
    used.add(nextId);
    return { ...p, studentId: nextId };
  }
  used.add(p.studentId);
  return p;
});

    const railTopCollapsed = typeof state?.railTopCollapsed === 'boolean' ? state.railTopCollapsed : d.railTopCollapsed;
    const showCompleted = typeof state?.showCompleted === 'boolean' ? state.showCompleted : d.showCompleted;
    const railDockOpen = typeof state?.railDockOpen === "boolean" ? state.railDockOpen : d.railDockOpen;

    // Rail filters (rail ONLY)
    const railGradeFilterRaw = typeof state?.railGradeFilter === 'string' ? state.railGradeFilter : d.railGradeFilter;
    const railGradeFilter = (/^G([1-9]|1[0-2])$/).test(railGradeFilterRaw) ? railGradeFilterRaw : "";
    const railMyCoursesOnly = typeof state?.railMyCoursesOnly === 'boolean' ? state.railMyCoursesOnly : d.railMyCoursesOnly;
    const railStudentAssignedOnly = typeof state?.railStudentAssignedOnly === 'boolean' ? state.railStudentAssignedOnly : d.railStudentAssignedOnly;

    // -----------------------------
    // Day View state
    const railSearch = typeof state?.railSearch === "string" ? state.railSearch : (d.railSearch || "");

    // -----------------------------
    // Expanded View state
    const expandedMode = (typeof state?.expandedMode === "boolean") ? state.expandedMode : !!d.expandedMode;

    // -----------------------------
    // Schedule board card style (Phase 1 persistence only)
    // -----------------------------
    const boardAddSymbols = typeof state?.boardAddSymbols === "boolean" ? state.boardAddSymbols : !!d.boardAddSymbols;
    const boardAddTracking = typeof state?.boardAddTracking === "boolean" ? state.boardAddTracking : !!d.boardAddTracking;
    const boardScaleByTime = typeof state?.boardScaleByTime === "boolean" ? state.boardScaleByTime : !!d.boardScaleByTime;


    // -----------------------------
    // Day View state
    // -----------------------------
    
let dayViewPanels = Array.isArray(state?.dayViewPanels)
  ? state.dayViewPanels.slice()
  : (Array.isArray(d.dayViewPanels) ? d.dayViewPanels.slice() : []);

// Normalize day panels: 1..5 panels, dayIdx in 0..4, no duplicates
const maxDayPanels = 5;
const minDayPanels = 1;

dayViewPanels = dayViewPanels
  .map((p, idx) => {
    const slot = p?.slot || `D${idx + 1}`;
    let dayIdx = Number(p?.dayIdx);
    if (!Number.isInteger(dayIdx) || dayIdx < 0 || dayIdx > 4) dayIdx = idx % 5;
    return { slot, dayIdx };
  })
  .slice(0, maxDayPanels);

if (dayViewPanels.length < minDayPanels) {
  dayViewPanels = [{ slot: "D1", dayIdx: 0 }, { slot: "D2", dayIdx: 1 }];
}

// Re-slot sequentially (D1..Dn)
dayViewPanels = dayViewPanels.map((p, idx) => ({ ...p, slot: `D${idx + 1}` }));

// De-dupe days
const usedDays = new Set();
dayViewPanels = dayViewPanels.map((p) => {
  if (!Number.isInteger(p.dayIdx) || usedDays.has(p.dayIdx)) {
    const nextDay = [0,1,2,3,4].find((d) => !usedDays.has(d)) ?? 0;
    usedDays.add(nextDay);
    return { ...p, dayIdx: nextDay };
  }
  usedDays.add(p.dayIdx);
  return p;
});

    const dayViewStudentSlots = normalizeDayViewSlots(state?.dayViewStudentSlots, allStudentIds);
// -----------------------------
// Rail "Add target" (student/day)
// -----------------------------
let activeTargetStudentId = "";
if (typeof state?.activeTargetStudentId === "string") activeTargetStudentId = state.activeTargetStudentId;
if (!activeTargetStudentId && typeof state?.activeTarget?.studentId === "string") activeTargetStudentId = state.activeTarget.studentId;

if (Array.isArray(allStudentIds) && allStudentIds.length) {
  if (!allStudentIds.includes(activeTargetStudentId)) {
    activeTargetStudentId =
      (panels && panels[0] && panels[0].studentId)
        ? panels[0].studentId
        : allStudentIds[0];
  }
}

if (!activeTargetStudentId) {
  activeTargetStudentId = (panels && panels[0] && panels[0].studentId) ? panels[0].studentId : "";
}

let activeTargetDayIndex = Number(state?.activeTargetDayIndex);
if (!Number.isInteger(activeTargetDayIndex)) activeTargetDayIndex = Number(state?.activeTarget?.dayIndex);
if (!Number.isInteger(activeTargetDayIndex) || activeTargetDayIndex < 0 || activeTargetDayIndex > 4) {
  activeTargetDayIndex = Number.isInteger(Number(d.activeTargetDayIndex)) ? Number(d.activeTargetDayIndex) : 0;
}

// Keep day target within visible days (if provided)
if (Array.isArray(visibleDays) && visibleDays.length && !visibleDays.includes(activeTargetDayIndex)) {
  activeTargetDayIndex = visibleDays[0];
}

    return {
      view,
      visibleDays,
      panels,
      dayViewPanels,
      dayViewStudentSlots,
      railTopCollapsed,
      railDockOpen,
      railDockCollapsed: (typeof state?.railDockCollapsed === "boolean")
        ? state.railDockCollapsed
        : d.railDockCollapsed,
      showCompleted,
      railGradeFilter,
      railMyCoursesOnly,
      railStudentAssignedOnly,
      railSearch,

      // Schedule board card style
      boardAddSymbols,
      boardAddTracking,
      boardScaleByTime,

      activeTargetStudentId,
      activeTargetDayIndex,
      
      expandedMode,
    };
  }

  // -----------------------------
  // Cards state (Phase 2.5)
  // -----------------------------
  function defaultCardsState() {
    return {
      // template catalog (official sample + user custom templates)
      templatesById: {},
      // ordered placement per student/day: placements[studentId][dayIndex] = [instanceId...]
      placements: {},
      // all instances by id: instanceId -> { instanceId, templateId, createdAt }
      instancesById: {},
      // preferences/choices that affect which templates are active
      choices: {
        // per-course option selections (scales to multiple “banded” courses)
        courseOptions: {
          "picture-study": "g1-3",
        },
      },
    };
  }

  function uid(prefix = "i") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function pad2(n) {
  const x = Number(n || 0);
  return String(x).padStart(2, "0");
}

  function normGradeList(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .flatMap((x) => String(x ?? "").split(",")) // handles ["G5,"] etc
      .map((s) => s.trim().replace(/^,+/, "").replace(/,+$/, "").trim())
      .filter(Boolean);
  }

  function buildTemplatesFromJson(maCourses, maScheduling) {
  // Flatten courses + topics into lookup maps by Airtable recordID
  const courseByRecord = new Map();
  const topicByRecord = new Map();
  const courseTitleByCourseId = new Map();

  for (const [subject, courseList] of Object.entries(maCourses || {})) {
    for (const c of courseList || []) {
      if (c?.recordID) courseByRecord.set(c.recordID, c);
      if (c?.courseId && c?.title) courseTitleByCourseId.set(c.courseId, c.title);

      for (const t of c?.topics || []) {
        if (t?.recordID) topicByRecord.set(t.recordID, t);
      }
    }
  }

  const templates = {};

  for (const rule of maScheduling || []) {
    const id = rule?.scheduleRecordId;
    if (!id) continue;

    // Resolve the source (course or topic) by Airtable record id
    const sourceId = rule.courseOrTopicId;
    const kind = String(rule.sourceKind || "").toLowerCase();

    const source =
      (kind === "course" ? courseByRecord.get(sourceId) : topicByRecord.get(sourceId)) ||
      courseByRecord.get(sourceId) ||
      topicByRecord.get(sourceId);

    // If we can't resolve the source, skip it for now
    if (!source) continue;

    const isCourse = !!(source.title && source.courseId);
    const sourceKey = isCourse
      ? (source.courseId || source.id || id)
      : (source.Topic_ID || source.Topic_ID_App || source.id || id);

    const parentCourseTitle = courseTitleByCourseId.get(source.courseId) || "";

    const title = isCourse ? source.title : (source.Topic || source.title || "");
    const courseLabel = isCourse ? source.title : (parentCourseTitle || title);

    const weeklyTarget = Number(rule.wk || 0);
    const trackingCount = Number(rule.termTracking || 0);
    const minutes = Number(rule.min || 0);

    // Symbols: keep simple + consistent (we can enhance later)
    const symbols = [
      source.shared ? "↔" : "",
      trackingCount ? "*" : "",
      rule.teach ? "🅃" : "",
    ].filter(Boolean).join(" ");

    const variantSort = Number(rule.variantSort || 0);
    const bandSort = Number(rule.gradeBandSort || 0);

    // Gradeband option: rule.gradeBandKey is a string when applicable
    const bandKey = String(rule.gradeBandKey || "").trim();

    const tpl = {
      id,
      sortKey: `${sourceKey}::${pad2(variantSort || bandSort || 0)}`,
      courseKey: sourceKey,             // used for grouping gradeband choices
      sourceType: isCourse ? "course" : "topic", // for rail filters (my courses / student assigned)
      courseLabel,
      variantKey: String(rule.variantKey || ""),
      variantSort: variantSort || 0,
      title,
      minutes,
      symbols,
      trackingCount,
      weeklyTarget,
      // store gradeFilter for later filtering (grade panel filter)
      gradeFilter: normGradeList(rule.gradeFilter),
    };

    if (bandKey) {
      tpl.meta = {
        choiceGroup: "gradeBand",
        option: bandKey,
        optionLabel: guessBandLabel(bandKey),
      };
    }

    templates[id] = tpl;
  }

  return templates;
}

  
  function guessBandLabel(key) {
    // Examples: "g1-3" -> "1–3", "G1-3" -> "1–3", "g9-12" -> "9–12"
    const s = String(key || "").trim();
    const m = s.match(/(\d+)\s*[-–]\s*(\d+)/i);
    if (m) return `${m[1]}–${m[2]}`;
    const one = s.match(/(\d+)/);
    return one ? one[1] : s;
  }
  
  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
    return await res.json();
  }

  function ensureStudentPlacements(cardsState, studentId) {
    if (!cardsState.placements[studentId]) {
      cardsState.placements[studentId] = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    } else {
      // ensure all days exist
      for (let d = 0; d <= 4; d++) {
        if (!Array.isArray(cardsState.placements[studentId][d])) cardsState.placements[studentId][d] = [];
      }
    }
  }

  // Sample catalog that demonstrates complexity:
  // - multi-rule course (Grammar has two rules)
  // - shared topic duplicates (Church History for Bible G1 vs Bible G2)
  // - grade-band choice (Picture Study)
  function buildSampleTemplates() {
    const t = {};

    // Sort keys: mimic your Course List order keys (string compare works if zero-padded)
    // (These are placeholders; later we’ll pull real sort keys from course JSON.)
    t["a:grammar:ruleA"] = {
      id: "a:grammar:ruleA",
      sortKey: "004.001.010.000::10", // placeholder
      courseKey: "grammar",
      courseLabel: "Grammar",
      variantKey: "20m",
      variantSort: 10,
      title: "Grammar: Grade 5",
      minutes: 20,
      symbols: "* 🅃",
      trackingCount: 12,
      weeklyTarget: 2,
    };

    t["a:grammar:ruleB"] = {
      id: "a:grammar:ruleB",
      sortKey: "004.001.010.000::20",
      courseKey: "grammar",
      courseLabel: "Grammar",
      variantKey: "15m",
      variantSort: 20,
      title: "Grammar: Grade 5",
      minutes: 15,
      symbols: "* 🅃",
      trackingCount: 12,
      weeklyTarget: 3,
    };

    // Shared topic duplicates (two separate instances / contexts)
    t["a:church-history:bible-g1"] = {
      id: "a:church-history:bible-g1",
      sortKey: "004.001.020.000::10",
      courseKey: "bible-g1",
      courseLabel: "Bible: Grade 1",
      variantKey: "church-history",
      variantSort: 10,
      title: "Church History: Grade 1",
      minutes: 20,
      symbols: "↔ * 🅃",
      trackingCount: 12,
      weeklyTarget: 1,
    };

    t["a:church-history:bible-g2"] = {
      id: "a:church-history:bible-g2",
      sortKey: "004.001.021.000::10",
      courseKey: "bible-g2",
      courseLabel: "Bible: Grade 2",
      variantKey: "church-history",
      variantSort: 10,
      title: "Church History: Grade 2",
      minutes: 20,
      symbols: "↔ * 🅃",
      trackingCount: 12,
      weeklyTarget: 1,
    };

    // Break / buffer card (no course source)
    t["a:break:lunch"] = {
      id: "a:break:lunch",
      sortKey: "ZZZ::01",
      courseKey: "break",
      courseLabel: "Breaks",
      variantKey: "lunch",
      variantSort: 1,
      title: "Lunch",
      minutes: 30,
      symbols: "☼",
      trackingCount: 0,
      weeklyTarget: 5,
    };

    // Picture Study grade-band options (choice controls which one is shown as “active”)
    t["a:picture-study:g1-3"] = {
      id: "a:picture-study:g1-3",
      sortKey: "004.001.030.000::10",
      courseKey: "picture-study",
      courseLabel: "Picture Study",
      variantKey: "g1-3",
      variantSort: 10,
      title: "Picture Study: Grades 1–3",
      minutes: 10,
      symbols: "↔ * 🅃",
      trackingCount: 12,
      weeklyTarget: 1,
      meta: {
        choiceGroup: "gradeBand",
        option: "g1-3",
        optionLabel: "1–3",
      },
    };

    t["a:picture-study:g4-6"] = {
      id: "a:picture-study:g4-6",
      sortKey: "004.001.030.000::20",
      courseKey: "picture-study",
      courseLabel: "Picture Study",
      variantKey: "g4-6",
      variantSort: 20,
      title: "Picture Study: Grades 4–6",
      minutes: 15,
      symbols: "↔ * 🅃-",
      trackingCount: 12,
      weeklyTarget: 1,
      meta: {
        choiceGroup: "gradeBand",
        option: "g4-6",
        optionLabel: "4–6",
      },
    };

    t["a:picture-study:g7-8"] = {
      id: "a:picture-study:g7-8",
      sortKey: "004.001.030.000::30",
      courseKey: "picture-study",
      courseLabel: "Picture Study",
      variantKey: "g7-8",
      variantSort: 30,
      title: "Picture Study: Grades 7–8",
      minutes: 20,
      symbols: "↔ * 🅃--",
      trackingCount: 12,
      weeklyTarget: 1,
      meta: {
        choiceGroup: "gradeBand",
        option: "g7-8",
        optionLabel: "7–8",
      },
    };

    t["a:picture-study:g9-12"] = {
      id: "a:picture-study:g9-12",
      sortKey: "004.001.030.000::40",
      courseKey: "picture-study",
      courseLabel: "Picture Study",
      variantKey: "g9-12",
      variantSort: 40,
      title: "Picture Study: Grades 9–12",
      minutes: 20,
      symbols: "↔ * 🅃---",
      trackingCount: 12,
      weeklyTarget: 1,
      meta: {
        choiceGroup: "gradeBand",
        option: "g9-12",
        optionLabel: "9–12",
      },
    };

    return t;
  }

  function normalizeCardsState(raw, allStudentIds) {
    const d = defaultCardsState();
    const state = raw && typeof raw === "object" ? raw : {};

    const templatesById = (state.templatesById && typeof state.templatesById === "object")
      ? state.templatesById
      : {};

    const placements = (state.placements && typeof state.placements === "object")
      ? state.placements
      : {};

    const instancesById = (state.instancesById && typeof state.instancesById === "object")
      ? state.instancesById
      : {};

    const choices = (state.choices && typeof state.choices === "object")
      ? { ...d.choices, ...state.choices }
      : { ...d.choices };

    const next = { templatesById, placements, instancesById, choices };

    // ensure placement buckets for existing students
    (allStudentIds || []).forEach((sid) => ensureStudentPlacements(next, sid));

    return next;
  }

  // -----------------------------
  // Alpine builder
  // -----------------------------
  window.scheduleBuilder = function scheduleBuilder() {
    return {
      // -----------------------------
      // UI state used by schedule.html
      // -----------------------------
      view: "track",
      visibleDays: [0, 1, 2, 3, 4],
      dayLabels: ["Mon","Tue","Wed","Thu","Fri"],

      // -----------------------------
      // Manage students (matches Courses/Books pages)
      // -----------------------------
      studentsOpen: false,
      newStudentName: "",
      dayShortLabels: ["M","T","W","Th","F"],
      dayLongLabels: ["Monday","Tuesday","Wednesday","Thursday","Friday"],

      visibleStudentPanels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" },
      ],

      dayViewPanels: [
        { slot: "D1", dayIdx: 0 },
        { slot: "D2", dayIdx: 1 },
      ],
      dayViewStudentSlots: ["S1", "S2", "S3", "S4", "S5"],
      openDayMenu: null,
      openDayStudentMenu: null,
      // Students (from planner state)
      students: [],

      // Color picker state (matches Course/Book pages)
      colorPickerFor: null,
      studentColorPalette: (typeof buildStudentColorPalette === 'function') ? buildStudentColorPalette() : ["#5b6f5d","#7a4f72","#3f7f8c","#b07234","#5a6fa8","#8a8d3f","#b35b70","#4d8a68","#7c6b55","#3a6b8a","#6c3f7f","#8a5d3f"],

      openStudentMenu: null,
      // -----------------------------
      // Custom Card Modal (Create / Edit / Delete)
      // -----------------------------
      customModalOpen: false,
      customModalMode: "create", // "create" | "edit" | "delete"
      customModalTemplateId: null,
      customForm: { title: "", minutes: 15, weeklyTarget: 1 },
      customModalError: "",

      // -----------------------------
      // Phase 2.5 cards state
      // -----------------------------
      templatesById: {},      // catalog
      instancesById: {},      // instanceId -> instance
      placements: {},         // studentId -> dayIndex -> [instanceId...]
      choices: {
        courseOptions: {
          "picture-study": "g1-3",
        },
      },

      // where “Add” goes (click a column to set target)
      activeTarget: {
        studentId: "S1",
        dayIndex: 0,
      },


      // Single source of truth for rail "target student" selector persistence
      // (UI binds to this; activeTarget stays in sync for existing logic)
      activeTargetStudentId: "S1",
      activeTargetDayIndex: 0,

      // Rail list: show/hide completed cards (per active rail student)
      showCompleted: false,
      railTopCollapsed: false,
      railDockOpen: true,
      railDockCollapsed: false,
      // Rail filters (affect rail ONLY)
      railGradeFilter: "",
      railMyCoursesOnly: false,
      railStudentAssignedOnly: false,
      railSearch: "",

      cardStyleModalOpen: false,
      openCardStyleModal() {
      this.cardStyleModalOpen = true;
        },
        closeCardStyleModal() {
          this.cardStyleModalOpen = false;
        },

      // -----------------------------
      // Expanded Mode
      // -----------------------------
      expandedMode: false,
      boardAddSymbols: true,
      boardAddTracking: true,
      boardScaleByTime: false,

      // Keep rail height matched to the schedule board (NOT the rail list).
      // In Expanded mode we let the board grow to its full content height,
      // then constrain the rail to that same height and scroll its body.
      
syncExpandedHeights() {
  try {
    const root = document.documentElement;

    // Keep separate cached heights per view because Track uses x-if (DOM removed)
    // and Day uses x-show (DOM persists). When switching views, we want BOTH
    // views to keep their own “tallest panel” height.
    if (!this._expandedHeights) this._expandedHeights = { track: 0, day: 0 };

    // Clear when not in expanded mode
    if (!this.expandedMode) {
      root.style.removeProperty("--sched-expanded-h");
      root.style.removeProperty("--sched-expanded-h-track");
      root.style.removeProperty("--sched-expanded-h-day");
      document.querySelectorAll(".schedule-panel-body, .sched-dayview-daybody").forEach((el) => {
        el.style.removeProperty("min-height");
      });
      this._expandedHeights.track = 0;
      this._expandedHeights.day = 0;
      return;
    }

    const measureMaxScrollHeight = (els) => {
  // IMPORTANT: if we have previously applied a min-height, scrollHeight can reflect
  // that forced height. Clear min-height first to measure the *natural* content height,
  // otherwise we can get a feedback loop where the height slowly grows.
  els.forEach((el) => {
    if (!el) return;
    el.style.removeProperty("min-height");
  });

  // Force a reflow so scrollHeight reflects the cleared min-heights
  void root.offsetHeight;

  let maxH = 0;
  els.forEach((el) => {
    const h = el ? (el.scrollHeight || 0) : 0;
    if (h > maxH) maxH = h;
  });
  return maxH;
};

    // 1) Track / Student View (panels use .schedule-panel-body)
    const trackBodies = Array.from(document.querySelectorAll(".schedule-panel-body"))
      .filter((b) => b && b.offsetParent !== null);

    if (trackBodies.length) {
      const maxTrack = measureMaxScrollHeight(trackBodies);
      const hTrack = Math.max(0, maxTrack + 2);
      this._expandedHeights.track = hTrack;
      root.style.setProperty("--sched-expanded-h-track", `${hTrack}px`);
      trackBodies.forEach((b) => {
        b.style.minHeight = `${hTrack}px`;
      });
    }

    // 2) Day View panels (panels use .sched-dayview-daybody)
    const dayBodies = Array.from(document.querySelectorAll(".sched-dayview-daybody"))
      .filter((b) => b && b.offsetParent !== null);

    if (dayBodies.length) {
      const maxDay = measureMaxScrollHeight(dayBodies);
      const hDay = Math.max(0, maxDay + 2);
      this._expandedHeights.day = hDay;
      root.style.setProperty("--sched-expanded-h-day", `${hDay}px`);
      dayBodies.forEach((b) => {
        b.style.minHeight = `${hDay}px`;
      });
    }

    // 3) The overall workspace/rail height should follow the ACTIVE view.
    const active = (this.view === "day") ? this._expandedHeights.day : this._expandedHeights.track;
    if (active && active > 0) {
      root.style.setProperty("--sched-expanded-h", `${active}px`);
    }
  } catch (_) {
    // ignore
  }
}
,
queueExpandedSync() {
  // When switching views Alpine may re-create panel DOM, which clears inline min-heights.
  // Queue the measurement after DOM paint (sometimes needs two frames).
  if (this._expandedSyncQueued) return;
  this._expandedSyncQueued = true;

  const run = () => {
    this._expandedSyncQueued = false;
    try { this.syncExpandedHeights(); } catch (e) {}
  };

  // Prefer Alpine timing if available
  if (this.$nextTick) {
    this.$nextTick(() => {
      requestAnimationFrame(() => requestAnimationFrame(run));
    });
  } else {
    requestAnimationFrame(() => requestAnimationFrame(run));
  }
}
,
        
        toggleExpanded() {
          this.expandedMode = !this.expandedMode;
          this.persistUi();
          // When entering/leaving expanded mode, re-measure so the rail can match the board.
          this.$nextTick(() => this.syncExpandedHeights());
        },

      // -----------------------------
      // Drag reorder state (Phase 1)
      // -----------------------------
      dragState: {
        dragging: false,
        studentId: null,
        dayIndex: null,
        instanceId: null,
        overInstanceId: null,
        overPos: null,
        overEl: null, 
      },

      // -----------------------------
      // init + persistence
      // -----------------------------
      init() {
        // load UI
        const savedUi = loadKey(UI_STORAGE_KEY);
      
        // Pull students from the shared planner state (Course List) when available.
        const planner = loadPlannerState();
        const plannerKids = plannerStudents(planner);
        if (plannerKids.length) this.students = plannerKids;
        this._planner = planner;
      
        const allIds = (this.students || []).map((s) => s.id);
        const normalizedUi = normalizeUiState(savedUi || defaultUiState(), allIds);
      
        // Restore left-rail UI toggles
        this.railTopCollapsed = !!normalizedUi.railTopCollapsed;
        this.showCompleted = !!normalizedUi.showCompleted;
        this.railGradeFilter = normalizedUi.railGradeFilter || "";
        this.railMyCoursesOnly = !!normalizedUi.railMyCoursesOnly;
        this.railStudentAssignedOnly = !!normalizedUi.railStudentAssignedOnly;
        this.railSearch = String(normalizedUi.railSearch || "");
        this.railDockOpen = (typeof normalizedUi.railDockOpen === "boolean") ? normalizedUi.railDockOpen : true;
        this.railDockCollapsed = (typeof normalizedUi.railDockCollapsed === "boolean") ? normalizedUi.railDockCollapsed : false;

        // Schedule board card style (board only; rail unaffected)
        this.boardAddSymbols = (typeof normalizedUi.boardAddSymbols === "boolean") ? normalizedUi.boardAddSymbols : true;
        this.boardAddTracking = (typeof normalizedUi.boardAddTracking === "boolean") ? normalizedUi.boardAddTracking : true;
        this.boardScaleByTime = (typeof normalizedUi.boardScaleByTime === "boolean") ? normalizedUi.boardScaleByTime : false;

      
        this.view = normalizedUi.view;
        this.visibleDays = normalizedUi.visibleDays;
        this.visibleStudentPanels = normalizedUi.panels;
        this.dayViewPanels = normalizedUi.dayViewPanels;
        this.dayViewStudentSlots = normalizedUi.dayViewStudentSlots;
        this.openStudentMenu = null;
      
        // Restore rail header "Add target" selector (student/day)
        this.activeTargetStudentId =
          normalizedUi.activeTargetStudentId || this.visibleStudentPanels?.[0]?.studentId || "S1";
        this.activeTargetDayIndex = Number.isInteger(Number(normalizedUi.activeTargetDayIndex))
          ? Number(normalizedUi.activeTargetDayIndex)
          : (this.visibleDays?.[0] ?? 0);

        this.expandedMode = !!normalizedUi.expandedMode;
      
        // Keep existing logic working
        this.activeTarget = {
          studentId: this.activeTargetStudentId,
          dayIndex: this.activeTargetDayIndex,
        };
        if (!this.visibleDays.includes(this.activeTarget.dayIndex)) {
          this.activeTarget.dayIndex = this.visibleDays?.[0] ?? 0;
        }
      
        // --------------------------------------------------
        // Live-update students when planner state changes
        // (e.g., Course List adds/removes students)
        // --------------------------------------------------
        this._plannerSig = JSON.stringify((this.students || []).map(s => [s.id, s.name]));
      
        const applyPlannerUpdate = (nextPlanner) => {
          const kids = plannerStudents(nextPlanner);
          if (!kids || kids.length === 0) return;
      
          const sig = JSON.stringify(kids.map(s => [s.id, s.name]));
          if (sig === this._plannerSig) return;
      
          this._plannerSig = sig;
          this._planner = nextPlanner;
          this.students = kids;
      
          const ids = kids.map(s => s.id);
      
          // If we don't have students yet (planner state not hydrated), do NOT
          // normalize/persist UI state that depends on student IDs. This prevents
          // the rail target student from snapping back to a default on refresh.
          if (!ids.length) {
            return;
          }
      
          // Re-normalize any UI pieces that depend on student IDs
          const uiNow = {
            view: this.view,
            visibleDays: this.visibleDays,
            panels: this.visibleStudentPanels,
            dayViewPanels: this.dayViewPanels,
            dayViewStudentSlots: this.dayViewStudentSlots,
            railTopCollapsed: this.railTopCollapsed,
            railDockOpen: this.railDockOpen,
            railDockCollapsed: this.railDockCollapsed,
            showCompleted: this.showCompleted,
            railGradeFilter: this.railGradeFilter,
            railMyCoursesOnly: this.railMyCoursesOnly,
            railStudentAssignedOnly: this.railStudentAssignedOnly,
            railSearch: this.railSearch,
            expandedMode: this.expandedMode,

            // Schedule board card style
            boardAddSymbols: this.boardAddSymbols,
            boardAddTracking: this.boardAddTracking,
            boardScaleByTime: this.boardScaleByTime,

            activeTargetStudentId: this.activeTargetStudentId || this.activeTarget?.studentId,
            activeTargetDayIndex: Number.isInteger(Number(this.activeTargetDayIndex))
              ? Number(this.activeTargetDayIndex)
              : this.activeTarget?.dayIndex,
          };
      
          const uiNorm = normalizeUiState(uiNow, ids);
          this.visibleStudentPanels = uiNorm.panels;
          this.dayViewPanels = uiNorm.dayViewPanels;
          this.dayViewStudentSlots = uiNorm.dayViewStudentSlots;
      
          // Keep rail "target" selector stable as students change
          if (this.activeTarget) {
            this.activeTarget.studentId =
              uiNorm.activeTargetStudentId ||
              this.visibleStudentPanels?.[0]?.studentId ||
              ids[0] ||
              "S1";
      
            this.activeTarget.dayIndex = Number.isInteger(Number(uiNorm.activeTargetDayIndex))
              ? Number(uiNorm.activeTargetDayIndex)
              : (this.visibleDays?.[0] ?? 0);
      
            if (!this.visibleDays.includes(this.activeTarget.dayIndex)) {
              this.activeTarget.dayIndex = this.visibleDays?.[0] ?? 0;
            }
      
            // Keep the bound rail selector values in sync
            this.activeTargetStudentId = this.activeTarget.studentId;
            this.activeTargetDayIndex = this.activeTarget.dayIndex;
          }
      
          // If the currently targeted student no longer exists, pick a sane default
          if (this.activeTarget && this.activeTarget.studentId && !ids.includes(this.activeTarget.studentId)) {
            const first =
              (this.visibleStudentPanels && this.visibleStudentPanels[0] && this.visibleStudentPanels[0].studentId) ||
              ids[0];
            this.activeTarget.studentId = first || null;
            this.activeTargetStudentId = this.activeTarget.studentId;
          }
      
          // Ensure placements exist for any newly-added students
          ids.forEach((sid) => this.ensureStudent(sid));
      
          this.persistUi();
        };
      
        this._plannerPoll = () => applyPlannerUpdate(loadPlannerState());
      
        // ✅ NEW: When app.js finishes cloud → localStorage hydration, refresh immediately.
        if (!this._plannerHydrateListenerAdded) {
          this._plannerHydrateListenerAdded = true;
          window.addEventListener("planner:hydrated", () => {
            try {
              this._plannerPoll();
            } catch (_) {}
          });
        }
      
        // Changes from another tab trigger the storage event
        this._onStorage = (e) => {
          try {
            if (e && e.key === getPlannerStateKey()) this._plannerPoll();
          } catch (_) {}
        };
        window.addEventListener("storage", this._onStorage);
      
        // Poll as a fallback (covers same-tab changes and missed storage events)
        this._plannerPollTimer = window.setInterval(this._plannerPoll, 1500);
      
        // workspace resizer (rail + schedule board height)
        requestAnimationFrame(() => this.initWorkspaceResizer());

        // Ensure Expanded mode starts with correct measured heights.
        this.$nextTick(() => this.queueExpandedSync());

        // Keep the expanded rail height in sync with the schedule board
        window.addEventListener("resize", () => {
          clearTimeout(this._expandedSyncT);
          this._expandedSyncT = setTimeout(() => this.syncExpandedHeights(), 80);
        });

        // Observe schedule DOM changes so heights stay correct as cards are added/removed.
        // Important: view switching can re-create panel DOM, so observe the Alpine root.
        if (this.$root) {
          const obs = new MutationObserver(() => {
            clearTimeout(this._expandedSyncMO);
            this._expandedSyncMO = setTimeout(() => this.queueExpandedSync(), 40);
          });
          obs.observe(this.$root, { childList: true, subtree: true });
          this._expandedHeightObserver = obs;
        }

        // Re-measure expanded heights when switching between Student/Day views (DOM can be re-created).
        if (this.$watch) {
          this.$watch('view', () => this.queueExpandedSync());
          this.$watch('expandedMode', () => this.queueExpandedSync());
          this.$watch('visibleDays', () => this.queueExpandedSync());
          this.$watch('visibleStudentPanels', () => this.queueExpandedSync());
          this.$watch('dayViewPanels', () => this.queueExpandedSync());
          this.$watch('dayViewStudentSlots', () => this.queueExpandedSync());
        }

      
        // load cards
        const savedCards = loadKey(CARDS_STORAGE_KEY);
        const normalizedCards = normalizeCardsState(savedCards || defaultCardsState(), allIds);
      
        // Start with whatever was saved
        this.templatesById = { ...(normalizedCards.templatesById || {}) };
      
        // If empty (first run), seed with samples so the page isn't blank
        if (!this.templatesById || Object.keys(this.templatesById).length === 0) {
          this.templatesById = { ...buildSampleTemplates() };
        }
      
        // Load REAL catalog in the background and swap it in safely
        Promise.all([fetchJson(MA_COURSES_URL), fetchJson(MA_SCHED_URL)])
          .then(([maCourses, maScheduling]) => {
            const real = buildTemplatesFromJson(maCourses, maScheduling);
            if (!real || Object.keys(real).length === 0) return;
      
            // Keep custom templates + keep any user-edited values if they exist
            const merged = { ...this.templatesById };
      
            // Remove sample templates once real loads
            for (const id of Object.keys(merged)) {
              if (String(id).startsWith("a:")) delete merged[id];
            }
      
            for (const [id, realTpl] of Object.entries(real)) {
              const existing = merged[id];
      
              if (!existing) {
                merged[id] = { ...realTpl };
                continue;
              }
      
              // Preserve user edits, but pull in any missing real fields
              merged[id] = {
                ...realTpl,
                weeklyTarget: existing.weeklyTarget ?? realTpl.weeklyTarget,
                trackingCount: existing.trackingCount ?? realTpl.trackingCount,
                symbols: (existing.symbols ?? "").trim() ? existing.symbols : realTpl.symbols,
                minutes: existing.minutes ?? realTpl.minutes,
                sortKey: (existing.sortKey ?? "").trim() ? existing.sortKey : realTpl.sortKey,
                title: (existing.title ?? "").trim() ? existing.title : realTpl.title,
              };
            }
      
            // Ensure 12-box tracker baseline stays true
            for (const [id, tpl] of Object.entries(merged)) {
              if (!tpl) continue;
              if (!tpl.trackingCount || tpl.trackingCount < 12) tpl.trackingCount = 12;
              if (!tpl.weeklyTarget) tpl.weeklyTarget = 1;
            }
      
            // Ensure default gradeband selections exist for any grouped courseKey
            if (!this.choices) this.choices = {};
            if (!this.choices.courseOptions) this.choices.courseOptions = {};
            for (const tpl of Object.values(merged)) {
              const cg = tpl?.meta?.choiceGroup;
              if (!cg) continue;
              const courseKey = tpl.courseKey;
              if (!this.choices.courseOptions[courseKey]) {
                this.choices.courseOptions[courseKey] = tpl.meta.option;
              }
            }
      
            this.templatesById = merged;
            this.persistCards();
          })
          .catch((err) => {
            console.warn("MA catalog load failed; staying on sample/saved catalog.", err);
          });
      
        // --- MIGRATION: ensure “choiceGroup” metadata exists for older cached templates ---
        for (const [id, tpl] of Object.entries(this.templatesById || {})) {
          if (!tpl || tpl.courseKey !== "picture-study") continue;
      
          // If old saved template lacks choiceGroup metadata, reconstruct it from variantKey
          if (!tpl.meta || !tpl.meta.choiceGroup) {
            const option = tpl.variantKey || (id.split(":").pop() || "g1-3");
            const labelMap = { "g1-3": "1–3", "g4-6": "4–6", "g7-8": "7–8", "g9-12": "9–12" };
            tpl.meta = {
              ...(tpl.meta || {}),
              choiceGroup: "gradeBand",
              option,
              optionLabel: labelMap[option] || option,
            };
            this.templatesById[id] = tpl;
          }
        }
      
        // MIGRATION (v1.2): ensure ALL cached custom templates use a 12-block tracker.
        // This must not be scoped to picture-study templates.
        for (const [id, tpl] of Object.entries(this.templatesById || {})) {
          if (!tpl) continue;
          // Custom template IDs are prefixed with "u:".
          if (!String(id).startsWith("u:")) continue;
          if (!tpl.trackingCount || tpl.trackingCount < 12) tpl.trackingCount = 12;
          if (!tpl.weeklyTarget) tpl.weeklyTarget = 1;
          this.templatesById[id] = tpl;
        }
      
        this.instancesById = normalizedCards.instancesById || {};
        this.placements = normalizedCards.placements || {};
        this.choices = normalizedCards.choices || { courseOptions: { "picture-study": "g1-3" } };
        if (!this.choices.courseOptions) this.choices.courseOptions = { "picture-study": "g1-3" };
      
        // ensure default selection exists
        if (!this.choices.courseOptions["picture-study"]) {
          this.choices.courseOptions["picture-study"] = "g1-3";
        }
      
        // ensure placements buckets for currently visible panel students
        this.visibleStudentPanels.forEach((p) => this.ensureStudent(p.studentId));
      
        // set a sane active target (prefer saved rail selector)
        {
          const ids = (this.students || []).map((s) => s.id);
          let studentId = this.activeTarget?.studentId;
          if (!studentId || (ids.length && !ids.includes(studentId))) {
            studentId = this.visibleStudentPanels?.[0]?.studentId || ids[0] || "S1";
          }
      
          let dayIndex = Number(this.activeTarget?.dayIndex);
          if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 4) {
            dayIndex = this.visibleDays?.[0] ?? 0;
          }
          if (!this.visibleDays.includes(dayIndex)) {
            dayIndex = this.visibleDays?.[0] ?? 0;
          }
      
          this.activeTarget = { studentId, dayIndex };
          
          // ✅ keep rail selector fields in sync immediately (don’t rely on watchers firing)
          this.activeTargetStudentId = studentId;
          this.activeTargetDayIndex = dayIndex;
        }
      
        // ✅ CHANGED: only persist UI now if we have real student ids.
        // Otherwise we risk locking in "S1" defaults before planner hydration finishes.
        if ((this.students || []).map(s => s.id).length) {
          this.persistUi();
        }
      
        this.persistCards();

        this.$nextTick(() => this.updateRailDockMetrics());
        window.addEventListener("resize", () => this.updateRailDockMetrics());
      
        // Keep the "assign cards to student" selector persistent even if the DOM handler changes.
        if (typeof this.$watch === "function") {
          this.$watch("activeTargetStudentId", (v) => {
            if (this.activeTarget?.studentId !== v) this.activeTarget.studentId = v;
            this.persistUi();
          });
          this.$watch("activeTarget.studentId", (v) => {
            if (this.activeTargetStudentId !== v) this.activeTargetStudentId = v;
            this.persistUi();
          });
          this.$watch("activeTargetDayIndex", (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && this.activeTarget?.dayIndex !== n) this.activeTarget.dayIndex = n;
            this.persistUi();
          });
          this.$watch("activeTarget.dayIndex", (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && Number(this.activeTargetDayIndex) !== n) this.activeTargetDayIndex = n;
            this.persistUi();
          });
        }
      },

      persistUi() {
        saveKey(UI_STORAGE_KEY, {
          view: this.view,
          visibleDays: this.visibleDays,
          panels: this.visibleStudentPanels.map((p) => ({ slot: p.slot, studentId: p.studentId })),
          railTopCollapsed: this.railTopCollapsed,
          railDockOpen: this.railDockOpen,
          railDockCollapsed: this.railDockCollapsed,
          showCompleted: this.showCompleted,
          railGradeFilter: this.railGradeFilter,
          railMyCoursesOnly: this.railMyCoursesOnly,
          railStudentAssignedOnly: this.railStudentAssignedOnly,
          railSearch: this.railSearch,
          dayViewPanels: (this.dayViewPanels || []).map(p => ({ slot: p.slot, dayIdx: p.dayIdx })),
          dayViewStudentSlots: (this.dayViewStudentSlots || []).slice(0, 5),
          activeTargetStudentId: this.activeTargetStudentId || this.activeTarget?.studentId,
          activeTargetDayIndex: Number.isInteger(Number(this.activeTargetDayIndex)) ? Number(this.activeTargetDayIndex) : this.activeTarget?.dayIndex,
          boardAddSymbols: this.boardAddSymbols,
          boardAddTracking: this.boardAddTracking,
          boardScaleByTime: this.boardScaleByTime,
          expandedMode: this.expandedMode,
        });
      },

      persistCards() {
        saveKey(CARDS_STORAGE_KEY, {
          templatesById: this.templatesById,
          placements: this.placements,
          instancesById: this.instancesById,
          choices: this.choices,
        });
      },

      // -----------------------------
      // UI controls
      // -----------------------------
      setView(next) {
        this.view = next;
        this.persistUi();
        // Track view uses x-if (DOM is destroyed/recreated), so re-measure after the swap.
        try { this.queueExpandedSync(); } catch (_) {}
      },

      isDayVisible(i) {
        return this.visibleDays.includes(i);
      },

      toggleDay(i) {
        if (this.isDayVisible(i)) {
          this.visibleDays = this.visibleDays.filter((d) => d !== i);
        } else {
          this.visibleDays = [...this.visibleDays, i].sort((a, b) => a - b);
        }
        if (!this.visibleDays.length) this.visibleDays = [0, 1, 2, 3, 4];

        // keep active day valid
        if (!this.visibleDays.includes(this.activeTarget.dayIndex)) {
          this.activeTarget.dayIndex = this.visibleDays[0];
          this.activeTargetDayIndex = this.activeTarget.dayIndex;
        }

        this.persistUi();
      },

      showAllDays() {
        this.visibleDays = [0, 1, 2, 3, 4];
        this.persistUi();
      },

      openCustomCardModal(mode = "create", templateId = null) {
        this.customModalMode = mode;
        this.customModalTemplateId = templateId;
        this.customModalError = "";
      
        if (mode === "create") {
          this.customForm = { title: "", minutes: 15, weeklyTarget: 1 };
        } else {
          const tpl = this.templatesById?.[templateId];
          if (!tpl) return;
          this.customForm = {
            title: String(tpl.title || ""),
            minutes: Number(tpl.minutes ?? 15),
            weeklyTarget: Number(tpl.weeklyTarget ?? 1),
          };
        }
      
        this.customModalOpen = true;
      },
      
      closeCustomCardModal() {
        this.customModalOpen = false;
        this.customModalError = "";
      },
      
      saveCustomCardModal() {
        const title = String(this.customForm?.title || "").trim();
        const minutes = Number(this.customForm?.minutes);
        const weeklyTarget = Number(this.customForm?.weeklyTarget);
      
        if (!title) {
          this.customModalError = "Please enter a title.";
          return;
        }
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 600) {
          this.customModalError = "Minutes must be a number between 0 and 600.";
          return;
        }

        if (!Number.isFinite(weeklyTarget) || weeklyTarget < 0 || weeklyTarget > 5) {
          this.customModalError = "Days per week must be a number between 0 and 5.";
          return;
        }
      
        if (this.customModalMode === "create") {
          const id = `u:${uid("card")}`;
          this.templatesById[id] = {
            id,
            sortKey: "ZZZ::99",
            courseKey: "custom",
            courseLabel: "Custom",
            variantKey: "custom",
            variantSort: 99,
            title,
            minutes,
            symbols: "",
            trackingCount: 12,
            weeklyTarget, // ✅ enables counters/checkmark
          };
        }
      
        if (this.customModalMode === "edit") {
          const id = this.customModalTemplateId;
          if (!id || !String(id).startsWith("u:")) return;
          const tpl = this.templatesById?.[id];
          if (!tpl) return;

          this.templatesById[id] = {
            ...tpl,
            title,
            minutes,
            weeklyTarget,
          };
        }

        if (this.customModalMode === "adjust") {
          const id = this.customModalTemplateId;
          if (!id) return;
          const tpl = this.templatesById?.[id];
          if (!tpl) return;

          // Adjust an existing (Alveary or custom) template's scheduling defaults locally.
          // Title stays the same for Alveary templates.
          this.templatesById[id] = {
            ...tpl,
            minutes,
            weeklyTarget,
          };
        }

        this.persistCards();
        this.closeCustomCardModal();
      },
      
      confirmDeleteCustomCard() {
        const templateId = this.customModalTemplateId;
        if (!templateId || !String(templateId).startsWith("u:")) return;
      
        // remove template
        delete this.templatesById[templateId];
      
        // remove instances referencing it
        const doomedInstanceIds = [];
        for (const [instId, inst] of Object.entries(this.instancesById || {})) {
          if (inst?.templateId === templateId) doomedInstanceIds.push(instId);
        }
        for (const instId of doomedInstanceIds) delete this.instancesById[instId];
      
        // remove placements
        for (const [studentId, daysObj] of Object.entries(this.placements || {})) {
          for (let d = 0; d <= 4; d++) {
            const arr = daysObj?.[d];
            if (!Array.isArray(arr)) continue;
            this.placements[studentId][d] = arr.filter((id) => !doomedInstanceIds.includes(id));
          }
        }
      
        this.persistCards();
        this.closeCustomCardModal();
      },

      // -----------------------------
      // Student dropdown
      // -----------------------------
      toggleStudentMenu(idx) {
        this.openStudentMenu = this.openStudentMenu === idx ? null : idx;
      },

      closeStudentMenu() {
        this.openStudentMenu = null;
      },

      // -----------------------------
      // Manage Students
      // -----------------------------
      toggleStudentsOpen() {
        this.studentsOpen = !this.studentsOpen;
      },

      toggleColorPicker(studentId) {
        this.colorPickerFor = (this.colorPickerFor === studentId) ? null : studentId;
      },
      isColorPickerOpen(studentId) {
        return this.colorPickerFor === studentId;
      },
      closeColorPicker() {
        this.colorPickerFor = null;
      },
      setStudentColor(studentId, color) {
        const idx = this.students.findIndex((s) => s.id === studentId);
        if (idx === -1) return;
        this.students[idx].color = color;

        const planner = loadPlannerState();
        const pIdx = (planner.students || []).findIndex((s) => (s.id || '').toString() === studentId);
        if (pIdx !== -1) {
          planner.students[pIdx].color = color;
        }
        savePlannerState(planner);

        // keep day-view dropdown labels + rail header in sync
        try { this.refreshStudentsEverywhere?.(); } catch (e) {}
        this.closeColorPicker();
      },

      addStudent() {
        const name = String(this.newStudentName || "").trim();
        if (!name) return;

        // Update shared planner state (same store used across pages)
        const planner = loadPlannerState() || { version: "local", students: [] };
        const students = Array.isArray(planner.students) ? planner.students.slice() : [];

        // Prevent duplicates by name (case-insensitive)
        const exists = students.some((s) => String(s?.name || "").toLowerCase() === name.toLowerCase());
        if (exists) {
          this.newStudentName = "";
          return;
        }

        const palette = this.studentColorPalette || [];
        const used = new Set((students || []).map((s) => s.color).filter(Boolean));
        const nextColor = palette.find((c) => !used.has(c)) || palette[0] || "#5b6f5d";
        const student = { id: "s_" + Date.now(), name, color: nextColor };
        students.push(student);
        planner.students = students;

        savePlannerState(planner);
        this.newStudentName = "";

        // Immediately refresh this page (the poll will also keep it in sync)
        if (typeof this._plannerPoll === "function") this._plannerPoll();
      },

      removeStudent(id) {
        if (!id) return;
        const planner = loadPlannerState() || { version: "local", students: [] };
        const students = Array.isArray(planner.students) ? planner.students.slice() : [];
        planner.students = students.filter((s) => s && s.id !== id);
        savePlannerState(planner);

        if (typeof this._plannerPoll === "function") this._plannerPoll();
      },

      getStudentName(studentId) {
        const s = (this.students || []).find((x) => x.id === studentId);
        return s ? s.name : "Student";
      },

      
setPanelStudent(idx, studentId) {
  if (!Array.isArray(this.visibleStudentPanels)) return;
  if (!this.visibleStudentPanels[idx]) return;

  const allIds = (this.students || []).map((s) => s.id);
  if (allIds.length && !allIds.includes(studentId)) return;

  let next = this.visibleStudentPanels.map((p, i) =>
    i === idx ? { ...p, studentId } : { ...p }
  );

  // De-dupe across ANY number of panels (keep chosen id; fix the others)
  const used = new Set();
  next = next.map((p, i) => {
    const isSelectedPanel = i === idx;
    if (isSelectedPanel) {
      used.add(p.studentId);
      return p;
    }
    if (!p.studentId || used.has(p.studentId)) {
      const fallback = allIds.find((id) => !used.has(id) && id !== studentId) || allIds.find((id) => !used.has(id)) || studentId || "S1";
      used.add(fallback);
      return { ...p, studentId: fallback };
    }
    used.add(p.studentId);
    return p;
  });

  // Re-slot sequentially just in case (P1..Pn)
  next = next.map((p, i) => ({ ...p, slot: `P${i + 1}` }));

  this.visibleStudentPanels = next;

  // ensure placements exist for new student
  this.ensureStudent(studentId);

  // If active target is no longer visible, snap it to the first panel
  const visibleIds = new Set(next.map((p) => p.studentId));
  if (!visibleIds.has(this.activeTarget.studentId)) {
    this.activeTarget.studentId = next[0].studentId;
  }

  this.persistUi();
  this.persistCards();
},


addStudentPanel() {
  const maxPanels = 5;
  if (!Array.isArray(this.visibleStudentPanels)) this.visibleStudentPanels = [];
  if (this.visibleStudentPanels.length >= maxPanels) return;

  const allIds = (this.students || []).map((s) => s.id);
  const used = new Set(this.visibleStudentPanels.map((p) => p.studentId).filter(Boolean));
  const nextId = allIds.find((id) => !used.has(id)) || allIds[0] || "S1";

  const next = this.visibleStudentPanels
    .slice()
    .map((p, i) => ({ ...p, slot: `P${i + 1}` }));

  next.push({ slot: `P${next.length + 1}`, studentId: nextId });

  this.visibleStudentPanels = next;

  this.ensureStudent(nextId);

  // keep active target visible
  if (!this.activeTarget?.studentId) this.activeTarget = { studentId: next[0].studentId, dayIdx: 0 };

  this.persistUi();
  this.persistCards();
},

removeStudentPanel() {
  if (!Array.isArray(this.visibleStudentPanels)) return;
  if (this.visibleStudentPanels.length <= 1) return;

  const next = this.visibleStudentPanels.slice(0, -1).map((p, i) => ({ ...p, slot: `P${i + 1}` }));
  this.visibleStudentPanels = next;

  // If active target was on a removed panel, snap to first remaining
  const visibleIds = new Set(next.map((p) => p.studentId));
  if (!visibleIds.has(this.activeTarget.studentId)) {
    this.activeTarget.studentId = next[0].studentId;
  }

  this.persistUi();
  this.persistCards();
},

addDayPanel() {
  const maxPanels = 5;
  if (!Array.isArray(this.dayViewPanels)) this.dayViewPanels = [];
  if (this.dayViewPanels.length >= maxPanels) return;

  const used = new Set(this.dayViewPanels.map((p) => p.dayIdx));
  const nextDay = [0,1,2,3,4].find((d) => !used.has(d)) ?? 0;

  const next = this.dayViewPanels.slice().map((p, i) => ({ ...p, slot: `D${i + 1}` }));
  next.push({ slot: `D${next.length + 1}`, dayIdx: nextDay });

  this.dayViewPanels = next;
  this.persistUi();
},

removeDayPanel() {
  if (!Array.isArray(this.dayViewPanels)) return;
  if (this.dayViewPanels.length <= 1) return;

  this.dayViewPanels = this.dayViewPanels.slice(0, -1).map((p, i) => ({ ...p, slot: `D${i + 1}` }));
  this.persistUi();
},

      // -----------------------------
      // Display helpers
      // -----------------------------
      dayLabel(i) {
        const n = Number(i);
        return this.dayLabels[n] || ['Mon','Tue','Wed','Thu','Fri'][n] || `Day ${n + 1}`;
      },

      dayLabelLong(i) {
        const n = Number(i);
        return this.dayLongLabels?.[n] || ["Monday","Tuesday","Wednesday","Thursday","Friday"][n] || `Day ${n + 1}`;
      },

      // -----------------------------
      // Day View helpers (Phase 3)
      // -----------------------------
      dayViewSize() {
        // v1: 2–3 day panels side-by-side; easy to tune later
        return 3;
      },
      
      dayViewWindowStart: 0,
      
      // -----------------------------
      // Day View helpers (Phase 3)
      // -----------------------------
      dayViewActiveSlots() {
        const slots = Array.isArray(this.dayViewStudentSlots) ? this.dayViewStudentSlots : [];
        return slots.filter((s) => !!s);
      },

      toggleDayMenu(idx) {
        this.openDayMenu = this.openDayMenu === idx ? null : idx;
      },
      closeDayMenu() {
        this.openDayMenu = null;
      },
      
      
setDayPanel(idx, dayIdx) {
  const n = Number(dayIdx);
  if (!Number.isInteger(n) || n < 0 || n > 4) return;
  if (!Array.isArray(this.dayViewPanels)) return;
  if (!this.dayViewPanels[idx]) return;

  let next = this.dayViewPanels.map((p, i) =>
    i === idx ? { ...p, dayIdx: n } : { ...p }
  );

  // De-dupe across any number of day panels
  const usedDays = new Set();
  next = next.map((p, i) => {
    const isSelected = i === idx;
    if (isSelected) {
      usedDays.add(p.dayIdx);
      return p;
    }
    if (!Number.isInteger(p.dayIdx) || usedDays.has(p.dayIdx)) {
      const fallback = [0,1,2,3,4].find((d) => !usedDays.has(d) && d !== n) ?? [0,1,2,3,4].find((d) => !usedDays.has(d)) ?? 0;
      usedDays.add(fallback);
      return { ...p, dayIdx: fallback };
    }
    usedDays.add(p.dayIdx);
    return p;
  });

  // Re-slot sequentially (D1..Dn)
  next = next.map((p, i) => ({ ...p, slot: `D${i + 1}` }));

  this.dayViewPanels = next;
  this.persistUi();
},
      
      setDayViewSlotStudent(slotIdx, studentId) {
        if (!Array.isArray(this.dayViewStudentSlots)) return;
        if (slotIdx < 0 || slotIdx >= this.dayViewStudentSlots.length) return;
      
        // Allow clearing a slot (hides that column)
        const allIds = (this.students || []).map((s) => s.id);
        if (!studentId) {
          const next = this.dayViewStudentSlots.slice();
          next[slotIdx] = "";
          this.dayViewStudentSlots = next;
          this.persistUi();
          return;
        }
        if (!allIds.includes(studentId)) return;
      
        const next = this.dayViewStudentSlots.slice();
        next[slotIdx] = studentId;
      
        // optional: de-dupe (don’t allow the same student in multiple slots)
        const seen = new Set();
        for (let i = 0; i < next.length; i++) {
          if (!next[i]) continue;
          if (seen.has(next[i])) {
            const repl = allIds.find((id) => !seen.has(id)) || "";
            next[i] = repl;
          }
          if (next[i]) seen.add(next[i]);
        }
      
        this.dayViewStudentSlots = next;
        this.ensureStudent(studentId); // keep placements safe
        this.persistUi();
        this.persistCards();
      },
      
      dayViewCanPrev() {
        return (this.dayViewWindowStart || 0) > 0;
      },
      
      dayViewCanNext() {
        const days = Array.isArray(this.visibleDays) ? this.visibleDays : [0,1,2,3,4];
        return (this.dayViewWindowStart || 0) < Math.max(0, days.length - this.dayViewSize());
      },
      
      dayViewPrev() {
        this.dayViewWindowStart = Math.max(0, (this.dayViewWindowStart || 0) - 1);
      },
      
      dayViewNext() {
        const days = Array.isArray(this.visibleDays) ? this.visibleDays : [0,1,2,3,4];
        const maxStart = Math.max(0, days.length - this.dayViewSize());
        this.dayViewWindowStart = Math.min(maxStart, (this.dayViewWindowStart || 0) + 1);
      },
      
      getLaneInstanceIds(studentId, dayIndex) {
        const d = Number(dayIndex);
        const arr = this.placements?.[studentId]?.[d];
        return Array.isArray(arr) ? arr : [];
      },

      setCourseOption(courseKey, option) {
        if (!this.choices.courseOptions) this.choices.courseOptions = {};
        this.choices.courseOptions[courseKey] = option;
        this.persistCards();
      },
      
      addRailEntryToActive(entry) {
        if (!entry) return;
      
        let templateId = null;
      
        if (entry.type === "single") {
          templateId = entry.templateId;
        } else if (entry.type === "group") {
          const selectedOpt = this.choices?.courseOptions?.[entry.courseKey];
          const match = (entry.options || []).find(o => o.option === selectedOpt);
          templateId = (match && match.templateId) || entry.activeTemplateId;
        }
      
        if (!templateId) return;
        this.addTemplateToActive(templateId);
      },

      railEntryDisplay(entry) {
        if (!entry) return { title: "", sub: "", minutes: 0, symbols: "" };
      
        // SINGLE template
        if (entry.type === "single") {
          const tpl = this.templatesById?.[entry.templateId] || {};
          return {
            title: tpl.title || "",
            sub: "", // no extra line
            minutes: Number(tpl.minutes || 0),
            symbols: tpl.symbols || "",
          };
        }
      
        // GROUP template (choice-based, e.g. Picture Study)
        const active = this.templatesById?.[entry.activeTemplateId] || {};
        const selectedOpt = this.choices?.courseOptions?.[entry.courseKey];
        const selectedMeta =
          (entry.options || []).find((o) => o.option === selectedOpt) || (entry.options || [])[0];
      
        // Rail should feel like ONE card:
        // Title stays “Picture Study” (course label), and the band is a secondary line.
        const baseTitle = active.courseLabel || active.title || "";
        const bandLabel = selectedMeta?.label || active?.meta?.optionLabel || "";
      
        return {
          title: baseTitle,                // "Picture Study"
          sub: bandLabel ? `Grades ${bandLabel}` : "", // "Grades 1–3"
          minutes: Number(active.minutes || 0),
          symbols: active.symbols || "",
        };
      },

      // Helper: resolve the active templateId for either a single or group rail entry
      railEntryTemplateId(entry) {
        if (!entry) return null;
        if (entry.type === "single") return entry.templateId || null;

        // group (grade-band / option-based)
        const selectedOpt = this.choices?.courseOptions?.[entry.courseKey];
        const match = (entry.options || []).find(o => o.option === selectedOpt);
        return (match && match.templateId) || entry.activeTemplateId || null;
      },




      // -----------------------------
      // Phase 2.5: Catalog + placements
      // -----------------------------
      ensureStudent(studentId) {
        if (!this.placements[studentId]) {
          this.placements[studentId] = { 0: [], 1: [], 2: [], 3: [], 4: [] };
        } else {
          for (let d = 0; d <= 4; d++) {
            if (!Array.isArray(this.placements[studentId][d])) this.placements[studentId][d] = [];
          }
        }
      },

      // rail sorting: match course list order via sortKey
      railEntries() {
        const allTemplates = Object.values(this.templatesById || {}).filter(Boolean);

        // Apply Rail filters (grade, search, My courses, Student assignments)
        const gradeKey = String(this.railGradeFilter || "").trim(); // "" = all
        const q = String(this.railSearch || "").trim().toLowerCase();
        const planner = this._planner || loadPlannerState();
        const activeStudentId = this.activeTarget?.studentId;

        let templates = allTemplates.slice();

        // Grade filter affects RAIL ONLY (never the scheduled board)
        if (gradeKey) {
          templates = templates.filter((t) => {
            // ✅ Custom templates always visible regardless of grade filter
            if (String(t?.id || "").startsWith("u:")) return true;
        
            const gf = Array.isArray(t?.gradeFilter) ? t.gradeFilter : [];
            return gf.includes(gradeKey);
          });
        }

        if (q) {
          templates = templates.filter((t) => (t.title || "").toLowerCase().includes(q));
        }

        // "My courses" = bookmarked in Course List planner state
          if (this.railMyCoursesOnly) {
            templates = templates.filter((t) => {
              // ✅ Always include custom cards in "My courses"
              if (String(t?.id || "").startsWith("u:")) return true;
          
              const key = t.courseKey || ""; // courseId for courses, Topic_ID for topics
          
              // Be resilient: older cached templates may not have sourceType yet.
              const looksLikeCourse =
                t.sourceType === "course" ||
                (planner?.courses && Object.prototype.hasOwnProperty.call(planner.courses, key));
          
              if (looksLikeCourse) return plannerHasBookmarkedCourse(planner, key);
          
              // topic (or unknown): keep if it's bookmarked as a topic (or a course, just in case)
              return (
                plannerHasBookmarkedTopic(planner, key) ||
                plannerHasBookmarkedCourse(planner, key)
              );
            });
          }

        // "Student assignments" = assigned in planner state for selected student
        if (this.railStudentAssignedOnly && activeStudentId) {
          templates = templates.filter((t) => {
            // ✅ Always keep custom templates in the rail, even under "Student assignments"
            if (String(t?.id || "").startsWith("u:")) return true;
            const key = t.courseKey || "";
            // Be resilient: older cached templates may not have sourceType yet.
            const looksLikeCourse =
              t.sourceType === "course" ||
              (planner?.courses && Object.prototype.hasOwnProperty.call(planner.courses, key));

            if (looksLikeCourse) {
              return plannerCourseAssignedToStudent(planner, key, activeStudentId);
            }

            // topic (or unknown): keep if assigned as a topic (or as a course, just in case)
            return (
              plannerTopicAssignedToStudent(planner, key, activeStudentId) ||
              plannerCourseAssignedToStudent(planner, key, activeStudentId)
            );
          });
        }
      
        // group templates by courseKey when they have meta.choiceGroup
        const byCourse = new Map();
        for (const t of templates) {
          const courseKey = t.courseKey || "";
          const cg = t?.meta?.choiceGroup;
          if (cg) {
            if (!byCourse.has(courseKey)) byCourse.set(courseKey, []);
            byCourse.get(courseKey).push(t);
          }
        }
      
        // helper: sort templates the same way you were sorting before
        const sortTpl = (a, b) => {
          // ✅ Custom templates (u:...) always appear at the top of the rail
          const aCustom = String(a?.id || "").startsWith("u:") ? 0 : 1;
          const bCustom = String(b?.id || "").startsWith("u:") ? 0 : 1;
          if (aCustom !== bCustom) return aCustom - bCustom;
        
          const ak = String(a.sortKey || "");
          const bk = String(b.sortKey || "");
          if (ak < bk) return -1;
          if (ak > bk) return 1;
        
          const ac = String(a.courseLabel || "");
          const bc = String(b.courseLabel || "");
          if (ac < bc) return -1;
          if (ac > bc) return 1;
        
          const av = Number(a.variantSort || 0);
          const bv = Number(b.variantSort || 0);
          if (av !== bv) return av - bv;
        
          return String(a.title || "").localeCompare(String(b.title || ""));
        };
      
        templates.sort(sortTpl);
      
        const entries = [];
        const seenGroupedCourse = new Set();
      
        for (const t of templates) {
          const courseKey = t.courseKey || "";
          const cg = t?.meta?.choiceGroup;
      
          if (cg) {
            if (seenGroupedCourse.has(courseKey)) continue;
            seenGroupedCourse.add(courseKey);
      
            const options = (byCourse.get(courseKey) || []).slice().sort(sortTpl);
            const selected = this.choices?.courseOptions?.[courseKey] || options?.[0]?.meta?.option;
      
            // pick the selected template for display
            const activeTpl =
              options.find(x => x?.meta?.option === selected) || options[0];
      
            entries.push({
              type: "group",
              courseKey,
              choiceGroup: cg,
              courseLabel: activeTpl?.courseLabel || "",
              sortKey: activeTpl?.sortKey || "",
              options: options.map(x => ({
                option: x?.meta?.option,
                label: x?.meta?.optionLabel || x?.meta?.option,
                templateId: x.id,
              })),
              activeTemplateId: activeTpl?.id,
            });
          } else {
            entries.push({
              type: "single",
              templateId: t.id,
              sortKey: t.sortKey || "",
            });
          }
        }

        // Apply rail-only grade filter AFTER building entries so grade-band
        // cards keep their full option list.
        const g = String(this.railGradeFilter || "");
        let filtered = entries;
        if ((/^G([1-9]|1[0-2])$/).test(g)) {
          filtered = entries.filter((e) => this.railEntryMatchesGrade(e, g));
        }

        // Move completed items to the bottom for the currently selected rail student
        const sid = this.activeTarget?.studentId;
        if (sid) {
          filtered.sort((a, b) => {
            const ta = this.trackingForEntry(a);
            const tb = this.trackingForEntry(b);
            const da = ta.show && ta.done ? 1 : 0;
            const db = tb.show && tb.done ? 1 : 0;
        
            // incomplete first, complete last
            if (da !== db) return da - db;
        
            // keep existing order otherwise (already sorted above)
            return 0;
          });
        }

        return filtered;
      },

      railEntryMatchesGrade(entry, grade) {
        if (!grade) return true;

        if (entry?.type === "single") {
          // ✅ Custom templates are always visible regardless of grade filter
          if (String(entry?.templateId || "").startsWith("u:")) return true;
        
          const tpl = this.templatesById?.[entry.templateId];
          const gf = Array.isArray(tpl?.gradeFilter) ? tpl.gradeFilter : [];
          return gf.includes(grade);
        }

        if (entry?.type === "group") {
          const opts = Array.isArray(entry.options) ? entry.options : [];
          for (const o of opts) {
            if (String(o?.templateId || "").startsWith("u:")) return true; // ✅
            const tpl = this.templatesById?.[o.templateId];
            const gf = Array.isArray(tpl?.gradeFilter) ? tpl.gradeFilter : [];
            if (gf.includes(grade)) return true;
          }
          return false;
        }

        return true;
      },

      // ---- Day-toggle helpers (Rail) ----

      // Returns an instanceId if entry is already placed on that day for that student, else null
      instanceIdForEntryOnDay(studentId, dayIndex, entry) {
        const ids = this.placements?.[studentId]?.[dayIndex];
        if (!Array.isArray(ids) || !entry) return null;
      
        for (const instId of ids) {
          const inst = this.instancesById?.[instId];
          if (!inst) continue;
      
          const tpl = this.templatesById?.[inst.templateId];
          if (!tpl) continue;
      
          if (entry.type === "single") {
            if (inst.templateId === entry.templateId) return instId;
          } else if (entry.type === "group") {
            // count/toggle by courseKey (any grade-band counts as “Picture Study”)
            if (tpl.courseKey === entry.courseKey) return instId;
          }
        }
      
        return null;
      },
      
      isEntryOnDay(studentId, dayIndex, entry) {
        return !!this.instanceIdForEntryOnDay(studentId, dayIndex, entry);
      },
      
      toggleEntryOnDay(entry, dayIndex) {
        const studentId = this.activeTarget?.studentId;
        dayIndex = Number(dayIndex);
      
        if (!studentId || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 4) return;
      
        this.ensureStudent(studentId);
      
        const existingId = this.instanceIdForEntryOnDay(studentId, dayIndex, entry);
      
        // If already placed, remove it
        if (existingId) {
          this.removeInstance(studentId, dayIndex, existingId);
          return;
        }
      
        // Otherwise add it (respect group selection)
        let templateId = null;
      
        if (entry.type === "single") {
          templateId = entry.templateId;
        } else if (entry.type === "group") {
          const selectedOpt = this.choices?.courseOptions?.[entry.courseKey];
          const match = (entry.options || []).find(o => o.option === selectedOpt);
          templateId = (match && match.templateId) || entry.activeTemplateId;
        }
      
        if (!templateId) return;
      
        // Add to *that* day (not activeTarget.dayIndex)
        const tpl = this.templatesById?.[templateId];
        if (!tpl) return;
      
        const instanceId = uid("inst");
        this.instancesById[instanceId] = {
          instanceId,
          templateId,
          createdAt: Date.now(),
        };
      
        this.placements[studentId][dayIndex].push(instanceId);
        this.persistCards();
      },

      weeklyTargetForEntry(entry) {
        if (!entry) return 0;
      
        // SINGLE: target from template
        if (entry.type === "single") {
          const tpl = this.templatesById?.[entry.templateId];
          return Number(tpl?.weeklyTarget || 0);
        }
      
        // GROUP: target from active template (they should all match)
        if (entry.type === "group") {
          const tpl = this.templatesById?.[entry.activeTemplateId];
          return Number(tpl?.weeklyTarget || 0);
        }
      
        return 0;
      },
      
      weeklyUsedForEntry(studentId, entry) {
        if (!studentId || !entry) return 0;
        const daysObj = this.placements?.[studentId];
        if (!daysObj) return 0;
      
        let used = 0;
      
        for (let d = 0; d <= 4; d++) {
          const ids = daysObj?.[d];
          if (!Array.isArray(ids)) continue;
      
          for (const instId of ids) {
            const inst = this.instancesById?.[instId];
            if (!inst) continue;
      
            const tpl = this.templatesById?.[inst.templateId];
            if (!tpl) continue;
      
            if (entry.type === "single") {
              if (inst.templateId === entry.templateId) used++;
            } else if (entry.type === "group") {
              // Count by courseKey so any grade-band satisfies Picture Study
              if (tpl.courseKey === entry.courseKey) used++;
            }
          }
        }
      
        return used;
      },
      
      trackingForEntry(entry) {
        const studentId = this.activeTarget?.studentId; // ties to rail student picker
        const target = this.weeklyTargetForEntry(entry);
        if (!target) return { show: false, done: false, label: "" };
      
        const used = this.weeklyUsedForEntry(studentId, entry);
        const done = used >= target;
      
        return {
          show: true,
          done,
          label: done ? "" : `${used}/${target}`,
        };
      },

      // Rail sections (per active rail student):
      // - Need to schedule: anything not yet meeting weekly target
      // - Complete: items that have met/exceeded weekly target
      railEntriesNeed() {
        return this.railEntries().filter((e) => {
          const t = this.trackingForEntry(e);
          return !(t.show && t.done);
        });
      },

      railEntriesComplete() {
        return this.railEntries().filter((e) => {
          const t = this.trackingForEntry(e);
          return (t.show && t.done);
        });
      },

    toggleCompletedRail() {
      this.showCompleted = !this.showCompleted;
      this.persistUi();
    },

    toggleRailTop() {
      this.railTopCollapsed = !this.railTopCollapsed;
      this.persistUi();
    },
    toggleRailDockCollapsed() {
      this.railDockCollapsed = !this.railDockCollapsed;
      // when opening, ensure the rail list scroll is at top so it feels intentional
      this.$nextTick(() => {
        if (!this.railDockCollapsed) {
          const list = document.querySelector('.sched-rail-list');
          if (list) list.scrollTop = 0;
        }
      });
      this.persistUi();
    },
    toggleRailDockOpen() {
      this.railDockOpen = !this.railDockOpen;
      this.$nextTick(() => window.dispatchEvent(new Event("resize")));
      this.persistUi();
    },
    updateRailDockMetrics() {
      const header = document.querySelector('.app-header');
      const h = header ? header.getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty('--sched-rail-top', `${Math.round(h + 16)}px`);
    },




      completedRailLabel() {
        return this.showCompleted ? "Hide completed" : "Show completed";
      },
      
      sortedTemplates() {
        // Backwards-compatible helper for anywhere else that expects templates.
        // We’ll render from railEntries() in the HTML now.
        return Object.values(this.templatesById || {}).filter(Boolean);
      },

      // active target (click a column to set)
      setActiveTarget(studentId, dayIndex) {
        const d = Number(dayIndex);
        this.activeTarget = { studentId, dayIndex: d };
        this.activeTargetStudentId = studentId;
        this.activeTargetDayIndex = d;
        this.persistUi();
      },

      activeTargetLabel() {
        const s = this.getStudentName(this.activeTarget.studentId);
        const d = this.dayLabel(this.activeTarget.dayIndex);
        return `${s} • ${d}`;
      },

      railGradeLabel(g) {
        const v = String(g || "");
        const m = v.match(/^G([1-9]|1[0-2])$/);
      
        // If "All grades" / blank, return empty so it doesn't show in summary
        if (!m) return "";
      
        return `Grade ${m[1]}`;
      },

      railFilterLabel() {
        return "Filtered by";
      },

      railFilterValue() {
        const parts = [];
      
        const gradePart = this.railGradeLabel(this.railGradeFilter);
        if (gradePart) parts.push(gradePart);
      
        if (this.railMyCoursesOnly) parts.push("My courses");
        if (this.railStudentAssignedOnly) parts.push("Student assignments");
      
        return parts.join(" • ");
      },

      setRailGradeFilter(val) {
        this.railGradeFilter = String(val || "");
        this.persistUi();
      },

      toggleRailMyCoursesOnly() {
        this.railMyCoursesOnly = !this.railMyCoursesOnly;
        this.persistUi();
      },

      toggleRailStudentAssignedOnly() {
        this.railStudentAssignedOnly = !this.railStudentAssignedOnly;
        this.persistUi();
      },

      // Create a new instance and append to active day
      addTemplateToActive(templateId) {
        const tpl = this.templatesById?.[templateId];
        if (!tpl) return;

        const studentId = this.activeTarget.studentId;
        const dayIndex = this.activeTarget.dayIndex;

        this.ensureStudent(studentId);

        const instanceId = uid("inst");
        this.instancesById[instanceId] = {
          instanceId,
          templateId,
          createdAt: Date.now(),
        };

        this.placements[studentId][dayIndex].push(instanceId);
        this.persistCards();
      },

      // Remove instance from a day (Phase 2.5 helper)
      removeInstance(studentId, dayIndex, instanceId) {
        this.ensureStudent(studentId);
        const arr = this.placements[studentId][dayIndex] || [];
        this.placements[studentId][dayIndex] = arr.filter((id) => id !== instanceId);
        // keep instance in instancesById for now (safe); can GC later
        this.persistCards();
      },

      moveInstance(studentId, dayIndex, fromIndex, toIndex) {
        this.ensureStudent(studentId);
      
        const list = this.placements?.[studentId]?.[dayIndex];
        if (!Array.isArray(list)) return;
      
        const len = list.length;
        if (
          fromIndex < 0 || fromIndex >= len ||
          toIndex < 0 || toIndex >= len ||
          fromIndex === toIndex
        ) {
          return;
        }
      
        const next = list.slice();
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
      
        this.placements[studentId][dayIndex] = next;
        this.persistCards();
      },

      moveInstanceAcrossDays(studentId, fromDayIndex, toDayIndex, fromIndex, toIndex) {
        this.ensureStudent(studentId);
      
        const fromDay = Number(fromDayIndex);
        const toDay = Number(toDayIndex);
      
        if (fromDay === toDay) {
          // fall back to existing reorder
          return this.moveInstance(studentId, fromDay, fromIndex, toIndex);
        }
      
        const fromList = this.placements?.[studentId]?.[fromDay];
        const toList = this.placements?.[studentId]?.[toDay];
      
        if (!Array.isArray(fromList) || !Array.isArray(toList)) return;
      
        if (fromIndex < 0 || fromIndex >= fromList.length) return;
      
        // Clamp target index to [0..toList.length]
        const insertAt = Math.max(0, Math.min(Number(toIndex), toList.length));
      
        const [moved] = fromList.splice(fromIndex, 1);
        if (!moved) return;
      
        toList.splice(insertAt, 0, moved);
      
        // write back (keeps reactivity predictable)
        this.placements[studentId][fromDay] = fromList;
        this.placements[studentId][toDay] = toList;
      
        this.persistCards();
      },

      onDragStart(evt, studentId, dayIndex, instanceId) {
        this.dragState.dragging = true;
        this.dragState.studentId = studentId;
        this.dragState.dayIndex = Number(dayIndex);
        this.dragState.instanceId = instanceId;
        this.dragState.overInstanceId = null;
        this.dragState.overPos = null;
        this.dragState.overEl = null;
      
        // Required for Safari/Firefox: set some drag data
        try {
          evt.dataTransfer.effectAllowed = "move";
          evt.dataTransfer.setData("text/plain", String(instanceId));
        } catch (e) {}
      
        // optional: add a class to body for styling while dragging
        try { document.body.classList.add("sched-dragging"); } catch (e) {}
      },
      
      onDragEnd() {
        this.dragState.dragging = false;
        this.dragState.overInstanceId = null;
        this.dragState.overPos = null;
      
        // ✅ remove per-card drop marker
        try {
          if (this.dragState.overEl) this.dragState.overEl.removeAttribute("data-drop-pos");
        } catch (e) {}
        this.dragState.overEl = null;
      
        try {
          document.body.classList.remove("sched-dragging", "sched-drop-above", "sched-drop-below");
        } catch (e) {}
      },
      
      onDragOver(evt, studentId, dayIndex, overInstanceId) {
        if (!this.dragState.dragging) return;
        if (this.dragState.studentId !== studentId) return;
      
        this.dragState.overInstanceId = overInstanceId;
      
        // Determine above/below midpoint
        let pos = null;
        try {
          const rect = evt.currentTarget.getBoundingClientRect();
          const y = evt.clientY - rect.top;
          pos = (y < rect.height / 2) ? "above" : "below";
        } catch (e) {}
      
        this.dragState.overPos = pos;
      
        // ✅ Clear previous hovered element marker
        try {
          if (this.dragState.overEl && this.dragState.overEl !== evt.currentTarget) {
            this.dragState.overEl.removeAttribute("data-drop-pos");
          }
        } catch (e) {}
      
        // ✅ Mark current hovered card with drop position
        try {
          if (pos) evt.currentTarget.setAttribute("data-drop-pos", pos);
          else evt.currentTarget.removeAttribute("data-drop-pos");
          this.dragState.overEl = evt.currentTarget;
        } catch (e) {}
      
        // allow drop
        try { evt.dataTransfer.dropEffect = "move"; } catch (e) {}
      },

      onDropzoneDragOver(evt, studentId, dayIndex) {
        if (!this.dragState.dragging) return;
        // Phase 2 scope: same student only (for now)
        if (this.dragState.studentId !== studentId) return;
      
        // allow drop
        try { evt.dataTransfer.dropEffect = "move"; } catch (e) {}
      
        // clear card-target visuals when hovering empty space
        this.dragState.overInstanceId = null;
        this.dragState.overPos = null;

        try {
          if (this.dragState.overEl) this.dragState.overEl.removeAttribute("data-drop-pos");
        } catch (e) {}
        this.dragState.overEl = null;
      },
      
      onDropzoneDrop(evt, studentId, dayIndex) {
        if (!this.dragState.dragging) return;
        if (this.dragState.studentId !== studentId) return;
      
        const sid = studentId;
        const fromDay = Number(this.dragState.dayIndex);
        const toDay = Number(dayIndex);
      
        const fromList = this.placements?.[sid]?.[fromDay];
        const toList = this.placements?.[sid]?.[toDay];
        if (!Array.isArray(fromList) || !Array.isArray(toList)) return;
      
        const fromId = this.dragState.instanceId;
        const fromIndex = fromList.indexOf(fromId);
        if (fromIndex === -1) return;
      
        // Dropzone drop = append to end of target column
        const toIndex = toList.length;
      
        this.moveInstanceAcrossDays(sid, fromDay, toDay, fromIndex, toIndex);
      
        // cleanup
        this.dragState.overInstanceId = null;
        this.dragState.overPos = null;
      
        try {
          document.body.classList.remove("sched-drop-above", "sched-drop-below");
        } catch (e) {}
      },
      
      onDrop(evt, studentId, dayIndex, dropOnInstanceId) {
        if (!this.dragState.dragging) return;
      
        // Same student only (Phase 2 scope)
        if (this.dragState.studentId !== studentId) return;
      
        const sid = studentId;
      
        const fromDay = Number(this.dragState.dayIndex);
        const toDay = Number(dayIndex);
      
        const fromList = this.placements?.[sid]?.[fromDay];
        const toList = this.placements?.[sid]?.[toDay];
        if (!Array.isArray(fromList) || !Array.isArray(toList)) return;
      
        const fromId = this.dragState.instanceId;
        const toId = dropOnInstanceId;
      
        const fromIndex = fromList.indexOf(fromId);
        const hoverIndex = toList.indexOf(toId);
      
        if (fromIndex === -1 || hoverIndex === -1) return;
      
        // Insert ABOVE or BELOW the hovered card
        let insertAt = hoverIndex + (this.dragState.overPos === "below" ? 1 : 0);
      
        // If moving within the same list, removing first shifts indices
        if (fromDay === toDay && fromIndex < insertAt) {
          insertAt = Math.max(0, insertAt - 1);
        }
      
        this.moveInstanceAcrossDays(sid, fromDay, toDay, fromIndex, insertAt);
      
        // cleanup
        this.dragState.overInstanceId = null;
        this.dragState.overPos = null;
      
        try {
          document.body.classList.remove("sched-drop-above", "sched-drop-below");
        } catch (e) {}
      },

      // Render helpers
      instancesFor(studentId, dayIndex) {
        this.ensureStudent(studentId);
        const ids = this.placements[studentId][dayIndex] || [];
        return ids
          .map((id) => this.instancesById[id])
          .filter(Boolean);
      },

      templateForInstance(inst) {
        return inst ? this.templatesById?.[inst.templateId] : null;
      },

      
      // Inline style helper for schedule board cards
      // Used by schedule.html: :style="boardCardInlineStyle(inst)"
      // When time-scaled mode is ON, we set a CSS variable that drives exact 5-minute slot heights.
      boardCardInlineStyle(inst) {
        if (!this.boardScaleByTime) return "";
        const tpl = this.templateForInstance(inst) || {};
        const mRaw = Number(tpl.minutes || 0);
        const minutes = Number.isFinite(mRaw) ? mRaw : 0;

        // 5-minute slots (5m => 1, 10m => 2, 15m => 3, etc.)
        const slots = Math.max(1, Math.ceil(Math.max(5, minutes) / 5));

        // CSS will do: height = slots * var(--time-slot-h)
        return `--time-slots:${slots};`;
      },

dayTotalMinutes(studentId, dayIndex) {
        const list = this.instancesFor(studentId, dayIndex);
        let total = 0;
        for (const inst of list) {
          const tpl = this.templateForInstance(inst);
          const m = Number(tpl?.minutes || 0);
          if (Number.isFinite(m)) total += m;
        }
        return total;
      },

      formatMinutes(mins) {
          const total = Math.max(0, Math.round(Number(mins) || 0));
          const h = Math.floor(total / 60);
          const m = total % 60;
          if (h <= 0) return `${m}m`;
          if (m === 0) return `${h}h`;
          return `${h}h ${m}m`;
        },

      trackingBlocks(tpl) {
        const isCustom = String(tpl?.id || "").startsWith("u:");
        // Older cached custom cards may lack trackingCount; treat as 12 by default.
        const raw = (tpl?.trackingCount == null || tpl?.trackingCount === "") && isCustom ? 12 : tpl?.trackingCount;
        const n = Number(raw || 0);
        if (!Number.isFinite(n) || n <= 0) return "";
        return "⬚".repeat(Math.min(n, 20)); // cap display; real rendering later
      },

      // Picture Study choice
      setPictureStudyBand(band) {
        if (!this.choices.courseOptions) this.choices.courseOptions = {};
        this.choices.courseOptions["picture-study"] = band;
        this.persistCards();
      },

      // Custom card (minimal v2.5)
      addCustomCard() {
        this.openCustomCardModal("create");
      },

      removeCustomTemplate(templateId) {
        if (!templateId || !String(templateId).startsWith("u:")) return;
      
        const tpl = this.templatesById?.[templateId];
        if (!tpl) return;
      
        const ok = confirm(`Remove custom card "${tpl.title}"?\n\nThis will also remove it from any days it was added to.`);
        if (!ok) return;
      
        // 1) remove the template
        delete this.templatesById[templateId];
      
        // 2) remove any instances that reference this template
        const doomedInstanceIds = [];
        for (const [instId, inst] of Object.entries(this.instancesById || {})) {
          if (inst?.templateId === templateId) doomedInstanceIds.push(instId);
        }
        for (const instId of doomedInstanceIds) delete this.instancesById[instId];
      
        // 3) remove those instances from placements
        for (const [studentId, daysObj] of Object.entries(this.placements || {})) {
          for (let d = 0; d <= 4; d++) {
            const arr = daysObj?.[d];
            if (!Array.isArray(arr)) continue;
            this.placements[studentId][d] = arr.filter((id) => !doomedInstanceIds.includes(id));
          }
        }
      
        this.persistCards();
      },

      // -----------------------------
      // Workspace height (rail + board)
      // -----------------------------
      setWorkspaceHeight(px) {
        const h = Math.round(Number(px) || 0);
        if (!h) return;
        document.documentElement.style.setProperty("--sched-workspace-h", `${h}px`);
      },

      getWorkspaceHeightPx() {
        // IMPORTANT: workspace height should be driven by the schedule BOARD content,
        // not the rail list (the rail can be "endless" when unfiltered).
        const board = document.querySelector(".schedule-board");
        if (board) {
          // scrollHeight captures the full content height of the board columns
          return Math.round(board.scrollHeight || board.getBoundingClientRect().height || 0);
        }

        // fallback
        const work = document.querySelector(".sched-work");
        if (!work) return 0;
        return Math.round(work.getBoundingClientRect().height || 0);
      },

      initWorkspaceResizer() {
        const handle = document.getElementById("schedWorkspaceResize");
        const work = document.querySelector(".sched-work");
        if (!handle || !work) return;

        // restore saved height if available
        const saved = window.localStorage ? localStorage.getItem(WORKSPACE_H_KEY) : null;
        if (saved) {
          const px = parseInt(saved, 10);
          if (Number.isFinite(px) && px > 0) this.setWorkspaceHeight(px);
        }

        setTimeout(() => {
          try {
            const px = this.getWorkspaceHeightPx();
            if (px) this.setWorkspaceHeight(px);
          } catch (e) {}
        }, 0);

        const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

        const commit = () => {
          try {
            const px = this.getWorkspaceHeightPx();
            if (px) localStorage.setItem(WORKSPACE_H_KEY, String(px));
          } catch (e) {}
        };

        // pointer drag (vertical)
        let startY = 0;
        let startH = 0;

        const onMove = (e) => {
          const dy = e.clientY - startY;
          const next = clamp(startH + dy, 420, 2600);
          this.setWorkspaceHeight(next);
        };

        const onUp = () => {
          document.body.classList.remove("is-resizing-workspace");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          commit();
        };

        handle.addEventListener("pointerdown", (e) => {
          // only left click / primary touch
          if (e.button !== undefined && e.button !== 0) return;
          e.preventDefault();
          startY = e.clientY;
          startH = this.getWorkspaceHeightPx() || Math.round(work.getBoundingClientRect().height || 0);
          document.body.classList.add("is-resizing-workspace");
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp, { once: true });
        });

        // keyboard nudge (accessibility)
        handle.addEventListener("keydown", (e) => {
          const step = e.shiftKey ? 60 : 20;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            this.setWorkspaceHeight(clamp(this.getWorkspaceHeightPx() + step, 420, 2600));
            commit();
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            this.setWorkspaceHeight(clamp(this.getWorkspaceHeightPx() - step, 420, 2600));
            commit();
          }
        });
      },
      
    };
  };
})();
