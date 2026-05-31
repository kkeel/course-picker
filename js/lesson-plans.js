const LESSON_PLANS_SCRIPT_URL =
  document.currentScript?.src || "./js/lesson-plans.js";

async function getLessonPlansAuth_() {
  if (window.AlvearyAuth?.whoami) {
    return window.AlvearyAuth.whoami();
  }

  const authModuleUrl = new URL("auth.js", LESSON_PLANS_SCRIPT_URL).href;
  const auth = await import(authModuleUrl);

  return auth.whoami();
}

function showLessonPlansAuthGate_() {
  document.body.classList.remove("is-auth-checking");

  const main = document.querySelector("main.directory-shell");
  if (!main) return;

  main.classList.add("lesson-plans-gate-shell");

  main.innerHTML = `
    <section class="lesson-plans-member-gate">
      <h2 class="section-title">Lesson Plans</h2>

      <div class="mt-6 p-6 rounded-lg border border-[#d2d6d2] bg-white max-w-2xl">
        <p class="text-sm text-[#596e5e] mb-4">
          This lesson plan directory is available to Alveary members.
        </p>

        <button
          type="button"
          class="auth-button text-sm px-4 py-2 rounded border border-[#596e5e] text-[#596e5e] hover:bg-[#596e5e] hover:text-white transition"
          id="lessonPlansLoginButton"
        >
          Sign in to view lesson plans
        </button>
      </div>
    </section>
  `;

  document.getElementById("lessonPlansLoginButton")?.addEventListener("click", async () => {
    await window.AlvearyAuth?.openAuth?.("LOGIN");
    window.location.reload();
  });
}

async function requireLessonPlansMemberAccess_() {
  try {
    const auth = await getLessonPlansAuth_();
    const role = String(auth?.role || "public").toLowerCase();

    if (role === "member" || role === "staff") {
      document.body.classList.remove("is-auth-checking");
      setLessonLoadingMessage("Loading lesson plan options…");
      return true;
    }
  } catch (error) {
    console.warn("Lesson Plans auth check failed", error);
  }

  showLessonPlansAuthGate_();
  return false;
}

const DIRECTORY_INDEX_URL = "./data/lesson-plans-index.json";

const STORAGE_KEYS = {
  introCollapsed: "lessonPlansIntroCollapsed",
  filtersCollapsed: "lessonPlansFiltersCollapsed",
  memberTools: "lessonPlansMemberTools",
  uiPrefsInitialized: "lessonPlansUiPrefsInitialized",
  memberFilters: "lessonPlansMemberFilters",
  selectedPlanningTag: "lessonPlansSelectedPlanningTag",
  selectedStudent: "lessonPlansSelectedStudent",
  query: "lessonPlansQuery",
  base: "lessonPlansBase",
  selectedId: "lessonPlansSelectedId",
  selectedCourse: "lessonPlansSelectedCourse",
  selectedTopic: "lessonPlansSelectedTopic",
  selectedTrack: "lessonPlansSelectedTrack",
  openTopics: "lessonPlansOpenTopics",
  closedTopics: "lessonPlansClosedTopics",
};

const SUBJECT_ORDER = [
  "Architecture",
  "Art",
  "Bible",
  "Citizenship",
  "English",
  "Geography",
  "History",
  "Latin",
  "Life Skills",
  "Literature",
  "Math",
  "Modern Language",
  "Music",
  "Physical Education",
  "Science",
  "Alt. Science Options",
];

const state = {
  allRows: [],
  masterRows: [],
  rows: [],
  courses: [],
  topics: [],
  groups: [],
  indexViews: {},

  query: "",

  base: "subject",
  selectedId: "",
  selectedCourse: "",
  selectedTopic: "",
  selectedTrack: "",

  selectedPlanningTag: "",
  selectedStudent: "",

  activeView: "topic",

  memberToolsEnabled: false,
  memberFilters: {
    myCourses: false,
    students: false,
    planningTags: false,
  },

  plannerState: {
    students: [],
    studentsUpdatedAt: "",
    studentColorCursor: 0,
    courses: {},
    topics: {},
    globalTopicTags: {},
    globalTopicStudents: {},
    globalTopicNotes: {},
    extras: {},
    savedCourseRecordIds: [],
    savedTopicRecordIds: [],
    bookFilterIndex: null,
  },

  openTools: new Set(),
  openTopics: new Set(),
  closedTopics: new Set(),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizeStudentId(value) {
  const v = String(value || "").trim();
  if (!v) return "";

  if (/^s_\d+(?:_[A-Za-z0-9]+)?$/.test(v)) return v;

  if (/^s[A-Za-z0-9]+$/.test(v)) {
    const body = v.slice(1);
    const digitPrefix = (body.match(/^\d+/) || [""])[0];

    if (digitPrefix.length >= 13) {
      const first = digitPrefix.slice(0, 13);
      const rest = body.slice(13);
      return rest ? `s_${first}_${rest}` : `s_${first}`;
    }
  }

  return v;
}

function firstValue(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeId(value) {
  return String(value || "").trim();
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();

  (Array.isArray(values) ? values : []).forEach((value) => {
    const v = normalizeId(value);
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });

  return out;
}

function bookFilterIndexItems() {
  if (Array.isArray(state.plannerState.bookFilterIndex?.items)) {
    return state.plannerState.bookFilterIndex.items;
  }

  if (Array.isArray(state.plannerState.bookFilterIndex?.groups)) {
    return state.plannerState.bookFilterIndex.groups.flatMap((group) => group.items || []);
  }

  return [];
}

async function loadBookFilterIndexForPlannerLookups() {
  if (state.plannerState.bookFilterIndex) return;

  try {
    const response = await fetch("./data/book-views/master.json");
    if (!response.ok) throw new Error("Could not load book master index");

    state.plannerState.bookFilterIndex = await response.json();
  } catch (error) {
    console.warn("Could not load book master index for lesson plan planner lookups", error);
  }
}

function idParts(id) {
  return String(id || "").trim().split(".");
}

function parentCourseIdFromTopicId(topicId) {
  const parts = idParts(topicId);
  return parts.length >= 3 ? parts.slice(0, 3).join(".") : "";
}

function getCourseLegacyFromLookup(courseRecordId) {
  const id = normalizeId(courseRecordId);
  if (!id) return "";

  for (const item of bookFilterIndexItems()) {
    if (normalizeId(item.id) === id) {
      return normalizeId(item.Sort_ID || item.sortId || item.courseId || item.legacyId);
    }
  }

  return "";
}

function getCourseStateKeys(row) {
  const legacyFromLookup = getCourseLegacyFromLookup(row?.id || row?.courseRecordId || row?.recordID);

  return uniqueStrings([
    row?.Sort_ID,
    row?.sortId,
    row?.legacyId,
    row?.courseLegacyId,
    legacyFromLookup,
    row?.courseId,
    row?.id,
    row?.courseRecordId,
    row?.recordID,
  ]);
}

function getCourseStateForRow(row) {
  const courses = state.plannerState.courses || {};

  for (const key of getCourseStateKeys(row)) {
    if (courses[key]) return courses[key];
  }

  return null;
}

function getTopicLegacyId(row) {
  return firstValue(
    row?.Topic_ID,
    row?.topicId,
    row?.topic_id,
    row?.legacyId,
    row?.topicLegacyId
  );
}

function getTopicRecordId(row) {
  return firstValue(
    row?.id,
    row?.topicRecordId,
    row?.recordID,
    row?.topicAirtableRecordId,
    row?.recordId
  );
}

function getTopicInstanceKeys(row) {
  const topicLegacyId = getTopicLegacyId(row);
  const topicRecordId = getTopicRecordId(row);

  const courseLegacyFromLookup = getCourseLegacyFromLookup(
    row?.courseId || row?.courseRecordId
  );

  const courseKeys = uniqueStrings([
    row?.courseLegacyId,
    courseLegacyFromLookup,
    row?.courseId,
    row?.courseRecordId,
  ]);

  const topicKeys = uniqueStrings([
    topicLegacyId,
    topicRecordId,
  ]);

  const keys = [];

  for (const courseKey of courseKeys) {
    for (const topicKey of topicKeys) {
      if (courseKey && topicKey) keys.push(`${courseKey}::${topicKey}`);
    }
  }

  return uniqueStrings(keys);
}

function getTopicStateForRow(row) {
  const topics = state.plannerState.topics || {};

  for (const key of getTopicInstanceKeys(row)) {
    if (topics[key]) return topics[key];
  }

  return null;
}

function getSavedCourseIdsForReading() {
  const extras = state.plannerState.extras || {};

  return new Set([
    ...(extras.myCourses || []),
    ...(extras.courseSelections || []),
  ].map(firstValue));
}

function getSavedTopicInstanceKeysForReading() {
  const extras = state.plannerState.extras || {};

  return new Set([
    ...(extras.myTopics || []),
    ...(extras.topicSelections || []),
    ...Object.entries(state.plannerState.topics || {})
      .filter(([, value]) => value?.isBookmarked)
      .map(([key]) => key),
  ].map(firstValue));
}

function getTopicsForCourse(courseRow) {
  if (!courseRow || courseRow.rowType !== "course") return [];

  return state.topics.filter((topic) => topic.courseId === courseRow.id);
}

function courseHasAllTopicsBookmarked(courseRow) {
  const topics = getTopicsForCourse(courseRow);
  if (!topics.length) return false;

  return topics.every((topic) => getMemberRecordForRow(topic).isBookmarked);
}

function getMemberRecordForRow(row) {
  const planner = state.plannerState || {};

  if (row?.rowType === "topic") {
    const topicLegacyId = getTopicLegacyId(row);
    const topicState = getTopicStateForRow(row);

    const isBookmarked =
      !!topicState?.isBookmarked ||
      getTopicInstanceKeys(row).some((key) =>
        getSavedTopicInstanceKeysForReading().has(key)
      );

    return {
      isBookmarked,
      tags: [
        ...(Array.isArray(topicState?.tags) ? topicState.tags : []),
      ],
      students: [
        ...(Array.isArray(topicState?.students) ? topicState.students : []),
      ].map(normalizeStudentId),
      noteText: planner.globalTopicNotes?.[topicLegacyId] || "",
    };
  }

  const courseState = getCourseStateForRow(row);
  const savedCourses = getSavedCourseIdsForReading();
  
  return {
    isBookmarked:
      !!courseState?.isBookmarked ||
      getCourseStateKeys(row).some((key) => savedCourses.has(key)) ||
      courseHasAllTopicsBookmarked(row),
    tags: Array.isArray(courseState?.tags) ? courseState.tags : [],
    students: Array.isArray(courseState?.students)
      ? courseState.students.map(normalizeStudentId)
      : [],
    noteText: courseState?.noteText || "",
  };
}

function planningTagLabel(id) {
  const labels = {
    core: "Core",
    family: "Family",
    combine: "Combine",
    "high-interest": "High interest",
    additional: "Additional",
  };

  return labels[id] || id;
}

function subjectColor(subject) {
  return (
    window.ALVEARY_CONFIG?.subjectColors?.[subject] ||
    "#596e5e"
  );
}

function isCourseFullyBookmarked(item) {
  return item?.rowType === "course" && courseHasAllTopicsBookmarked(item);
}

function renderBookmarkIndicator(item) {
  if (!state.memberToolsEnabled) return "";

  const member = getMemberRecordForRow(item);
  if (!member.isBookmarked) return "";

  const color = subjectColor(item.subject);

  if (item.rowType === "course" && item.hasTopics) {
    const allBookmarked = isCourseFullyBookmarked(item);

    return `
      <div class="lesson-bookmark-stack">
        <span
          class="quick-enroll-btn quick-enroll-btn--active lesson-bookmark-display"
          style="background-color:${escapeHtml(color)}4D; border-color:${escapeHtml(color)}; color:${escapeHtml(color)};"
          aria-label="${allBookmarked ? "All topics bookmarked" : "Bookmarked course"}"
        >
          <img src="img/icons/bookmark-active.svg" alt="" class="bookmark-icon" />
        </span>

        ${
          allBookmarked
            ? `
              <span
                class="quick-enroll-label quick-enroll-label--active"
                style="background-color:${escapeHtml(color)};"
              >
                All
              </span>
            `
            : ""
        }
      </div>
    `;
  }

  return `
    <span
      class="bookmark-btn bookmark-btn--solid lesson-bookmark-display"
      style="background-color:${escapeHtml(color)};"
      aria-label="Bookmarked"
    >
      <img src="img/icons/bookmark-active.svg" alt="" class="bookmark-icon" />
    </span>
  `;
}

function getStudentById(id) {
  const sid = normalizeStudentId(id);
  return (state.plannerState.students || []).find(
    (student) => normalizeStudentId(student.id) === sid
  );
}

function studentColorPalette() {
  const colors = [];
  const seen = new Set();

  Object.values(window.ALVEARY_CONFIG?.subjectColors || {}).forEach((color) => {
    const c = String(color || "").trim();
    if (!c) return;

    const key = c.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    colors.push(c);
  });

  [
    "#556F8C",
    "#7F3A82",
    "#C67894",
    "#B9355C",
    "#5A5D66",
  ].forEach((color) => {
    const key = color.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    colors.push(color);
  });

  return colors;
}

function nextStudentColor() {
  const palette = studentColorPalette();
  if (!palette.length) return "#9eaa99";

  const index = Number(state.plannerState.studentColorCursor || 0);
  const color = palette[index % palette.length];

  state.plannerState.studentColorCursor = index + 1;

  return color;
}

function resolveLessonPlannerStorageKey() {
  try {
    if (window.PLANNER_STATE_KEY) return window.PLANNER_STATE_KEY;
  } catch {}

  try {
    const keys = [];

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith("alveary_planner_")) keys.push(key);
    }

    keys.sort();
    return keys.length ? keys[keys.length - 1] : null;
  } catch {
    return null;
  }
}

function getLessonPlannerLocalState() {
  try {
    const key = resolveLessonPlannerStorageKey();
    if (!key) return {};

    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function buildLessonPlannerRootState(existingState = {}) {
  const existing =
    existingState && typeof existingState === "object"
      ? existingState
      : {};

  const {
    bookFilterIndex,
    rows,
    groups,
    allRows,
    indexViews,
    ...safeExisting
  } = existing;
  
  return {
    ...safeExisting,

    version:
      window.APP_CACHE_VERSION ||
      existing.version ||
      "2025-12-09-v1",

    globalTopicTags: state.plannerState.globalTopicTags || existing.globalTopicTags || {},
    globalTopicNotes: state.plannerState.globalTopicNotes || existing.globalTopicNotes || {},
    globalTopicStudents:
      state.plannerState.globalTopicStudents || existing.globalTopicStudents || {},

    students: (state.plannerState.students || []).slice(0, 15).map((student) => ({
      ...student,
      id: normalizeStudentId(student.id),
    })),

    studentsUpdatedAt: new Date().toISOString(),

    studentColorCursor:
      typeof state.plannerState.studentColorCursor === "number"
        ? state.plannerState.studentColorCursor
        : existing.studentColorCursor || 0,

    studentRailCollapsed:
      state.plannerState.studentRailCollapsed ||
      existing.studentRailCollapsed ||
      {},

    courses: state.plannerState.courses || existing.courses || {},
    topics: state.plannerState.topics || existing.topics || {},
    extras: state.plannerState.extras || existing.extras || {},
  };
}

function writeLessonPlannerStateToLocalStorage(nextState = null) {
  try {
    const key = resolveLessonPlannerStorageKey();
    if (!key) return null;

    const finalState = nextState || buildLessonPlannerRootState(getLessonPlannerLocalState());

    localStorage.setItem(key, JSON.stringify(finalState));
    return finalState;
  } catch (error) {
    console.warn("Could not write lesson planner state locally", error);
    return null;
  }
}

let lessonStudentSaveTimer = null;

function saveLessonPlannerStateDebounced() {
  if (lessonStudentSaveTimer) clearTimeout(lessonStudentSaveTimer);

  lessonStudentSaveTimer = setTimeout(async () => {
    try {
      const nextState = buildLessonPlannerRootState(getLessonPlannerLocalState());

      state.plannerState = {
        ...state.plannerState,
        ...nextState,
        bookFilterIndex: state.plannerState.bookFilterIndex,
      };

      writeLessonPlannerStateToLocalStorage(nextState);

      window.dispatchEvent(
        new CustomEvent("alveary:planner-updated", {
          detail: {
            source: "lesson-plans-student-manager",
            studentsUpdatedAt: nextState.studentsUpdatedAt,
          },
        })
      );

      if (window.AlvearyAuth?.setPlannerState) {
        const result = await window.AlvearyAuth.setPlannerState(nextState);

        if (!result?.ok) {
          console.warn("Lesson Plans student save did not confirm", result);
        } else {
          console.log("Lesson Plans student save confirmed", result);
        }
      }
    } catch (error) {
      console.warn("Could not save lesson plan student state", error);
    }
  }, 350);
}

function removeStudentIdFromPlannerAssignments(studentId) {
  const sid = normalizeStudentId(studentId);
  if (!sid) return;

  const cleanArray = (list) =>
    Array.isArray(list)
      ? list.map(normalizeStudentId).filter((id) => id && id !== sid)
      : [];

  Object.values(state.plannerState.courses || {}).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    entry.students = cleanArray(entry.students);
  });

  Object.values(state.plannerState.topics || {}).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    entry.students = cleanArray(entry.students);
  });

  Object.keys(state.plannerState.globalTopicStudents || {}).forEach((topicId) => {
    const next = cleanArray(state.plannerState.globalTopicStudents[topicId]);

    if (next.length) {
      state.plannerState.globalTopicStudents[topicId] = next;
    } else {
      delete state.plannerState.globalTopicStudents[topicId];
    }
  });

  if (state.selectedStudent === sid) {
    state.selectedStudent = "";
  }
}

function renderStudentManagerModal() {
  const body = document.getElementById("lesson-student-modal-body");
  if (!body) return;

  const students = Array.isArray(state.plannerState.students)
    ? state.plannerState.students
    : [];

  const palette = studentColorPalette();

  body.innerHTML = `
    <div class="lesson-student-manager">
      <div class="lesson-student-list">
        ${
          students.length
            ? students.map((student) => `
              <div class="lesson-student-row" data-student-id="${escapeHtml(normalizeStudentId(student.id))}">
                <button
                  type="button"
                  class="student-color-btn"
                  data-student-color-toggle
                  style="background-color:${escapeHtml(student.color || "#9eaa99")};"
                  aria-label="Choose student color"
                  title="Choose color"
                ></button>

                <input
                  class="student-name-input"
                  type="text"
                  data-student-name-input
                  value="${escapeHtml(student.name || "")}"
                  placeholder="Student name"
                />

                <button
                  type="button"
                  class="student-remove-x"
                  data-student-remove
                  aria-label="Remove student"
                  title="Remove"
                >
                  ×
                </button>

                <div class="student-swatches" data-student-swatches hidden>
                  ${palette.map((color) => `
                    <button
                      type="button"
                      class="student-swatch ${String(student.color || "").toLowerCase() === color.toLowerCase() ? "student-swatch--selected" : ""}"
                      data-student-swatch="${escapeHtml(color)}"
                      style="background-color:${escapeHtml(color)};"
                      aria-label="Set color ${escapeHtml(color)}"
                    ></button>
                  `).join("")}
                </div>
              </div>
            `).join("")
            : `<p class="lesson-student-empty">No students yet. Add your first student below.</p>`
        }
      </div>

      <div class="student-add-row">
        <input
          id="lesson-new-student-name"
          class="student-name-input"
          type="text"
          placeholder="Add a student…"
        />

        <button
          id="lesson-add-student"
          type="button"
          class="student-row-btn"
          ${students.length >= 15 ? "disabled" : ""}
        >
          Add
        </button>
      </div>
    </div>
  `;
}

function openStudentManagerModal() {
  const modal = document.getElementById("lesson-student-modal");
  if (!modal) return;

  renderStudentManagerModal();

  modal.hidden = false;
  document.body.classList.add("lesson-student-modal-open");

  setTimeout(() => {
    document.getElementById("lesson-new-student-name")?.focus();
  }, 0);
}

function closeStudentManagerModal() {
  const modal = document.getElementById("lesson-student-modal");
  if (!modal) return;

  modal.hidden = true;
  document.body.classList.remove("lesson-student-modal-open");
  document.getElementById("manage-students-button")?.focus();
}

function addLessonStudent() {
  const input = document.getElementById("lesson-new-student-name");
  const name = String(input?.value || "").trim();

  if (!name) return;

  const students = Array.isArray(state.plannerState.students)
    ? state.plannerState.students
    : [];

  if (students.length >= 15) return;

  const id = `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  state.plannerState.students = [
    ...students,
    {
      id,
      name,
      color: nextStudentColor(),
    },
  ];

  populateMemberFilters();
  render();
  renderStudentManagerModal();
  saveLessonPlannerStateDebounced();
}

function updateLessonStudentName(studentId, name) {
  const sid = normalizeStudentId(studentId);

  state.plannerState.students = (state.plannerState.students || []).map((student) =>
    normalizeStudentId(student.id) === sid
      ? {
          ...student,
          id: sid,
          name,
        }
      : student
  );

  populateMemberFilters();
  render();
  saveLessonPlannerStateDebounced();
}

function updateLessonStudentColor(studentId, color) {
  const sid = normalizeStudentId(studentId);

  state.plannerState.students = (state.plannerState.students || []).map((student) =>
    normalizeStudentId(student.id) === sid
      ? {
          ...student,
          id: sid,
          color,
        }
      : student
  );

  populateMemberFilters();
  render();
  renderStudentManagerModal();
  saveLessonPlannerStateDebounced();
}

function removeLessonStudent(studentId) {
  const sid = normalizeStudentId(studentId);
  if (!sid) return;

  state.plannerState.students = (state.plannerState.students || []).filter(
    (student) => normalizeStudentId(student.id) !== sid
  );

  removeStudentIdFromPlannerAssignments(sid);

  populateMemberFilters();
  render();
  renderStudentManagerModal();
  saveLessonPlannerStateDebounced();
}

function setupStudentManagerModal() {
  const openButton = document.getElementById("manage-students-button");
  const modal = document.getElementById("lesson-student-modal");

  openButton?.addEventListener("click", openStudentManagerModal);

  modal?.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-close-student-modal]");
    if (closeButton) {
      closeStudentManagerModal();
      return;
    }

    const row = event.target.closest("[data-student-id]");
    const studentId = row?.dataset?.studentId || "";

    if (event.target.closest("[data-student-color-toggle]")) {
      const swatches = row.querySelector("[data-student-swatches]");
      if (swatches) swatches.hidden = !swatches.hidden;
      return;
    }

    const swatch = event.target.closest("[data-student-swatch]");
    if (swatch) {
      updateLessonStudentColor(studentId, swatch.dataset.studentSwatch);
      return;
    }

    if (event.target.closest("[data-student-remove]")) {
      removeLessonStudent(studentId);
      return;
    }

    if (event.target.closest("#lesson-add-student")) {
      addLessonStudent();
    }
  });

  modal?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-student-name-input]");
    if (!input) return;

    const row = input.closest("[data-student-id]");
    updateLessonStudentName(row?.dataset?.studentId, input.value);
  });

  modal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeStudentManagerModal();
      return;
    }

    if (
      event.key === "Enter" &&
      event.target?.id === "lesson-new-student-name"
    ) {
      event.preventDefault();
      addLessonStudent();
    }
  });
}

function getUrlState() {
  const params = new URLSearchParams(window.location.search);

  return {
    base: params.get("base") || "subject",
    id: params.get("id") || "",
    course: params.get("course") || "",
    topic: params.get("topic") || "",
    track: params.get("track") || "",
  };
}

function updateUrl() {
  const params = new URLSearchParams();

  params.set("base", state.base);

  if (state.selectedId) {
    params.set("id", state.selectedId);
  }

  if (state.selectedCourse) {
    params.set("course", state.selectedCourse);
  }

  if (state.selectedTopic) {
    params.set("topic", state.selectedTopic);
  }

  if (state.selectedTrack) {
    params.set("track", state.selectedTrack);
  }

  const newUrl = `${window.location.pathname}?${params.toString()}`;

  window.history.replaceState({}, "", newUrl);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function populatePrimarySelect() {
  const select = document.getElementById("primary-select");

  if (state.base === "grade") {
    select.innerHTML = `
      <option value="">All Grades</option>
      ${Array.from({ length: 12 }, (_, i) => {
        const grade = `G${i + 1}`;
        return `<option value="${grade}">Grade ${i + 1}</option>`;
      }).join("")}
    `;
  } else {
    const subjectsInRows = new Set(
      state.allRows.map((row) => row.subject).filter(Boolean)
    );
    
    const subjects = [
      ...SUBJECT_ORDER.filter((subject) => subjectsInRows.has(subject)),
      ...uniqueSorted(
        [...subjectsInRows].filter((subject) => !SUBJECT_ORDER.includes(subject))
      ),
    ];

    select.innerHTML = `
      <option value="">All Subjects</option>
      ${subjects
        .map(
          (value) =>
            `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
        )
        .join("")}
    `;
  }

  select.value = state.selectedId;
}

function populateCourseFilter() {
  const select = document.getElementById("course-filter");

  const courseRows = state.rows.filter(
    (row) => row.rowType === "course"
  );

  const courses = [];

  for (const row of courseRows) {
    if (!rowMatchesTrack(row)) continue;

    const title = row.lessonSetName || row.title;

    if (!courses.includes(title)) {
      courses.push(title);
    }
  }

  select.innerHTML = `
    <option value="">All courses</option>
    ${courses
      .map(
        (value) =>
          `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
      )
      .join("")}
  `;

  select.value = state.selectedCourse;
}

function populateTopicFilter() {
  const select = document.getElementById("topic-filter");

  let topicRows = state.rows.filter(
    (row) => row.rowType === "topic"
  );

  if (state.selectedCourse) {
    topicRows = topicRows.filter(
      (row) => row.courseTitle === state.selectedCourse
    );
  }

  const topics = [];

  for (const row of topicRows) {
    if (!rowMatchesTrack(row)) continue;

    const title = row.lessonSetName || row.title;

    if (!topics.includes(title)) {
      topics.push(title);
    }
  }

  select.innerHTML = `
    <option value="">All topics</option>
    ${topics
      .map(
        (value) =>
          `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
      )
      .join("")}
  `;

  select.value = state.selectedTopic;
}

function lessonHasSavedCourseData() {
  const planner = state.plannerState || {};

  const hasCourseBookmarks = Object.values(planner.courses || {}).some(
    (entry) => entry?.isBookmarked
  );

  const hasTopicBookmarks = Object.values(planner.topics || {}).some(
    (entry) => entry?.isBookmarked
  );

  const extras = planner.extras || {};

  return (
    hasCourseBookmarks ||
    hasTopicBookmarks ||
    (extras.myCourses || []).length ||
    (extras.courseSelections || []).length ||
    (extras.myTopics || []).length ||
    (extras.topicSelections || []).length
  );
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveTopicOpenPrefs() {
  localStorage.setItem(STORAGE_KEYS.openTopics, JSON.stringify([...state.openTopics]));
  localStorage.setItem(STORAGE_KEYS.closedTopics, JSON.stringify([...state.closedTopics]));
}

function applySavedTopicOpenPrefs() {
  state.openTopics = new Set(readJsonStorage(STORAGE_KEYS.openTopics, []));
  state.closedTopics = new Set(readJsonStorage(STORAGE_KEYS.closedTopics, []));
}

function saveLessonUiPrefs() {
  localStorage.setItem(STORAGE_KEYS.memberTools, String(state.memberToolsEnabled));
  localStorage.setItem(STORAGE_KEYS.memberFilters, JSON.stringify(state.memberFilters));
  localStorage.setItem(STORAGE_KEYS.selectedPlanningTag, state.selectedPlanningTag || "");
  localStorage.setItem(STORAGE_KEYS.selectedStudent, state.selectedStudent || "");
  localStorage.setItem(STORAGE_KEYS.query, state.query || "");
  localStorage.setItem(STORAGE_KEYS.base, state.base || "subject");
  localStorage.setItem(STORAGE_KEYS.selectedId, state.selectedId || "");
  localStorage.setItem(STORAGE_KEYS.selectedCourse, state.selectedCourse || "");
  localStorage.setItem(STORAGE_KEYS.selectedTopic, state.selectedTopic || "");
  localStorage.setItem(STORAGE_KEYS.selectedTrack, state.selectedTrack || "");
}

function applySavedLessonUiPrefs() {
  state.memberFilters = {
    ...state.memberFilters,
    ...readJsonStorage(STORAGE_KEYS.memberFilters, {}),
  };

  state.selectedPlanningTag = localStorage.getItem(STORAGE_KEYS.selectedPlanningTag) || "";
  state.selectedStudent = localStorage.getItem(STORAGE_KEYS.selectedStudent) || "";
  state.query = localStorage.getItem(STORAGE_KEYS.query) || "";
  state.base = localStorage.getItem(STORAGE_KEYS.base) || state.base || "subject";
  state.selectedId = localStorage.getItem(STORAGE_KEYS.selectedId) || "";
  state.selectedCourse = localStorage.getItem(STORAGE_KEYS.selectedCourse) || "";
  state.selectedTopic = localStorage.getItem(STORAGE_KEYS.selectedTopic) || "";
  state.selectedTrack = localStorage.getItem(STORAGE_KEYS.selectedTrack) || "";
}

function applySmartFirstVisitDefaults() {
  if (localStorage.getItem(STORAGE_KEYS.uiPrefsInitialized) === "true") return;

  const hasSavedCourses = lessonHasSavedCourseData();

  if (hasSavedCourses) {
    localStorage.setItem(STORAGE_KEYS.memberTools, "true");
    localStorage.setItem(STORAGE_KEYS.filtersCollapsed, "true");

    state.memberToolsEnabled = true;
    state.memberFilters = {
      myCourses: true,
      students: false,
      planningTags: false,
    };
  } else {
    localStorage.setItem(STORAGE_KEYS.memberTools, "false");
    localStorage.setItem(STORAGE_KEYS.filtersCollapsed, "false");

    state.memberToolsEnabled = false;
    state.memberFilters = {
      myCourses: false,
      students: false,
      planningTags: false,
    };
  }

  localStorage.setItem(STORAGE_KEYS.introCollapsed, "false");
  localStorage.setItem(STORAGE_KEYS.memberFilters, JSON.stringify(state.memberFilters));
  localStorage.setItem(STORAGE_KEYS.uiPrefsInitialized, "true");
}

function applyIntroState() {
  const intro = document.getElementById("lesson-intro-section");
  const button = document.getElementById("toggle-intro");

  const collapsed =
    localStorage.getItem(STORAGE_KEYS.introCollapsed) === "true";

  intro.classList.toggle("is-collapsed", collapsed);

  button.textContent = collapsed ? "Show intro" : "Hide intro";
}

function applyFilterState() {
  const controls = document.getElementById("lesson-controls");
  const button = document.getElementById("toggle-filters");

  const collapsed =
    localStorage.getItem(STORAGE_KEYS.filtersCollapsed) === "true";

  controls.classList.toggle("is-collapsed", collapsed);

  button.textContent = collapsed ? "Show" : "Hide";
}

function applyMemberMiniToggleState() {
  document.querySelectorAll(".member-mini-toggle").forEach((button) => {
    const key = button.dataset.memberFilter;
    const active = !!state.memberFilters[key];

    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function applyMemberToolsState() {
  const enabled =
    localStorage.getItem(STORAGE_KEYS.memberTools) === "true";

  state.memberToolsEnabled = enabled;

  document.body.classList.toggle(
    "member-tools-enabled",
    enabled
  );

  const button = document.getElementById("member-tools-toggle");

  button.classList.toggle("is-active", enabled);

  button.setAttribute("aria-pressed", enabled ? "true" : "false");

  button.textContent = `Member Tools: ${enabled ? "On" : "Off"}`;
}

function setupGradeBundleModal() {
  const modal = document.getElementById("grade-bundle-modal");
  const openButton = document.getElementById("open-grade-bundles");

  if (!modal || !openButton) return;

  function openModal() {
    modal.hidden = false;
    document.body.classList.add("grade-bundle-modal-open");

    const closeButton = modal.querySelector("[data-close-grade-bundles]");
    if (closeButton) closeButton.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("grade-bundle-modal-open");
    openButton.focus();
  }

  openButton.addEventListener("click", openModal);

  modal.querySelectorAll("[data-close-grade-bundles]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });
}

async function loadMasterLessonRowsForBulkDownload() {
  if (state.masterRows.length) return state.masterRows;

  const masterUrl =
    state.indexViews.master ||
    "data/lesson-plan-views/master.json";

  const response = await fetch(masterUrl);
  if (!response.ok) throw new Error(`Could not load master lesson plans: ${response.status}`);

  const master = await response.json();
  state.masterRows = Array.isArray(master.rows)
    ? master.rows.filter(shouldShowLessonPlanRow)
    : [];

  return state.masterRows;
}

function setupBulkDownloadModal() {
  const modal = document.getElementById("bulk-download-modal");
  const openButton = document.getElementById("open-bulk-download");
  const formatSection = document.getElementById("bulk-download-format-section");
  const message = document.getElementById("bulk-download-message");
  const sourcePicker = document.getElementById("bulk-download-source-picker");
  const preview = document.getElementById("bulk-download-preview");

  let bulkDownloadState = {
    source: "",
    detail: "",
    format: "",
  };

  function clearPreview() {
    if (preview) {
      preview.hidden = true;
      preview.innerHTML = "";
    }
  
    const downloadButton =
      document.getElementById("bulk-download-start");
  
    if (downloadButton) {
      downloadButton.disabled = true;
      downloadButton.classList.add("is-disabled");
      downloadButton.textContent = "Download ZIP";
    }
  }

  if (!modal || !openButton) return;

  function showMessage(text) {
    if (!message) return;
    message.hidden = false;
    message.textContent = text;
  }

  function clearMessage() {
    if (!message) return;
    message.hidden = true;
    message.textContent = "";
  }

  function showFormatOptions() {
    if (formatSection) formatSection.hidden = false;
    clearMessage();
  }

  function hideFormatOptions() {
    if (formatSection) formatSection.hidden = true;
  }

  function resetModal() {
    modal.querySelectorAll('input[name="download-source"]').forEach((input) => {
      input.checked = false;
    });

    modal.querySelectorAll('input[name="download-format"]').forEach((input) => {
      input.checked = false;
    });

    hideFormatOptions();
    clearMessage();
    clearSourcePicker();
    clearPreview();

    bulkDownloadState = {
      source: "",
      detail: "",
      format: "",
    };
  }

  function openModal() {
    resetModal();
    modal.hidden = false;
    document.body.classList.add("bulk-download-modal-open");
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("bulk-download-modal-open");
    openButton.focus();
  }

  function clearSourcePicker() {
    if (!sourcePicker) return;
    sourcePicker.hidden = true;
    sourcePicker.innerHTML = "";
  }
  
  function getPlanningTagOptions() {
    const tagIds = new Set();
  
    Object.values(state.plannerState.courses || {}).forEach((entry) => {
      (entry.tags || []).forEach((tag) => tagIds.add(tag));
    });
  
    Object.values(state.plannerState.topics || {}).forEach((entry) => {
      (entry.tags || []).forEach((tag) => tagIds.add(tag));
    });
  
    Object.values(state.plannerState.globalTopicTags || {}).forEach((tags) => {
      (tags || []).forEach((tag) => tagIds.add(tag));
    });
  
    return [...tagIds].sort();
  }

  function showSourceMessage(label, note = "") {
    if (!sourcePicker) return;
  
    sourcePicker.hidden = false;
    sourcePicker.innerHTML = `
      <div class="bulk-download-picker-label">
        ${escapeHtml(label)}
      </div>
  
      ${
        note
          ? `<p class="bulk-download-picker-note">${escapeHtml(note)}</p>`
          : ""
      }
    `;
  }
  
  function showSourcePicker(label, options, note = "") {
    if (!sourcePicker) return;
  
    sourcePicker.hidden = false;
    sourcePicker.innerHTML = `
      <label class="bulk-download-picker-label" for="bulk-download-detail-select">
        ${escapeHtml(label)}
      </label>
  
      <select id="bulk-download-detail-select" class="bulk-download-picker-select">
        <option value="">Choose one</option>
        ${options.map((option) => `
          <option value="${escapeHtml(option.value)}">
            ${escapeHtml(option.label)}
          </option>
        `).join("")}
      </select>
  
      ${
        note
          ? `<p class="bulk-download-picker-note">${escapeHtml(note)}</p>`
          : ""
      }
    `;
  }

  function getBulkPreviewRows() {
    const source = bulkDownloadState.source;
    const detail = bulkDownloadState.detail;
    const format = bulkDownloadState.format;
  
    if (!source || !format) return [];
  
    if (
      (source === "grade" || source === "students" || source === "planningTags") &&
      !detail
    ) {
      return [];
    }
  
    const allRows = (state.masterRows || []).filter((row) =>
      hasLessonPdf(row) &&
      !isHiddenPdf(row) &&
      !isDelayedPdf(row)
    );
    const allCourses = allRows.filter((row) => row.rowType === "course");
    const allTopics = allRows.filter((row) => row.rowType === "topic");
  
    const courseById = new Map(
      allCourses.map((course) => [course.id, course])
    );
  
    function dedupeByPdf(rows) {
      const seen = new Set();
  
      return rows.filter((row) => {
        const url = safeLink(row?.links?.lessonPdf);
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
    }
  
    function hasStudent(row) {
      return (getMemberRecordForRow(row).students || [])
        .includes(normalizeStudentId(detail));
    }
  
    function hasPlanningTag(row) {
      return (getMemberRecordForRow(row).tags || [])
        .includes(detail);
    }
  
    function isBookmarked(row) {
      return !!getMemberRecordForRow(row).isBookmarked;
    }
  
    let fullCourseRows = [];
    let singleTopicRows = [];
  
    if (source === "grade") {
      fullCourseRows = allCourses.filter((row) =>
        Array.isArray(row.gradeTags) &&
        row.gradeTags.includes(detail)
      );
  
      singleTopicRows = allRows.filter((row) =>
        Array.isArray(row.gradeTags) &&
        row.gradeTags.includes(detail) &&
        (
          row.rowType === "topic" ||
          (row.rowType === "course" && !row.hasTopics)
        )
      );
    }
  
    if (source === "myCourses") {
      const bookmarkedCourseIds = new Set();
  
      allRows.forEach((row) => {
        if (!isBookmarked(row)) return;
  
        if (row.rowType === "course") {
          bookmarkedCourseIds.add(row.id);
        }
  
        if (row.rowType === "topic" && row.courseId) {
          bookmarkedCourseIds.add(row.courseId);
        }
      });
  
      fullCourseRows = allCourses.filter((course) =>
        bookmarkedCourseIds.has(course.id)
      );
  
      singleTopicRows = allRows.filter((row) => {
        if (!isBookmarked(row)) return false;
  
        return (
          row.rowType === "topic" ||
          (row.rowType === "course" && !row.hasTopics)
        );
      });
    }
  
    if (source === "students") {
      const assignedCourseIds = new Set();
  
      allRows.forEach((row) => {
        if (!hasStudent(row)) return;
  
        if (row.rowType === "course") {
          assignedCourseIds.add(row.id);
        }
  
        if (row.rowType === "topic" && row.courseId) {
          assignedCourseIds.add(row.courseId);
        }
      });
  
      fullCourseRows = allCourses.filter((course) =>
        assignedCourseIds.has(course.id)
      );
  
      singleTopicRows = allRows.filter((row) => {
        if (!hasStudent(row)) return false;
  
        return (
          row.rowType === "topic" ||
          (row.rowType === "course" && !row.hasTopics)
        );
      });
    }
  
    if (source === "planningTags") {
      const taggedCourseIds = new Set();
  
      allRows.forEach((row) => {
        if (!hasPlanningTag(row)) return;
  
        if (row.rowType === "course") {
          taggedCourseIds.add(row.id);
        }
  
        if (row.rowType === "topic" && row.courseId) {
          taggedCourseIds.add(row.courseId);
        }
      });
  
      fullCourseRows = allCourses.filter((course) =>
        taggedCourseIds.has(course.id)
      );
  
      singleTopicRows = allRows.filter((row) => {
        if (!hasPlanningTag(row)) return false;
  
        return (
          row.rowType === "topic" ||
          (row.rowType === "course" && !row.hasTopics)
        );
      });
    }
  
    if (format === "fullCourse") {
      return dedupeByPdf(fullCourseRows);
    }
  
    if (format === "topicPlans") {
      return dedupeByPdf(singleTopicRows);
    }
  
    return dedupeByPdf([
      ...fullCourseRows,
      ...singleTopicRows,
    ]);
  }

  function sanitizeBulkFileName(value, fallback = "Lesson Plan") {
    return String(value || fallback)
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140) || fallback;
  }
  
  function getBulkFormatLabel() {
    if (bulkDownloadState.format === "fullCourse") return "Full Course Plans";
    if (bulkDownloadState.format === "topicPlans") return "Single Topic Plans";
    if (bulkDownloadState.format === "both") return "Both";
    return "Lesson Plans";
  }
  
  function getBulkSourceLabel() {
    if (bulkDownloadState.source === "grade") {
      return `Grade ${String(bulkDownloadState.detail || "").replace("G", "")}`;
    }
  
    if (bulkDownloadState.source === "myCourses") {
      return "My Courses";
    }
  
    if (bulkDownloadState.source === "students") {
      return getStudentById(bulkDownloadState.detail)?.name || "Student";
    }
  
    if (bulkDownloadState.source === "planningTags") {
      return planningTagLabel(bulkDownloadState.detail);
    }
  
    return "Lesson Plans";
  }
  
  function getBulkZipFileName() {
    const name = sanitizeBulkFileName(
      `Alveary ${getBulkSourceLabel()} ${getBulkFormatLabel()}`
    ).replace(/\s+/g, "-");
  
    return `${name}.zip`;
  }
  
  function compareBulkRows(a, b) {
    const subjectA = SUBJECT_ORDER.indexOf(a.subject);
    const subjectB = SUBJECT_ORDER.indexOf(b.subject);
  
    const subjectOrderA = subjectA === -1 ? 999 : subjectA;
    const subjectOrderB = subjectB === -1 ? 999 : subjectB;
  
    if (subjectOrderA !== subjectOrderB) {
      return subjectOrderA - subjectOrderB;
    }
  
    const courseA = a.rowType === "topic"
      ? a.courseTitle || ""
      : a.lessonSetName || a.title || "";
  
    const courseB = b.rowType === "topic"
      ? b.courseTitle || ""
      : b.lessonSetName || b.title || "";
  
    const courseCompare = courseA.localeCompare(courseB);
    if (courseCompare) return courseCompare;
  
    const typeA = a.rowType === "course" ? 0 : 1;
    const typeB = b.rowType === "course" ? 0 : 1;
  
    if (typeA !== typeB) return typeA - typeB;
  
    return String(a.lessonSetName || a.title || "")
      .localeCompare(String(b.lessonSetName || b.title || ""));
  }
  
  function getBulkPdfFileName(row, usedFileNames) {
    let baseName = sanitizeBulkFileName(
      row.lessonSetName || row.title || "Lesson Plan"
    );
  
    let fileName = `${baseName}.pdf`;
    let index = 2;
  
    while (usedFileNames.has(fileName.toLowerCase())) {
      fileName = `${baseName} (${index}).pdf`;
      index += 1;
    }
  
    usedFileNames.add(fileName.toLowerCase());
    return fileName;
  }

  async function downloadBulkZip() {
    const rows = getBulkPreviewRows()
      .slice()
      .sort(compareBulkRows);
  
    if (!rows.length) return;
  
    const button =
      document.getElementById("bulk-download-start");
  
    if (!button) return;
  
    try {
      if (!window.JSZip) {
        throw new Error("JSZip did not load.");
      }
  
      button.disabled = true;
      button.classList.add("is-disabled");
      button.textContent = `Preparing ZIP (${rows.length})...`;
  
      const zip = new JSZip();
      const usedFileNames = new Set();
      const failedRows = [];
  
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const pdfUrl = safeLink(row?.links?.lessonPdf);
  
        button.textContent = `Downloading PDF ${i + 1} of ${rows.length}...`;
  
        if (!pdfUrl) {
          failedRows.push(row);
          continue;
        }
  
        try {
          const response = await fetch(pdfUrl);
  
          if (!response.ok) {
            failedRows.push(row);
            continue;
          }
  
          const blob = await response.blob();
          const fileName = getBulkPdfFileName(row, usedFileNames);
  
          const folderName = sanitizeBulkFileName(row.subject || "Other");
          zip.folder(folderName).file(fileName, blob);
        } catch (error) {
          console.warn("Could not add PDF to ZIP", row, error);
          failedRows.push(row);
        }
      }
  
      button.textContent = "Building ZIP...";
  
      const zipBlob =
        await zip.generateAsync({
          type: "blob"
        });
  
      const url =
        URL.createObjectURL(zipBlob);
  
      const link =
        document.createElement("a");
  
      link.href = url;
      link.download = getBulkZipFileName();
  
      document.body.appendChild(link);
      link.click();
      link.remove();
  
      URL.revokeObjectURL(url);
  
      button.textContent =
        failedRows.length
          ? `Download ZIP (${rows.length - failedRows.length}/${rows.length})`
          : `Download ZIP (${rows.length})`;
    }
    catch (error) {
      console.error(error);
      button.textContent = "Download Failed";
    }
    finally {
      button.disabled = false;
      button.classList.remove("is-disabled");
    }
  }
  
  async function updateBulkDownloadPreview() {
    if (!preview) return;
  
    try {
      await loadMasterLessonRowsForBulkDownload();
    } catch (error) {
      console.warn("Could not load bulk download master rows", error);
      clearPreview();
      return;
    }
  
    const rows = getBulkPreviewRows();

    const downloadButton =
      document.getElementById("bulk-download-start");
    
    if (downloadButton) {
      const enabled = rows.length > 0;
    
      downloadButton.disabled = !enabled;
      downloadButton.classList.toggle(
        "is-disabled",
        !enabled
      );
    
      downloadButton.textContent = enabled
        ? `Download ZIP (${rows.length})`
        : "Download ZIP";
    }
  
    if (!rows.length) {
      clearPreview();
      return;
    }
  
    const fullCourseRows = rows.filter((row) => row.rowType === "course");
    const topicRows = rows.filter((row) => row.rowType === "topic");
  
    const fullCourseCount = fullCourseRows.length;
    const topicCount = topicRows.length;
  
    const rowLabel = (row) => {
      const title = row.lessonSetName || row.title || "Untitled";
      const grade = row.gradeText ? ` — ${row.gradeText}` : "";
      const subject = row.subject ? `${row.subject}: ` : "";
  
      return `${subject}${title}${grade}`;
    };
  
    preview.hidden = false;
    preview.innerHTML = `
      <h3>Preview</h3>
  
      <div class="bulk-preview-counts">
        <div><strong>${fullCourseCount}</strong> Full Course Plans</div>
        <div><strong>${topicCount}</strong> Single Topic Plans</div>
        <div><strong>${rows.length}</strong> Unique PDFs</div>
      </div>
  
      <button
        type="button"
        class="bulk-preview-toggle"
        data-bulk-preview-toggle
      >
        Review Included PDFs ▼
      </button>
  
      <div class="bulk-preview-audit" data-bulk-preview-audit hidden>
        <div class="bulk-preview-audit-section">
          <p class="bulk-preview-audit-title">
            Full Course Plans (${fullCourseCount})
          </p>
  
          ${
            fullCourseRows.length
              ? `
                <ol class="bulk-preview-audit-list">
                  ${fullCourseRows.map((row) => `
                    <li>${escapeHtml(rowLabel(row))}</li>
                  `).join("")}
                </ol>
              `
              : `<p class="bulk-download-picker-note">No full course plans counted.</p>`
          }
        </div>
  
        <div class="bulk-preview-audit-section">
          <p class="bulk-preview-audit-title">
            Single Topic Plans (${topicCount})
          </p>
  
          ${
            topicRows.length
              ? `
                <ol class="bulk-preview-audit-list">
                  ${topicRows.map((row) => `
                    <li>${escapeHtml(rowLabel(row))}</li>
                  `).join("")}
                </ol>
              `
              : `<p class="bulk-download-picker-note">No single topic plans counted.</p>`
          }
        </div>
      </div>
    `;
  }

  function handleSourceChange(value) {
    hideFormatOptions();
    clearMessage();
    clearSourcePicker();
    bulkDownloadState.source = value;
    bulkDownloadState.detail = "";
    bulkDownloadState.format = "";
    
    modal.querySelectorAll('input[name="download-format"]').forEach((input) => {
      input.checked = false;
    });
    
    clearPreview();
  
    if (value === "grade") {
      showSourcePicker(
        "Choose Grade",
        Array.from({ length: 12 }, (_, i) => ({
          value: `G${i + 1}`,
          label: `Grade ${i + 1}`,
        }))
      );
  
      showFormatOptions();
      return;
    }
  
    if (value === "myCourses") {
      const hasMyCourses = lessonHasSavedCourseData();
  
      if (!hasMyCourses) {
        showMessage(
          "You have not added any courses yet. Use My Courses on the Course List page to bookmark courses or topics first."
        );
        return;
      }
  
      showSourceMessage(
        "My Courses",
        "Your bookmarked courses and topics will be included."
      );
      
      showFormatOptions();
      return;
    }
  
    if (value === "students") {
      const students = state.plannerState.students || [];
  
      if (!students.length) {
        showMessage(
          "You have not created any students yet. Use Manage Students to add students first."
        );
        return;
      }
  
      showSourcePicker(
        "Choose Student",
        students.map((student) => ({
          value: normalizeStudentId(student.id),
          label: student.name || "Student",
        }))
      );
  
      showFormatOptions();
      return;
    }
  
    if (value === "planningTags") {
      const tags = getPlanningTagOptions();
  
      if (!tags.length) {
        showMessage(
          "You have not assigned any Planning Tags yet. Use the Course List page to add Planning Tags to your courses and topics first."
        );
        return;
      }
  
      showSourcePicker(
        "Choose Planning Tag",
        tags.map((tag) => ({
          value: tag,
          label: planningTagLabel(tag),
        }))
      );
  
      showFormatOptions();
      return;
    }
  
    if (value === "trackingTags") {
      showMessage("Tracking Tags are coming soon.");
    }
  }

  openButton.addEventListener("click", openModal);

  modal.querySelectorAll("[data-close-bulk-download]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  modal.querySelectorAll('input[name="download-source"]').forEach((input) => {
    input.addEventListener("change", () => {
      handleSourceChange(input.value);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });

  modal.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-bulk-preview-toggle]");
    if (!toggle) return;
  
    const audit = modal.querySelector("[data-bulk-preview-audit]");
    if (!audit) return;
  
    audit.hidden = !audit.hidden;
    toggle.textContent = audit.hidden
      ? "Review Included PDFs ▼"
      : "Hide Included PDFs ▲";
  });

  document
    .getElementById("bulk-download-start")
    ?.addEventListener(
      "click",
      downloadBulkZip
    );

  modal.addEventListener("change", (event) => {
    if (event.target?.id === "bulk-download-detail-select") {
      bulkDownloadState.detail = event.target.value;
      updateBulkDownloadPreview();
    }
  
    if (event.target?.name === "download-format") {
      bulkDownloadState.format = event.target.value;
      updateBulkDownloadPreview();
    }
  });
}

function setupBackToTop() {
  const button = document.getElementById("back-to-top");

  function updateVisibility() {
    button.classList.toggle(
      "is-visible",
      window.scrollY > 600
    );
  }

  window.addEventListener("scroll", updateVisibility);

  button.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });

  updateVisibility();
}

function rowMatchesQuery(row, query) {
  if (!query) return true;

  const haystack = [
    row.title,
    row.lessonSetName,
    row.subject,
    row.gradeText,
    row.courseTitle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function getTrackText(row) {
  return [
    row.title,
    row.lessonSetName,
    row.subject,
    row.courseTitle,
    row.gradeText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isCanadianSpecific(row) {
  const text = getTrackText(row);

  return (
    text.includes("canada") ||
    text.includes("canadian")
  );
}

function isUsSpecific(row) {
  const text = getTrackText(row);

  return (
    text.includes("u.s.") ||
    text.includes("u.s") ||
    text.includes("usa") ||
    text.includes("united states") ||
    text.includes("us history") ||
    text.includes("history: grade") && !text.includes("canada")
  );
}

function rowMatchesTrack(row) {
  if (!state.selectedTrack) return true;

  if (state.selectedTrack === "us") {
    return !isCanadianSpecific(row);
  }

  if (state.selectedTrack === "canadian") {
    return !isUsSpecific(row);
  }

  return true;
}

function bookDetailsUrl(item) {
  const params = new URLSearchParams();

  params.set("base", "subject");
  params.set("id", item.subject || "All Subjects");

  if (item.rowType === "topic") {
    params.set("course", item.courseId || "");
    params.set("topic", item.id);
  } else {
    params.set("course", item.id);
  }

  return `book-details.html?${params.toString()}`;
}

function safeLink(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "";
}

function isHiddenPdf(row) {
  return row?.links?.pdfVisibility === "Do Not Show PDF";
}

function isDelayedPdf(row) {
  return row?.links?.pdfVisibility === "Delay PDF";
}

function shouldShowLessonPlanRow(row) {
  if (isHiddenPdf(row)) return false;
  if (isDelayedPdf(row)) return true;

  return Boolean(safeLink(row?.links?.lessonPdf));
}

function hasLessonPdf(row) {
  return Boolean(safeLink(row?.links?.lessonPdf));
}

function getActionLinks(item) {
  const links = item.links || {};

  return {
    books: safeLink(links.books || bookDetailsUrl(item)),
    supplies: safeLink(links.supplies),
    lessonLinks: safeLink(links.lessonLinks),
    lessonPdf: safeLink(links.lessonPdf),
    editableSheet: safeLink(links.editableSheet),
    extraHelpings: safeLink(links.extraHelpings),
  };
}

function planningTagImage(id) {
  const images = {
    core: "img/Core%20Subjects.png",
    family: "img/Family%20Subjects.png",
    combine: "img/Combine%20Subjects.png",
    "high-interest": "img/High%20Interest%20Subjects.png",
    additional: "img/Additional%20Subjects.png",
  };

  return images[id] || "";
}

function renderPlanningTagIcons(item) {
  if (!state.memberToolsEnabled || !state.memberFilters.planningTags) return "";

  const member = getMemberRecordForRow(item);
  const tags = [...new Set(member.tags || [])].filter(Boolean);

  if (!tags.length) return "";

  return `
    <div class="lesson-planning-tag-row">
      ${tags.map((tag) => {
        const img = planningTagImage(tag);

        return `
          <span class="planning-tag-pill lesson-planning-tag-pill" title="${escapeHtml(planningTagLabel(tag))}">
            ${
              img
                ? `<img class="planning-tag-img" src="${escapeHtml(img)}" alt="${escapeHtml(planningTagLabel(tag))}" />`
                : `<span class="lesson-planning-tag-fallback">${escapeHtml(planningTagLabel(tag).slice(0, 1))}</span>`
            }
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function renderNoteButton(item) {
  if (!state.memberToolsEnabled) return "";

  const member = getMemberRecordForRow(item);
  const hasNote = String(member.noteText || "").trim().length > 0;

  if (!hasNote) return "";

  const color = subjectColor(item.subject);

  return `
    <span
      class="note-btn note-btn--strong lesson-note-display"
      style="background-color:${escapeHtml(color)}4D; border-color:${escapeHtml(color)}; color:${escapeHtml(color)};"
      aria-label="Has notes"
      title="Has notes"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 17.5V20h2.5L17 9.5 14.5 7 4 17.5z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M15.5 5.5L18 8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  `;
}

function renderMemberIconStack(item) {
  const tags = renderPlanningTagIcons(item);
  const note = renderNoteButton(item);
  const bookmark = renderBookmarkIndicator(item);

  if (!tags && !note && !bookmark) return "";

  return `
    <div class="lesson-member-icon-stack">
      ${tags}
      ${note}
      ${bookmark}
    </div>
  `;
}

function renderStudentChips(item) {
  if (!state.memberToolsEnabled || !state.memberFilters.students) return "";

  const member = getMemberRecordForRow(item);
  const students = [...new Set(member.students || [])]
    .map(getStudentById)
    .filter(Boolean);

  if (!students.length) return "";

  return `
    <span class="lesson-student-chip-row">
      ${students.map((student) => `
        <span
          class="student-chip lesson-student-chip"
          style="--stu:${escapeHtml(student.color || "#9eaa99")};"
        >
          <span class="student-chip-text">${escapeHtml(student.name || "Student")}</span>
        </span>
      `).join("")}
    </span>
  `;
}

function renderActionButtons(item, options = {}) {
  const {
    type = "course",
    showTopicsToggle = false,
  } = options;

  const links = getActionLinks(item);

  const itemId = item.id || "";
  const toolsOpen = state.openTools.has(itemId);
  const matchingCourse = state.courses.find((course) => course.id === itemId);

  const shouldAutoOpenTopics =
    state.memberToolsEnabled &&
    state.memberFilters.myCourses &&
    matchingCourse &&
    courseHasMemberMatchingTopic(matchingCourse);
  
  const topicsOpen =
    state.openTopics.has(itemId) ||
    (shouldAutoOpenTopics && !state.closedTopics.has(itemId));
  const studentChips = renderStudentChips(item);

  const pdfLabel =
    type === "topic"
      ? "Single Topic PDF"
      : "Full Course PDF";

  const toolButtons = [
    {
      key: "supplies",
      label: "Supplies",
      icon: "✂️",
      url: links.supplies,
    },
    {
      key: "books",
      label: "Books",
      icon: "📚",
      url: links.books,
    },
    {
      key: "lessonLinks",
      label: "Links",
      icon: "🔗",
      url: links.lessonLinks,
    },
    {
      key: "extraHelpings",
      label: "Extra Helpings",
      icon: "🍯",
      url: links.extraHelpings,
    },
    {
      key: "editableSheet",
      label:
        isDelayedPdf(item)
          ? "Editable Lessons Coming Soon"
          : "Editable Lessons",
      icon: "✏️",
      url:
        isDelayedPdf(item)
          ? ""
          : links.editableSheet,
      external: true,
      highlight: true,
      disabled: isDelayedPdf(item),
      hasEditableSheet: Boolean(links.editableSheet),
    },
  ];

  return `
    <div class="card-action-row">

      ${
        isDelayedPdf(item)
          ? `
            <span class="card-action-link is-primary is-disabled">
              <span class="card-action-icon">📝</span>
              <span class="card-action-label">PDF Coming Soon</span>
            </span>
          `
          : links.lessonPdf
            ? `
              <a
                class="card-action-link is-primary"
                href="${escapeHtml(links.lessonPdf)}"
                target="_blank"
                rel="noopener"
              >
                <span class="card-action-icon">📝</span>
                <span class="card-action-label">${escapeHtml(pdfLabel)}</span>
                <span class="card-action-arrow">↗</span>
              </a>
            `
            : ""
      }

      <span class="card-action-divider">|</span>

      ${studentChips}
      
      ${
        showTopicsToggle
          ? `
            <button
              class="card-inline-toggle card-topic-toggle"
              type="button"
              data-card-topics="${escapeHtml(itemId)}"
            >
              ${
                  topicsOpen
                    ? "Hide Topics ▲"
                    : "View Topics ▼"
                }
            </button>
          `
          : ""
      }
      
      <div class="card-tool-slot">
        ${
          toolsOpen
            ? `
              <div class="card-tool-links">
                ${toolButtons
                  .filter((button) => {
                    if (button.key === "editableSheet") {
                      return button.hasEditableSheet;
                    }
                  
                    return button.url;
                  })
                  .map(
                    (button) =>
                      button.disabled
                        ? `
                          <span
                            class="card-action-link is-disabled ${button.highlight ? "is-editable-highlight" : ""}"
                          >
                            <span class="card-action-icon">${escapeHtml(button.icon)}</span>
                            <span class="card-action-label">${escapeHtml(button.label)}</span>
                          </span>
                        `
                        : `
                          <a
                            class="card-action-link ${button.highlight ? "is-editable-highlight" : ""}"
                            href="${escapeHtml(button.url)}"
                            ${
                              button.external
                                ? `target="_blank" rel="noopener"`
                                : ""
                            }
                          >
                            <span class="card-action-icon">${escapeHtml(button.icon)}</span>
                            <span class="card-action-label">${escapeHtml(button.label)}</span>
                          </a>
                        `
                  )
                  .join("")}
              </div>
      
              <button
                class="card-inline-toggle card-tools-toggle"
                type="button"
                data-card-tools="${escapeHtml(itemId)}"
              >
                ◀ Hide Tools
              </button>
            `
            : `
              <button
                class="card-inline-toggle card-tools-toggle"
                type="button"
                data-card-tools="${escapeHtml(itemId)}"
              >
                ▼ More Tools
              </button>
            `
        }
      </div>
    </div>
  `;
}

function renderMemberMeta(item) {
  return "";
}

function renderCourseCard(item) {
  return `
    <article class="directory-card" style="--subject-color:${escapeHtml(subjectColor(item.subject))};">
      <div class="card-topline">
        <h3 class="card-title">
          ${escapeHtml(item.lessonSetName || item.title || "")}
          <span class="title-grade">${escapeHtml(item.gradeText || "")}</span>
        </h3>
      
        ${renderMemberIconStack(item)}
      </div>

      ${renderMemberMeta(item)}

      ${renderActionButtons(item, {
        type: "course",
        showTopicsToggle: item.hasTopics,
      })}
    </article>
  `;
}

function renderTopicCard(item) {
  return `
    <article class="topic-card" style="--subject-color:${escapeHtml(subjectColor(item.subject))};">
      <div class="card-topline">
        <h3 class="card-title">
          ${escapeHtml(item.lessonSetName || item.title || "")}
          <span class="title-grade">${escapeHtml(item.gradeText || "")}</span>
        </h3>
      
        ${renderMemberIconStack(item)}
      </div>

      ${renderMemberMeta(item)}

      ${renderActionButtons(item, {
        type: "topic",
        showTopicsToggle: false,
      })}
    </article>
  `;
}

function hydrateRows(rows) {
  const pdfRows = Array.isArray(rows)
    ? rows.filter(shouldShowLessonPlanRow)
    : [];

  state.rows = pdfRows;
  state.courses = state.rows.filter((row) => row.rowType === "course");
  state.topics = state.rows.filter((row) => row.rowType === "topic");
}

function getSelectedViewUrl() {
  if (!state.selectedId) {
    if (state.base === "grade") {
      return state.indexViews.byGrade || "data/lesson-plan-views/by-grade.json";
    }

    if (state.base === "subject") {
      return state.indexViews.bySubject || "data/lesson-plan-views/by-subject.json";
    }

    return state.indexViews.master || "data/lesson-plan-views/master.json";
  }

  if (state.base === "grade") {
    return state.indexViews.grades?.[state.selectedId] || "";
  }

  if (state.base === "subject") {
    return state.indexViews.subjects?.[state.selectedId] || "";
  }

  return state.indexViews.master || "data/lesson-plan-views/master.json";
}

async function loadSelectedView() {
  const viewUrl = getSelectedViewUrl();

  if (!viewUrl) {
    hydrateRows([]);
    state.groups = [];
    return;
  }

  const response = await fetch(viewUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const view = await response.json();

  const rawGroups = Array.isArray(view.groups) ? view.groups : [];

  state.groups = rawGroups
    .map((group) => ({
      ...group,
      rows: (group.rows || []).filter(shouldShowLessonPlanRow),
    }))
    .filter((group) => group.rows.length);

  const rows = state.groups.length
    ? state.groups.flatMap((group) => group.rows || [])
    : (view.rows || []).filter(shouldShowLessonPlanRow);

  hydrateRows(rows);

  populateCourseFilter();
  populateTopicFilter();
}

function memberFilterMatchesRow(row) {
  const member = getMemberRecordForRow(row);

  if (state.memberFilters.myCourses && !member.isBookmarked) {
    return false;
  }

  if (state.selectedPlanningTag) {
    const tags = new Set(member.tags || []);
    if (!tags.has(state.selectedPlanningTag)) return false;
  }

  if (state.selectedStudent) {
    const students = new Set((member.students || []).map(normalizeStudentId));
    if (!students.has(normalizeStudentId(state.selectedStudent))) return false;
  }

  return true;
}

function courseHasMemberMatchingTopic(courseRow) {
  if (!courseRow || courseRow.rowType !== "course") return false;

  return state.topics.some((topic) => {
    if (topic.courseId !== courseRow.id) return false;
    if (!rowMatchesTrack(topic)) return false;

    return memberFilterMatchesRow(topic);
  });
}

function rowMatchesMemberFilters(row) {
  if (!state.memberToolsEnabled) return true;

  if (memberFilterMatchesRow(row)) return true;

  // Course List behavior:
  // keep the parent course card if one of its topic cards matches member state.
  if (row.rowType === "course") {
    return courseHasMemberMatchingTopic(row);
  }

  return false;
}

function rowMatchesFilters(row) {
  const query = normalizeSearch(state.query);

  if (!rowMatchesQuery(row, query)) return false;

  if (!rowMatchesTrack(row)) return false;

  if (state.selectedCourse && !state.selectedTopic) {
    const rowCourseTitle = row.rowType === "topic"
      ? row.courseTitle
      : row.lessonSetName || row.title;
  
    if (rowCourseTitle !== state.selectedCourse) return false;
  }

  if (state.selectedTopic) {
    if (row.rowType === "topic") {
      const rowTopicTitle = row.lessonSetName || row.title;
      if (rowTopicTitle !== state.selectedTopic) return false;
    }
  
    if (row.rowType === "course") {
      const hasMatchingTopic = state.topics.some((topic) => {
        const topicTitle = topic.lessonSetName || topic.title;
        return topic.courseId === row.id && topicTitle === state.selectedTopic;
      });
  
      if (!hasMatchingTopic) return false;
    }
  }

      if (!rowMatchesMemberFilters(row)) return false;

  return true;
}

function render() {
  const topicGroupList = document.getElementById("topic-group-list");

  const fallbackLabel =
    state.selectedId && state.base === "grade"
      ? `Grade ${state.selectedId.replace("G", "")}`
      : state.selectedId && state.base === "subject"
        ? state.selectedId
        : "";
  
  const renderGroups = state.groups.length
    ? state.groups
    : [
        {
          label: fallbackLabel,
          rows: state.rows,
        },
      ];
  
  const groupedHtml = renderGroups
    .map((group) => {
      const groupRows = (group.rows || []).filter(rowMatchesFilters);

      if (!groupRows.length) return "";

      const visibleCourses = groupRows.filter(
        (row) => row.rowType === "course"
      );

      const visibleTopics = groupRows.filter(
        (row) => row.rowType === "topic"
      );

      const topicsByCourseId = {};

      for (const topic of visibleTopics) {
        const key = topic.courseId || "uncategorized";

        if (!topicsByCourseId[key]) {
          topicsByCourseId[key] = [];
        }

        topicsByCourseId[key].push(topic);
      }

      const cardsHtml = visibleCourses
        .map((course) => {
          const topicList = topicsByCourseId[course.id] || [];

          if (topicList.length) {
            const shouldAutoOpenTopics =
              state.memberToolsEnabled &&
              state.memberFilters.myCourses &&
              courseHasMemberMatchingTopic(course);
            
            const topicsOpen =
              state.openTopics.has(course.id) ||
              (shouldAutoOpenTopics && !state.closedTopics.has(course.id));
          
            return `
              <section class="topic-group ${topicsOpen ? "is-topics-open" : ""}" style="--subject-color:${escapeHtml(subjectColor(course.subject))};">
                <div class="topic-group-head">
                  <div class="topic-group-topline">
                    <div>
                      <h3 class="topic-group-title">
                        ${escapeHtml(course.lessonSetName || course.title || "")}
                        <span class="title-grade">
                          ${escapeHtml(course.gradeText || "")}
                        </span>
                      </h3>
                    </div>
                  
                    ${renderMemberIconStack(course)}
                  </div>

                  ${renderMemberMeta(course)}
          
                  ${renderActionButtons(course, {
                    type: "course",
                    showTopicsToggle: true,
                  })}
                </div>
          
                <div class="topic-items">
                  ${topicList.map(renderTopicCard).join("")}
                </div>
              </section>
            `;
          }

          return `
            <section class="topic-group topic-group-course-only" style="--subject-color:${escapeHtml(subjectColor(course.subject))};">
              ${renderCourseCard(course)}
            </section>
          `;
        })
        .join("");

      return `
        <section class="directory-render-group">
          <div class="directory-render-group-header">
            ${escapeHtml(group.label || "")}
          </div>

          <div class="directory-render-group-body">
            ${cardsHtml}
          </div>
        </section>
      `;
    })
    .join("");

  topicGroupList.innerHTML =
    groupedHtml ||
    `<div class="empty-state">No matching courses or topics found.</div>`;
}

function setActiveView(view) {
  state.activeView = view;

  document.querySelectorAll(".directory-toggle-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });

  document.querySelectorAll(".directory-view").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.directoryView === view);
  });
}

async function loadPlannerStateForLessonPlans() {
  try {
    const result = await window.AlvearyAuth?.getPlannerState?.();

    const planner =
      result?.state?.plannerCore ||
      result?.state ||
      {};

    state.plannerState = {
      students: Array.isArray(planner.students)
        ? planner.students.map((student) => ({
            ...student,
            id: normalizeStudentId(student.id),
          }))
        : [],
      studentsUpdatedAt: planner.studentsUpdatedAt || "",
      studentColorCursor:
        typeof planner.studentColorCursor === "number"
          ? planner.studentColorCursor
          : 0,
      courses: planner.courses || {},
      topics: planner.topics || {},
      globalTopicTags: planner.globalTopicTags || {},
      globalTopicStudents: planner.globalTopicStudents || {},
      globalTopicNotes: planner.globalTopicNotes || {},
      extras: planner.extras || {},
    };

    await loadBookFilterIndexForPlannerLookups();
    populateMemberFilters();
  } catch (error) {
    console.warn("Could not load lesson plan member state", error);
  }
}

function populateMemberFilters() {
  const tagSelect = document.getElementById("planning-tag-filter");
  const studentSelect = document.getElementById("student-filter");

  if (tagSelect) {
    const tagIds = new Set();

    Object.values(state.plannerState.courses || {}).forEach((entry) => {
      (entry.tags || []).forEach((tag) => tagIds.add(tag));
    });

    Object.values(state.plannerState.topics || {}).forEach((entry) => {
      (entry.tags || []).forEach((tag) => tagIds.add(tag));
    });

    Object.values(state.plannerState.globalTopicTags || {}).forEach((tags) => {
      (tags || []).forEach((tag) => tagIds.add(tag));
    });

    tagSelect.innerHTML = `
      <option value="">Planning Tags</option>
      ${[...tagIds]
        .sort()
        .map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(planningTagLabel(tag))}</option>`)
        .join("")}
    `;

    tagSelect.value = state.selectedPlanningTag;
  }

  if (studentSelect) {
    studentSelect.innerHTML = `
      <option value="">Students</option>
      ${(state.plannerState.students || [])
        .map((student) => `
          <option value="${escapeHtml(normalizeStudentId(student.id))}">
            ${escapeHtml(student.name || "Student")}
          </option>
        `)
        .join("")}
    `;

    studentSelect.value = state.selectedStudent;
  }
}

function setLessonLoadingMessage(message) {
  const loading = document.getElementById("lesson-page-loading");
  if (!loading) return;

  const text = loading.querySelector("p");
  if (text) text.textContent = message;
}

function removeLessonLoadingMessage() {
  document.getElementById("lesson-page-loading")?.remove();
}

function setMemberLoadingMessage(message = "") {
  const toolbar = document.getElementById("book-member-toolbar");
  if (!toolbar) return;

  let notice = document.getElementById("lesson-member-loading-message");

  if (!message) {
    notice?.remove();
    return;
  }

  if (!notice) {
    notice = document.createElement("div");
    notice.id = "lesson-member-loading-message";
    notice.className = "lesson-member-loading-message";
    toolbar.appendChild(notice);
  }

  notice.textContent = message;
}

async function initDirectory() {
    const authorized = await requireLessonPlansMemberAccess_();
    if (!authorized) return;
  
    try {
    const urlState = getUrlState();

    state.base = urlState.base;
    state.selectedId = urlState.id;
    state.selectedCourse = urlState.course;
    state.selectedTopic = urlState.topic;
    state.selectedTrack = urlState.track;

    applyIntroState();
    applyFilterState();
    applyMemberToolsState();
    setupBackToTop();
    setupGradeBundleModal();
    setupBulkDownloadModal();

    setupStudentManagerModal();

    setLessonLoadingMessage("Loading lesson plan options…");
    
    const response = await fetch(DIRECTORY_INDEX_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const index = await response.json();
    const rows = Array.isArray(index.rows) ? index.rows : [];
    
    state.allRows = rows.filter(shouldShowLessonPlanRow);
    state.indexViews = index.views || {};
    
    populatePrimarySelect();
    
    await loadSelectedView();
    
    document.getElementById("track-filter").value = state.selectedTrack;
    
    document.querySelectorAll(".book-base-button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.base === state.base);
    });
    
    removeLessonLoadingMessage();
    render();
    
    setMemberLoadingMessage("Loading your saved planning choices…");
    
    loadPlannerStateForLessonPlans()
    .then(async () => {
      applySmartFirstVisitDefaults();
      applySavedLessonUiPrefs();
      applySavedTopicOpenPrefs();
      populatePrimarySelect();
      await loadSelectedView();
      
      document.getElementById("primary-select").value = state.selectedId;
      document.getElementById("course-filter").value = state.selectedCourse;
      document.getElementById("topic-filter").value = state.selectedTopic;
      applyIntroState();
      applyFilterState();
      applyMemberToolsState();
      applyMemberMiniToggleState();
      populateMemberFilters();
  
      document.getElementById("directory-search").value = state.query;
      document.getElementById("track-filter").value = state.selectedTrack;
      document.getElementById("planning-tag-filter").value = state.selectedPlanningTag;
      document.getElementById("student-filter").value = state.selectedStudent;
  
      setMemberLoadingMessage("");
      render();
    })
      .catch((error) => {
        setMemberLoadingMessage("");
        console.warn("Could not apply lesson plan member data", error);
      });
    
    document.getElementById("toggle-intro").addEventListener("click", () => {
      const intro = document.getElementById("lesson-intro-section");
      const nextCollapsed = !intro.classList.contains("is-collapsed");

      localStorage.setItem(STORAGE_KEYS.introCollapsed, String(nextCollapsed));
      applyIntroState();
    });

    document.querySelector(".book-controls-header").addEventListener("click", () => {
      const controls = document.getElementById("lesson-controls");
      const nextCollapsed = !controls.classList.contains("is-collapsed");
    
      localStorage.setItem(STORAGE_KEYS.filtersCollapsed, String(nextCollapsed));
      applyFilterState();
    });

    document.getElementById("member-tools-toggle").addEventListener("click", () => {
      const nextEnabled = !state.memberToolsEnabled;
    
      localStorage.setItem(STORAGE_KEYS.memberTools, String(nextEnabled));
      applyMemberToolsState();
      saveLessonUiPrefs();
      render();
    });
    
    document.querySelectorAll(".member-mini-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.memberFilter;
        if (!key) return;
    
        state.memberFilters[key] = !state.memberFilters[key];

        if (key === "myCourses" && state.memberFilters.myCourses) {
          state.closedTopics.clear();
          saveTopicOpenPrefs();
        }
    
        button.classList.toggle("is-active", !!state.memberFilters[key]);
        button.setAttribute("aria-pressed", state.memberFilters[key] ? "true" : "false");
    
        saveLessonUiPrefs();
        render();
      });
    });
    
    document.getElementById("planning-tag-filter")?.addEventListener("change", (event) => {
      state.selectedPlanningTag = event.target.value;
      saveLessonUiPrefs();
      render();
    });
    
    document.getElementById("student-filter")?.addEventListener("change", (event) => {
      state.selectedStudent = event.target.value;
      saveLessonUiPrefs();
      render();
    });

    document.querySelectorAll(".book-base-button").forEach((button) => {
      button.addEventListener("click", async () => {
        state.base = button.dataset.base || "subject";
        state.selectedId = "";
        state.selectedCourse = "";
        state.selectedTopic = "";
        state.selectedTrack = "";
        state.query = "";
        
        document.getElementById("directory-search").value = "";
        document.getElementById("track-filter").value = "";
        document.getElementById("course-filter").value = "";
        document.getElementById("topic-filter").value = "";

        document.querySelectorAll(".book-base-button").forEach((btn) => {
          btn.classList.toggle("is-active", btn.dataset.base === state.base);
        });

        populatePrimarySelect();
        updateUrl();
        await loadSelectedView();
        saveLessonUiPrefs();
        render();
      });
    });

    document.getElementById("primary-select").addEventListener("change", async (event) => {
      state.selectedId = event.target.value;
      state.selectedCourse = "";
      state.selectedTopic = "";
    
      updateUrl();
      await loadSelectedView();
      saveLessonUiPrefs();
      render();
    });

    document.getElementById("track-filter").addEventListener("change", (event) => {
      state.selectedTrack = event.target.value;
    
      populateCourseFilter();
      populateTopicFilter();
    
      updateUrl();
      saveLessonUiPrefs();
      render();
    });

    document.getElementById("course-filter").addEventListener("change", (event) => {
      state.selectedCourse = event.target.value;
    
      state.selectedTopic = "";
      document.getElementById("topic-filter").value = "";
    
      populateTopicFilter();
    
      updateUrl();
      saveLessonUiPrefs();
      render();
    });

    document.getElementById("topic-filter").addEventListener("change", (event) => {
      state.selectedTopic = event.target.value;
      updateUrl();
      saveLessonUiPrefs();
      render();
    });

    const searchInput = document.getElementById("directory-search");
    searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
      saveLessonUiPrefs();
      render();
    });

    document.getElementById("topic-group-list").addEventListener("click", (event) => {
      const toolsButton = event.target.closest("[data-card-tools]");
      const topicsButton = event.target.closest("[data-card-topics]");
    
      if (toolsButton) {
        const itemId = toolsButton.dataset.cardTools;
    
        if (state.openTools.has(itemId)) {
          state.openTools.delete(itemId);
        } else {
          state.openTools.add(itemId);
        }
    
        saveLessonUiPrefs();
        render();
        return;
      }
    
      if (topicsButton) {
        const itemId = topicsButton.dataset.cardTopics;
        const isCurrentlyOpen =
          state.openTopics.has(itemId) ||
          (
            state.memberToolsEnabled &&
            state.memberFilters.myCourses &&
            courseHasMemberMatchingTopic(
              state.courses.find((course) => course.id === itemId)
            ) &&
            !state.closedTopics.has(itemId)
          );
      
        if (isCurrentlyOpen) {
          state.openTopics.delete(itemId);
          state.closedTopics.add(itemId);
        } else {
          state.closedTopics.delete(itemId);
          state.openTopics.add(itemId);
        }
      
        saveTopicOpenPrefs();
        render();
      }
    });

    document.getElementById("clear-filters").addEventListener("click", async () => {
      state.query = "";
      state.selectedId = "";
      state.selectedCourse = "";
      state.selectedTopic = "";
      state.selectedTrack = "";
      state.selectedPlanningTag = "";
      state.selectedStudent = "";
      state.base = "subject";
    
      searchInput.value = "";
      document.getElementById("track-filter").value = "";
      document.getElementById("course-filter").value = "";
      document.getElementById("topic-filter").value = "";
      document.getElementById("planning-tag-filter").value = "";
      document.getElementById("student-filter").value = "";
    
      document.querySelectorAll(".book-base-button").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.base === state.base);
      });
    
      populatePrimarySelect();
      document.getElementById("primary-select").value = "";
    
      updateUrl();
      await loadSelectedView();
      saveLessonUiPrefs();
      render();
    });

    document.querySelectorAll(".clear-select").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = button.dataset.clear;
    
        if (target === "primary") {
          state.selectedId = "";
          state.selectedCourse = "";
          state.selectedTopic = "";
          state.selectedPlanningTag = "";
          state.selectedStudent = "";
    
          document.getElementById("primary-select").value = "";
          document.getElementById("course-filter").value = "";
          document.getElementById("topic-filter").value = "";
          document.getElementById("planning-tag-filter").value = "";
          document.getElementById("student-filter").value = "";
    
          updateUrl();
          await loadSelectedView();
          saveLessonUiPrefs();
          render();
          return;
        }
    
        if (target === "track") {
          state.selectedTrack = "";
          document.getElementById("track-filter").value = "";
    
          populateCourseFilter();
          populateTopicFilter();
    
          updateUrl();
          saveLessonUiPrefs();
          render();
          return;
        }
    
        if (target === "course") {
          state.selectedCourse = "";
          state.selectedTopic = "";
    
          document.getElementById("course-filter").value = "";
          document.getElementById("topic-filter").value = "";
    
          populateTopicFilter();
    
          updateUrl();
          saveLessonUiPrefs();
          render();
          return;
        }
    
        if (target === "topic") {
          state.selectedTopic = "";
          document.getElementById("topic-filter").value = "";
    
          populateTopicFilter();
    
          updateUrl();
          saveLessonUiPrefs();
          render();
          return;
        }
      });
    });

    render();
  } catch (error) {
    document.getElementById("topic-group-list").innerHTML =
      `<div class="empty-state">Could not load lesson plans.</div>`;

    console.error(error);
  }
}

initDirectory();
