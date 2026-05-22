const ALVEARY_CONFIG = window.ALVEARY_CONFIG || {};

const SUBJECTS = [
  "All Subjects",
  "Basic Supplies",
  ...(ALVEARY_CONFIG.subjects || []).filter(
    (subject) => subject !== "All Subjects" && subject !== "Basic Supplies"
  ),
];
const GRADES = ALVEARY_CONFIG.grades || ["All Grades"];
const TRACKS = ALVEARY_CONFIG.tracks || [
  { value: "", label: "US + Canadian" },
  { value: "us", label: "US only" },
  { value: "canadian", label: "Canadian only" },
];

const SUBJECT_COLORS = ALVEARY_CONFIG.subjectColors || {};

const DEFAULT_SUBJECT = "All Subjects";
const DEFAULT_GRADE = "All Grades";

function subjectColor(name) {
  if (!name) return "#dde2d5";

  const key = Object.keys(SUBJECT_COLORS).find(
    (subject) => subject.toLowerCase() === String(name).toLowerCase()
  );

  return key ? SUBJECT_COLORS[key] : "#dde2d5";
}

const state = {
  data: null,
  filterIndex: null,
  view: "",
  base: "grade",
  id: DEFAULT_GRADE,
  course: "",
  topic: "",
  query: "",
  track: "",
};

/* =========================================================
   Page UI State
   Remembers page-level open/closed panels.
   ========================================================= */

const Supply_PAGE_UI_KEY = "alveary_Supply_page_ui_v1";

const pageUiState = {
  introCollapsed: null,
  filtersCollapsed: null,
};

function loadSupplyPageUiState() {
  try {
    const raw = localStorage.getItem(Supply_PAGE_UI_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return;

    pageUiState.introCollapsed =
      typeof saved.introCollapsed === "boolean"
        ? saved.introCollapsed
        : null;

    pageUiState.filtersCollapsed =
      typeof saved.filtersCollapsed === "boolean"
        ? saved.filtersCollapsed
        : null;
  } catch {
    // ignore bad saved state
  }
}

function saveSupplyPageUiState() {
  try {
    localStorage.setItem(Supply_PAGE_UI_KEY, JSON.stringify(pageUiState));
  } catch {
    // ignore storage errors
  }
}

/* =========================================================
   Member Supply State
   Canonical IDs:
   - Supply.resourceId = Airtable resource record ID
   - Supply.instanceKey = course/topic/resource instance from JSON
   ========================================================= */

const Supply_MEMBER_STATE_KEY = "alveary_Supply_member_state_v1";

const SupplyMemberState = {
  version: 1,

  supplies: {
    // Global: resource is in My Supplies somewhere
    mySupplies: [],

    // Instance ownership:
    // {
    //   "recResourceId": [
    //     "course:recCourseId:resource:recResourceId",
    //     "course:recCourseId:topic:recTopicId:resource:recResourceId"
    //   ]
    // }
    mySuppliesOwnersByResourceId: {},
  },
};

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

function normalizeSupplyMemberState() {
  SupplyMemberState.supplies.mySupplies = uniqueStrings(SupplyMemberState.supplies.mySupplies);

  const ownersMap = SupplyMemberState.supplies.mySuppliesOwnersByResourceId || {};
  const nextOwnersMap = {};

  Object.entries(ownersMap).forEach(([resourceId, owners]) => {
    const rid = normalizeId(resourceId);
    if (!rid) return;

    const cleanOwners = uniqueStrings(owners);
    if (cleanOwners.length) {
      nextOwnersMap[rid] = cleanOwners;
    }
  });

  SupplyMemberState.supplies.mySuppliesOwnersByResourceId = nextOwnersMap;
}

function loadSupplyMemberState() {
  try {
    const raw = localStorage.getItem(Supply_MEMBER_STATE_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);
    const savedSupplies = saved?.supplies;

    if (!savedSupplies || typeof savedSupplies !== "object") return;

    SupplyMemberState.supplies.mySupplies = Array.isArray(savedSupplies.mySupplies)
      ? savedSupplies.mySupplies
      : Array.isArray(savedSupplies.mySupplys)
        ? savedSupplies.mySupplys
        : [];

    SupplyMemberState.supplies.mySuppliesOwnersByResourceId =
      savedSupplies.mySuppliesOwnersByResourceId &&
      typeof savedSupplies.mySuppliesOwnersByResourceId === "object"
        ? savedSupplies.mySuppliesOwnersByResourceId
        : savedSupplies.mySupplysOwnersByResourceId &&
          typeof savedSupplies.mySupplysOwnersByResourceId === "object"
            ? savedSupplies.mySupplysOwnersByResourceId
            : {};

    normalizeSupplyMemberState();
  } catch {
    // ignore bad saved state
  }
}

function saveSupplyMemberState() {
  try {
    normalizeSupplyMemberState();
    localStorage.setItem(Supply_MEMBER_STATE_KEY, JSON.stringify(SupplyMemberState));
  } catch {
    // ignore storage errors
  }
}

const Supply_MEMBER_LEGACY_MIGRATED_KEY = "alveary_Supply_member_legacy_migrated_v1";

function resolveLegacyPlannerKey() {
  try {
    if (window.PLANNER_STATE_KEY) return window.PLANNER_STATE_KEY;
  } catch {}

  try {
    const keys = [];

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith("alveary_planner_")) {
        keys.push(key);
      }
    }

    keys.sort();
    return keys.length ? keys[keys.length - 1] : "";
  } catch {
    return "";
  }
}

function convertLegacyOwnerKey(ownerKey) {
  const key = normalizeId(ownerKey);
  if (!key) return "";

  // Already in the new format.
  if (key.startsWith("course:")) return key;

  // Old course-level format:
  // C:recCourseId:R:recResourceId
  let match = key.match(/^C:([^:]+):R:([^:]+)$/);
  if (match) {
    const courseId = normalizeId(match[1]);
    const resourceId = normalizeId(match[2]);

    // Only keep scoped owners when they already use Airtable record IDs.
    // If not, we let the global mySupplies save behave as a legacy/global save.
    if (courseId.startsWith("rec") && resourceId.startsWith("rec")) {
      return `course:${courseId}:resource:${resourceId}`;
    }

    return "";
  }

  // Old topic-level format:
  // C:recCourseId:T:recTopicId:R:recResourceId
  match = key.match(/^C:([^:]+):T:([^:]+):R:([^:]+)$/);
  if (match) {
    const courseId = normalizeId(match[1]);
    const topicId = normalizeId(match[2]);
    const resourceId = normalizeId(match[3]);

    // Only keep scoped owners when they already use Airtable record IDs.
    // If not, we let the global mySupplies save behave as a legacy/global save.
    if (
      courseId.startsWith("rec") &&
      topicId.startsWith("rec") &&
      resourceId.startsWith("rec")
    ) {
      return `course:${courseId}:topic:${topicId}:resource:${resourceId}`;
    }

    return "";
  }

  return "";
}

function migrateLegacySupplyMemberStateOnce() {
  try {
    if (localStorage.getItem(Supply_MEMBER_LEGACY_MIGRATED_KEY) === "1") return;

    const plannerKey = resolveLegacyPlannerKey();
    if (!plannerKey) return;

    const raw = localStorage.getItem(plannerKey);
    if (!raw) return;

    const legacy = JSON.parse(raw);
    const legacyResources = legacy?.extras?.resources;

    if (!legacyResources || typeof legacyResources !== "object") return;

    const legacymySupplies = Array.isArray(legacyResources.mySupplies)
      ? legacyResources.mySupplies
      : [];

    const legacyOwners =
      legacyResources.mySuppliesOwnersByResourceId &&
      typeof legacyResources.mySuppliesOwnersByResourceId === "object"
        ? legacyResources.mySuppliesOwnersByResourceId
        : {};

    SupplyMemberState.supplies.mySupplies = uniqueStrings([
      ...SupplyMemberState.supplies.mySupplies,
      ...legacymySupplies,
    ]);

    Object.entries(legacyOwners).forEach(([resourceId, owners]) => {
      const rid = normalizeId(resourceId);
      if (!rid) return;

      const convertedOwners = uniqueStrings(
        (Array.isArray(owners) ? owners : [])
          .map(convertLegacyOwnerKey)
          .filter(Boolean)
      );

      if (!convertedOwners.length) return;

      SupplyMemberState.supplies.mySuppliesOwnersByResourceId[rid] = uniqueStrings([
        ...SupplyOwnerKeys(rid),
        ...convertedOwners,
      ]);
    });

    normalizeSupplyMemberState();
    saveSupplyMemberState();

    localStorage.setItem(Supply_MEMBER_LEGACY_MIGRATED_KEY, "1");
  } catch {
    // ignore migration errors
  }
}

function SupplyResourceId(Supply) {
  return normalizeId(Supply?.resourceId || Supply?.id);
}

function SupplyInstanceKey(Supply) {
  return normalizeId(Supply?.instanceKey);
}

function isSupplyInMySupplies(SupplyOrResourceId) {
  const resourceId =
    typeof SupplyOrResourceId === "string"
      ? normalizeId(SupplyOrResourceId)
      : SupplyResourceId(SupplyOrResourceId);

  if (!resourceId) return false;

  return SupplyMemberState.supplies.mySupplies.includes(resourceId);
}

function SupplyOwnerKeys(resourceId) {
  const rid = normalizeId(resourceId);
  if (!rid) return [];

  const owners = SupplyMemberState.supplies.mySuppliesOwnersByResourceId?.[rid];
  return uniqueStrings(owners);
}

function isSupplyOwnedHere(Supply) {
  const resourceId = SupplyResourceId(Supply);
  const instanceKey = SupplyInstanceKey(Supply);

  if (!resourceId || !instanceKey) return false;

  return SupplyOwnerKeys(resourceId).includes(instanceKey);
}

function isSupplyGhostHere(Supply) {
  const resourceId = SupplyResourceId(Supply);
  const instanceKey = SupplyInstanceKey(Supply);

  if (!resourceId || !instanceKey) return false;
  if (!isSupplyInMySupplies(resourceId)) return false;

  const owners = SupplyOwnerKeys(resourceId);

  // Legacy/global-only saves behave as active everywhere until scoped.
  if (!owners.length) return false;

  return !owners.includes(instanceKey);
}

function SupplySaveStatus(Supply) {
  if (isSupplyOwnedHere(Supply)) return "active";
  if (isSupplyGhostHere(Supply)) return "ghost";
  if (isSupplyInMySupplies(Supply)) return "legacy";
  return "empty";
}

/* =========================================================
   Read-only Course Planner Adapter
   Supply page may READ course state,
   but must NOT write course-owned data.
   ========================================================= */

function getReadOnlyPlannerState() {
  try {
    const plannerKey = resolveLegacyPlannerKey();
    if (!plannerKey) return null;

    const raw = localStorage.getItem(plannerKey);
    if (!raw) return null;

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getPlannerExtras() {
  return getReadOnlyPlannerState()?.extras || {};
}

function buildCourseRecordLookup() {
  const lookup = new Map();

  const sourceItems = filterIndexItems();

  sourceItems.forEach((item) => {
    const recordId = normalizeId(item.id);
    if (!recordId) return;

    // canonical Airtable record ID
    lookup.set(recordId, recordId);

    // legacy planner keys / ids
    [
      item.courseId,
      item.sortId,
      item.Sort_ID,
      item.legacyId,
    ]
      .map(normalizeId)
      .filter(Boolean)
      .forEach((legacyId) => {
        lookup.set(legacyId, recordId);
      });
  });

  return lookup;
}

function buildTopicRecordLookup() {
  const lookup = new Map();

  const sourceItems = filterIndexItems();

  sourceItems.forEach((item) => {
    (item.sections || []).forEach((section) => {
      const recordId = normalizeId(section.id);
      if (!recordId) return;

      lookup.set(recordId, recordId);

      [
        section.topicId,
        section.Topic_ID,
        section.sortId,
        section.legacyId,
      ]
        .map(normalizeId)
        .filter(Boolean)
        .forEach((legacyId) => {
          lookup.set(legacyId, recordId);
        });
    });
  });

  return lookup;
}

function getSavedCourseRecordIdsForReading() {
  const extras = getPlannerExtras();

  const lookup = buildCourseRecordLookup();

  const values = [
    ...(extras.myCourses || []),
    ...(extras.courseSelections || []),
  ];

  return uniqueStrings(
    values
      .map(normalizeId)
      .map((id) => lookup.get(id) || "")
      .filter(Boolean)
  );
}

function getSavedTopicRecordIdsForReading() {
  const extras = getPlannerExtras();

  const lookup = buildTopicRecordLookup();

  const values = [
    ...(extras.myTopics || []),
    ...(extras.topicSelections || []),
  ];

  return uniqueStrings(
    values
      .map(normalizeId)
      .map((id) => lookup.get(id) || "")
      .filter(Boolean)
  );
}

function itemMatchesMyCourses(item) {
  const savedCourses = getSavedCourseRecordIdsForReading();
  const savedTopics = getSavedTopicRecordIdsForReading();

  const itemId = normalizeId(item.id);

  // Saved course directly
  if (savedCourses.includes(itemId)) {
    return true;
  }

  // Saved topic inside course
  const hasSavedTopic = (item.sections || []).some((section) =>
    savedTopics.includes(normalizeId(section.id))
  );

  return hasSavedTopic;
}

function shouldIncludeSupplyByMemberFilters(Supply) {
  const filters = memberUiState.filters || {};

  // My Supplies filter:
  // show Supplies saved HERE or legacy/global saved Supplies
  // hide ghost-only copies
  if (filters.mySupplies) {
    const status = SupplySaveStatus(Supply);

    if (status !== "active" && status !== "legacy") {
      return false;
    }
  }

  return true;
}

function addSupplyOwnerHere(Supply) {
  const resourceId = SupplyResourceId(Supply);
  const instanceKey = SupplyInstanceKey(Supply);

  if (!resourceId) return;

  SupplyMemberState.supplies.mySupplies = uniqueStrings([
    ...SupplyMemberState.supplies.mySupplies,
    resourceId,
  ]);

  if (instanceKey) {
    const owners = SupplyOwnerKeys(resourceId);
    SupplyMemberState.supplies.mySuppliesOwnersByResourceId[resourceId] = uniqueStrings([
      ...owners,
      instanceKey,
    ]);
  }

  saveSupplyMemberState();
}

function removeSupplyOwnerHere(Supply) {
  const resourceId = SupplyResourceId(Supply);
  const instanceKey = SupplyInstanceKey(Supply);

  if (!resourceId) return;

  const owners = SupplyOwnerKeys(resourceId).filter((key) => key !== instanceKey);

  if (owners.length) {
    SupplyMemberState.supplies.mySuppliesOwnersByResourceId[resourceId] = owners;
  } else {
    delete SupplyMemberState.supplies.mySuppliesOwnersByResourceId[resourceId];
    SupplyMemberState.supplies.mySupplies = SupplyMemberState.supplies.mySupplies.filter(
      (id) => id !== resourceId
    );
  }

  saveSupplyMemberState();
}

function toggleSupplySavedHere(Supply) {
  const status = SupplySaveStatus(Supply);

  if (status === "active") {
    removeSupplyOwnerHere(Supply);
  } else {
    addSupplyOwnerHere(Supply);
  }

  render();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSupplyMultilineText(value, options = {}) {
  const { preserveLeadingBlank = false } = options;

  let text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/g, "");

  if (!text.trim()) return "";

  const hasIntentionalLeadingList =
    preserveLeadingBlank && /^\s*\n+\s*[-•]/.test(text);

  if (hasIntentionalLeadingList) {
    text = text.replace(/^\s*\n+/, "");
  } else {
    text = text.replace(/^\s+/, "");
  }

  return escapeHtml(text);
}

function hasIntentionalLeadingList(value) {
  return /^\s*\n+\s*[-•]/.test(String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
}

function slugSubject(subject) {
  return String(subject || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function viewPath(base, id) {
  if (state.view === "topic") {
    return `./data/supply-views/topic/${encodeURIComponent(id)}.json`;
  }

  if (state.view === "course") {
    return `./data/supply-views/course/${encodeURIComponent(id)}.json`;
  }

  if (base === "subject") {
    return "./data/supply-views/by-subject.json";
  }

  if (id === DEFAULT_GRADE) return "./data/supply-views/by-grade.json";
  return `./data/supply-views/grade/${id}.json`;
}

function groupMatchesPrimarySelection(group) {
  if (!group) return false;

  if (state.base === "subject" && state.id !== DEFAULT_SUBJECT) {
    return group.label === state.id || group.id === slugSubject(state.id);
  }

  if (state.base === "grade" && state.id !== DEFAULT_GRADE) {
    return group.id === state.id;
  }

  return true;
}

function filteredGroups() {
  if (!Array.isArray(state.data?.groups)) return null;

  return state.data.groups
    .filter(groupMatchesPrimarySelection)
    .map((group) => {
      const items = (group.items || [])
        .filter(itemMatchesFilters)
        .map((item) => {
          let sections = item.sections || [];

          if (state.topic) {
            sections = sections.filter((section) => section.id === state.topic);
          }

          sections = sections
            .map((section) => ({
              ...section,
              supplies: (section.supplies || []).filter((Supply) => SupplyMatches(Supply, state.query)),
            }))
            .filter((section) => section.supplies.length);

          return {
            ...item,
            sections,
          };
        })
        .filter((item) => item.sections.length);

      return {
        ...group,
        items,
      };
    })
    .filter((group) => group.items.length);
}

function readParams() {
  const params = new URLSearchParams(window.location.search);

  state.view = params.get("view") || "";
  state.base = params.get("base") || "grade";
  state.id = params.get("id") || (state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE);
  state.course = params.get("course") || "";
  state.topic = params.get("topic") || "";
  state.track = params.get("track") || "";

  if (state.view === "topic" || state.view === "course") {
    state.base = "";
    state.course = "";
    state.topic = "";
    state.track = "";
  }
}

function exitDirectView({
  base = "subject",
  id = DEFAULT_SUBJECT,
  keepSearch = true,
} = {}) {
  state.view = "";
  state.base = base;
  state.id = id;
  state.course = "";
  state.topic = "";
  state.track = "";
  if (!keepSearch) state.query = "";
}

function writeParams() {
  const params = new URLSearchParams();

  if (state.view === "topic" || state.view === "course") {
    params.set("view", state.view);
    params.set("id", state.id);

    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    return;
  }

  params.set("base", state.base);
  params.set("id", state.id);

  if (state.course) params.set("course", state.course);
  if (state.topic) params.set("topic", state.topic);
  if (state.track) params.set("track", state.track);

  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function SupplyMatches(Supply, query) {
  if (!query) return true;

  const haystack = [
    Supply.title,
    Supply.author,
    Supply.rationale,
    Supply.notes,
    Supply.scopeText,
    Supply.sharedText,
    Supply.formatTags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function itemMatchesTrack(item) {
  if (!state.track) return true;

  const title = String(item?.title || "").toLowerCase();

  const isCanadianVariant =
    title.includes("canada") ||
    title.includes("canadian");

  const isUSVariant =
    title.includes("u.s.") ||
    title.includes("(us)") ||
    title.includes("(u.s.)") ||
    title.includes(" us ");

  if (state.track === "canadian") {
    return isCanadianVariant || !isUSVariant;
  }

  if (state.track === "us") {
    return isUSVariant || !isCanadianVariant;
  }

  return true;
}

function itemMatchesFilters(item) {
  if (!itemMatchesTrack(item)) return false;

  if (memberUiState.filters?.myCourses) {
    if (!itemMatchesMyCourses(item)) {
      return false;
    }
  }

  if (state.course && item.id !== state.course) return false;

  if (state.topic) {
    return (item.sections || []).some((section) => section.id === state.topic);
  }

  return true;
}

function filteredItems() {
  if (!state.data?.items) return [];

  return state.data.items
    .filter(itemMatchesFilters)
    .map((item) => {
      let sections = item.sections || [];

      if (state.topic) {
        sections = sections.filter((section) => section.id === state.topic);
      }

      sections = sections
        .map((section) => ({
          ...section,
          supplies: (section.supplies || []).filter((Supply) => SupplyMatches(Supply, state.query)),
        }))
        .filter((section) => section.supplies.length);

      return {
        ...item,
        sections,
      };
    })
    .filter((item) => item.sections.length);
}

function populatePrimarySelector() {
  const primarySelect = document.getElementById("primary-select");

  const options = state.base === "subject"
    ? SUBJECTS.map((subject) => ({
        value: subject,
        label: subject,
      }))
    : GRADES.map((grade) => ({
        value: grade,
        label: grade === DEFAULT_GRADE ? grade : `Grade ${grade.replace("G", "")}`,
      }));

  primarySelect.innerHTML = options.map((option) => `
    <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
  `).join("");

  primarySelect.value = state.id;
}

function filterIndexItems() {
  if (Array.isArray(state.filterIndex?.items)) return state.filterIndex.items;

  if (Array.isArray(state.filterIndex?.groups)) {
    return state.filterIndex.groups.flatMap((group) => group.items || []);
  }

  return state.data?.items || [];
}

function populateCourseTopicFilters() {
  const courseSelect = document.getElementById("course-filter");
  const topicSelect = document.getElementById("topic-filter");

  const scopedFilterItems = (() => {
    if (isMasterView()) return filterIndexItems();
  
    if (Array.isArray(state.data?.items)) {
      return state.data.items;
    }
  
    if (Array.isArray(state.data?.groups)) {
      return state.data.groups
        .filter(groupMatchesPrimarySelection)
        .flatMap((group) => group.items || []);
    }
  
    return [];
  })();
  
  const items = scopedFilterItems.filter(itemMatchesTrack);

  const courseStillExists = !state.course || items.some((item) => item.id === state.course);
  if (!courseStillExists) {
    state.course = "";
    state.topic = "";
  }

  const selectedCourse = items.find((item) => item.id === state.course);

  const topics = [];

  for (const item of items) {
    for (const section of item.sections || []) {
      if (section.type === "topic") {
        topics.push({
          id: section.id,
          title: section.title,
          courseId: item.id,
          courseTitle: item.title,
        });
      }
    }
  }

  if (state.course && state.topic) {
    const topicBelongsToCourse = topics.some(
      (topic) => topic.id === state.topic && topic.courseId === state.course
    );

    if (!topicBelongsToCourse) state.topic = "";
  }

  const visibleTopics = selectedCourse
    ? topics.filter((topic) => topic.courseId === selectedCourse.id)
    : topics;

  const topicStillExists = !state.topic || visibleTopics.some((topic) => topic.id === state.topic);
  if (!topicStillExists) state.topic = "";

  courseSelect.innerHTML = `
    <option value="">All courses</option>
    ${items.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>
    `).join("")}
  `;

  topicSelect.innerHTML = `
    <option value="">All topics</option>
    ${visibleTopics.map((topic) => `
      <option value="${escapeHtml(topic.id)}">
        ${escapeHtml(topic.courseTitle)} — ${escapeHtml(topic.title)}
      </option>
    `).join("")}
  `;

  courseSelect.value = state.course;
  topicSelect.value = state.topic;
}

function syncClearButtons() {
  document.querySelectorAll(".clear-select").forEach((button) => {
    const clearType = button.dataset.clear;

    let isActive = false;

    if (clearType === "primary") {
      isActive = state.id !== (state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE);
    }

    if (clearType === "track") isActive = Boolean(state.track);
    if (clearType === "course") isActive = Boolean(state.course);
    if (clearType === "topic") isActive = Boolean(state.topic);

    button.hidden = !isActive;
  });
}

function syncControls() {
  document.querySelectorAll(".supply-base-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.base === state.base);
  });

  document.getElementById("track-filter").value = state.track;

  populatePrimarySelector();
  populateCourseTopicFilters();
  syncClearButtons();
}

function renderSupplySaveButton(Supply) {
  const status = SupplySaveStatus(Supply);
  const resourceId = SupplyResourceId(Supply);
  const instanceKey = SupplyInstanceKey(Supply);

  if (!resourceId || !instanceKey) return "";

  if (status === "active" || status === "legacy") {
    return `
      <span class="Supplymark-region supply-save-region">
        <button
          type="button"
          class="Supplymark-btn Supplymark-btn--solid supply-save-btn"
          onclick="event.stopPropagation(); toggleSupplySavedHereByInstanceKey('${escapeHtml(instanceKey)}')"
          aria-label="Remove from My Supplies"
          title="In My Supplies"
        >
          <img src="img/icons/supply-icon-active.png" alt="" class="Supplymark-icon" />
        </button>
      </span>
    `;
  }

  if (status === "ghost") {
    return `
      <span class="Supplymark-region supply-save-region">
        <button
          type="button"
          class="Supplymark-btn Supplymark-btn--ghost supply-save-btn"
          onclick="event.stopPropagation(); addSupplyOwnerHereByInstanceKey('${escapeHtml(instanceKey)}')"
          aria-label="In My Supplies elsewhere — add here"
          title="In My Supplies elsewhere — add here"
        >
          <img src="img/icons/supply-icon-active.png" alt="" class="Supplymark-icon" />
          <span class="Supplymark-apply">+</span>
        </button>
      </span>
    `;
  }

  return `
    <span class="Supplymark-region supply-save-region">
      <button
        type="button"
        class="Supplymark-btn Supplymark-btn--empty supply-save-btn"
        onclick="event.stopPropagation(); toggleSupplySavedHereByInstanceKey('${escapeHtml(instanceKey)}')"
        aria-label="Add to My Supplies"
        title="Add to My Supplies"
      >
        <img src="img/icons/supply-icon-inactive.png" alt="" class="Supplymark-icon" />
        <span class="Supplymark-apply">+</span>
      </button>
    </span>
  `;
}

function findSupplyByInstanceKey(instanceKey) {
  const key = normalizeId(instanceKey);
  if (!key) return null;

  const sourceItems = state.data?.items || [];
  const sourceGroups = state.data?.groups || [];

  const items = Array.isArray(sourceGroups) && sourceGroups.length
    ? sourceGroups.flatMap((group) => group.items || [])
    : sourceItems;

  for (const item of items) {
    for (const section of item.sections || []) {
      for (const Supply of section.supplies || []) {
        if (SupplyInstanceKey(Supply) === key) {
          return Supply;
        }
      }
    }
  }

  return null;
}

function toggleSupplySavedHereByInstanceKey(instanceKey) {
  const Supply = findSupplyByInstanceKey(instanceKey);
  if (!Supply) return;

  toggleSupplySavedHere(Supply);
}

function addSupplyOwnerHereByInstanceKey(instanceKey) {
  const Supply = findSupplyByInstanceKey(instanceKey);
  if (!Supply) return;

  addSupplyOwnerHere(Supply);
  render();
}

function isCourseSavedReadOnly(item) {
  return getSavedCourseRecordIdsForReading().includes(
    normalizeId(item?.id)
  );
}

function isTopicSavedReadOnly(section) {
  return getSavedTopicRecordIdsForReading().includes(
    normalizeId(section?.id)
  );
}

function tagLabel(tag) {
  if (!tag) return "";
  if (typeof tag === "string") return tag;
  return tag.label || tag.name || tag.id || "";
}

function studentLabel(student) {
  if (!student) return "";
  if (typeof student === "string") return student;
  return student.name || student.label || student.id || "";
}

function renderStudentChips(students = []) {
  const cleanStudents = (Array.isArray(students) ? students : [])
    .map(studentLabel)
    .filter(Boolean);

  if (!cleanStudents.length) return "";

  return `
    <span class="header-student-chip-list">
      ${cleanStudents.map((student) => `
        <span class="header-student-chip">${escapeHtml(student)}</span>
      `).join("")}
    </span>
  `;
}

function renderReadOnlySupplymark(status = false, label = "Add Supplies") {
  return `
    <span class="Supplymark-region Supplymark-region--readonly">
      <button
        type="button"
        class="header-Supplymark-btn ${
          status ? "header-Supplymark-btn--solid" : "header-Supplymark-btn--empty"
        }"
        disabled
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        <img
          src="img/icons/${
            status ? "supply-icon-active.png" : "supply-icon-inactive.png"
          }"
          alt=""
          class="header-Supplymark-icon"
        />
        <span>${escapeHtml(label)}</span>
      </button>
    </span>
  `;
}

function renderHeaderTools({
  saved = false,
  planningTags = [],
  variant = "item",
  showNotes = true,
} = {}) {
  const cleanTags = (Array.isArray(planningTags) ? planningTags : [])
    .map(tagLabel)
    .filter(Boolean);

  const label = variant === "all" ? "All Supplies" : "Add Supplies";

  return `
    <div class="card-header-tools">
      <div class="card-header-actions">
        ${renderReadOnlySupplymark(saved, label)}

        ${showNotes ? `
          <button
            type="button"
            class="note-btn"
            aria-label="Edit notes"
            title="Edit notes"
          >
            ✎
          </button>
        ` : ""}
      </div>

      ${cleanTags.length ? `
        <div class="planner-tag-list">
          ${cleanTags.map((tag) => `
            <span class="planner-tag-chip">
              ${escapeHtml(tag)}
            </span>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderSupplyCard(Supply) {
  const supplyId = Supply.supplyId || Supply.id || "";
  const localImage = supplyId ? `./img/supplies/${supplyId}.webp` : "";
  const fallbackImage = Supply.image || "";
  const placeholderImage = "./img/placeholders/Supply.svg";

  const badges = [
    Supply.optional ? { label: "Optional", className: "supply-badge--optional" } : null,
    Supply.groupSupply ? { label: "Group Supply", className: "supply-badge--group" } : null,
  ].filter(Boolean);
  
  const locationText = String(Supply.location || "").trim();
  const isbnText = String(Supply.isbn || "").trim();

  const purchaseOptions = [
    Supply.link1 ? { label: Supply.linkText1 || "Option 1", url: Supply.link1 } : null,
    Supply.link2 ? { label: Supply.linkText2 || "Option 2", url: Supply.link2 } : null,
  ].filter(Boolean);

  const discountText = [
    Supply.discount ? "Discount" : "",
    Supply.discountCode ? `with code ${Supply.discountCode}` : "",
    Supply.discountLink ? `using link ${Supply.discountLink}` : "",
  ].filter(Boolean).join(" ");

  const qtyText = formatSupplyMultilineText(Supply.qty, {
    preserveLeadingBlank: true,
  });

  const qtyHasLeadingList = hasIntentionalLeadingList(Supply.qty);
  
  const rationaleText = formatSupplyMultilineText(Supply.rationale, {
    preserveLeadingBlank: true,
  });
  
  const rationaleHasLeadingList = hasIntentionalLeadingList(Supply.rationale);
  
  const noteText = formatSupplyMultilineText(Supply.note);
  const maySubText = formatSupplyMultilineText(Supply.maySub);

  return `
    <article class="supply-card ${badges.length ? "" : "supply-card--no-badges"}">
      <div class="supply-card-Supplymark-corner">
        ${renderSupplySaveButton(Supply)}
      </div>

      ${badges.length ? `
        <div class="supply-card-badges">
          ${badges.map((badge) => `
            <span class="supply-badge ${badge.className}">${escapeHtml(badge.label)}</span>
          `).join("")}
        </div>
      ` : ""}

      <div class="supply-cover-wrap">
        <img
          class="supply-cover"
          src="${escapeHtml(localImage || fallbackImage || placeholderImage)}"
          data-fallback-src="${escapeHtml(fallbackImage || placeholderImage)}"
          data-placeholder-src="${escapeHtml(placeholderImage)}"
          alt=""
          loading="lazy"
          onerror="
            if (this.dataset.fallbackSrc && this.src !== this.dataset.fallbackSrc) {
              this.src = this.dataset.fallbackSrc;
              this.dataset.fallbackSrc = '';
            } else if (this.dataset.placeholderSrc && this.src !== this.dataset.placeholderSrc) {
              this.src = this.dataset.placeholderSrc;
            } else {
              this.style.display='none';
            }
          "
        >
      </div>

      <div class="supply-card-body">
        <div class="supply-main-row">
          <div class="supply-main-left">
            <h4 class="supply-card-title">${escapeHtml(Supply.title)}</h4>

            <div class="supply-subline">
              ${locationText ? `
                <div class="supply-subline-row">
                  ${escapeHtml(locationText)}
                </div>
              ` : ""}
              
              ${isbnText ? `
                <div class="supply-subline-row">
                  ISBN/ASIN: ${escapeHtml(isbnText)}
                </div>
              ` : ""}
            
              ${qtyText ? `
                <div class="supply-subline-row supply-subline-row--qty ${qtyHasLeadingList ? "supply-subline-row--qty-list" : ""}">
                  <span class="supply-qty-label">QTY:</span>
                  <span class="supply-qty-text">${qtyText}</span>
                </div>
              ` : ""}
            </div>

            ${rationaleText ? `
              <div class="supply-rationale ${rationaleHasLeadingList ? "supply-rationale--list" : ""}">
                <span class="supply-rationale-label">➜ RATIONALE:</span>
                <span class="supply-rationale-text">${rationaleText}</span>
              </div>
            ` : ""}

            ${(noteText || maySubText || discountText) ? `
              <div class="supply-tipbox">
                ${noteText ? `
                  <div class="supply-note-row">
                    <span class="supply-tipbox-label">NOTE:</span>
                    <span class="supply-note-text">${noteText}</span>
                  </div>
                ` : ""}

                ${maySubText ? `
                  <div class="supply-may-sub-row">
                    <span class="supply-tipbox-label">➜ May sub:</span>
                    <span class="supply-may-sub-text">${maySubText}</span>
                  </div>
                ` : ""}

                ${discountText ? `
                  <div class="supply-discount-row">
                    <span class="supply-tipbox-label">Discount:</span>
                    <span>${escapeHtml(discountText.replace(/^Discount\s*/, ""))}</span>
                  </div>
                ` : ""}
              </div>
            ` : ""}
          </div>

          <div class="supply-main-divider" aria-hidden="true"></div>

          <div class="supply-main-right">
            <div class="supply-scope-column">
              ${Supply.scope ? `
                <div class="supply-meta-block supply-meta-block--scope">
                  <div class="supply-meta-label">Scope</div>
                  <div class="supply-meta-text">${escapeHtml(Supply.scope)}</div>
                </div>
              ` : ""}
            </div>

            <div class="supply-actions-column">
              ${purchaseOptions.length ? `
                <div class="supply-meta-block supply-purchase-block">
                  <div class="supply-meta-label">Purchase Options</div>
                  <div class="supply-link-row">
                    ${purchaseOptions.map((option) => `
                      <a
                        class="supply-link-pill"
                        href="${escapeHtml(option.url)}"
                        target="_blank"
                        rel="noopener"
                      >
                        ${escapeHtml(option.label)}
                      </a>
                    `).join("")}
                  </div>
                </div>
              ` : ""}

              ${Supply.usedInText ? `
                <div class="supply-meta-block supply-shared-block">
                  <div class="supply-meta-label">Used In</div>
                  <div class="supply-meta-text">${escapeHtml(Supply.usedInText)}</div>
                </div>
              ` : ""}
            </div>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderCourseTopicMode(items) {
  return items.map((item) => {
    const visibleSections = (item.sections || []).filter((section) => {
      const normalizedSection = (section.title || "").trim().toLowerCase();
      const normalizedCourse = (item.title || "").trim().toLowerCase();

      return normalizedSection !== normalizedCourse;
    });

    const hasTopicSections = visibleSections.length > 0;

    const sectionsHtml = hasTopicSections
      ? visibleSections.map((section) => {
          const supplies = (section.supplies || []).filter((Supply) =>
            shouldIncludeSupplyByMemberFilters(Supply)
          );

          if (!supplies.length) return "";

          return `
            <section class="supply-section">
              <div class="supply-section-head">
                <div class="supply-section-head-left">
                  <div class="supply-title-with-students">
                    <h3>${section.shared ? "↔ " : ""}${escapeHtml(section.title)}</h3>
                    ${renderStudentChips(section.students || section.assignedStudents || [])}
                  </div>

                  ${(section.schedText || section.gradeText) ? `
                    <div class="supply-section-meta">
                      ${section.schedText ? `<span class="supply-meta-schedule">${escapeHtml(section.schedText)}</span>` : ""}
                      ${section.gradeText ? `<span class="supply-meta-grade">${escapeHtml(section.gradeText)}</span>` : ""}
                    </div>
                  ` : ""}
                </div>

                ${renderHeaderTools({
                  saved: isTopicSavedReadOnly(section),
                  planningTags: section.planningTags || section.tags || [],
                  variant: "item",
                  showNotes: true,
                })}
              </div>

              <div class="supply-card-list">
                ${supplies.map((Supply) => renderSupplyCard(Supply)).join("")}
              </div>
            </section>
          `;
        }).join("")
      : (() => {
          const supplies = (item.sections?.[0]?.supplies || []).filter((Supply) =>
            shouldIncludeSupplyByMemberFilters(Supply)
          );

          if (!supplies.length) return "";

          return `
            <section class="supply-section">
              ${
                item.subject === "Basic Supplies"
                  ? `
                    <div class="supply-section-head">
                      <div class="supply-section-head-left">
                        <div class="supply-title-with-students">
                          <h3>Basic Supplies</h3>
                        </div>
                      </div>
                    </div>
                  `
                  : ""
              }
          
              <div class="supply-card-list">
                ${supplies.map((Supply) => renderSupplyCard(Supply)).join("")}
              </div>
            </section>
          `;
        })();

    if (!sectionsHtml.trim()) return "";

    return `
      <section class="supply-course" style="--subject-color: ${subjectColor(item.subject)};">
        <div class="supply-course-head">
          <div class="supply-course-head-main">
            <div class="supply-course-head-left">
              <div class="supply-title-with-students">
                <h2>${item.shared ? "↔ " : ""}${escapeHtml(item.title)}</h2>
                ${renderStudentChips(item.students || item.assignedStudents || [])}
              </div>

              ${(item.schedText || item.gradeText || item.subject) ? `
                <div class="supply-section-meta supply-section-meta--course">
                  ${
                    item.subject === "Basic Supplies"
                      ? `<span class="supply-meta-subject">${escapeHtml(item.subject)}</span>`
                      : ""
                  }
              
                  ${item.schedText ? `<span class="supply-meta-schedule">${escapeHtml(item.schedText)}</span>` : ""}
                  ${item.gradeText ? `<span class="supply-meta-grade">${escapeHtml(item.gradeText)}</span>` : ""}
                </div>
              ` : ""}
            </div>

            ${renderHeaderTools({
              saved: isCourseSavedReadOnly(item),
              planningTags: item.planningTags || item.tags || [],
              variant: hasTopicSections ? "all" : "item",
              showNotes: !hasTopicSections,
            })}
          </div>
        </div>

        ${sectionsHtml}
      </section>
    `;
  }).join("");
}

function groupLabelWithSupplies(group) {
  const label = group.label || "";

  const isMasterView =
    (state.base === "subject" && state.id === DEFAULT_SUBJECT) ||
    (state.base === "grade" && state.id === DEFAULT_GRADE);

  if (isMasterView) return label;

  if (label.toLowerCase().includes("supplies")) {
    return label;
  }

  return `${label} Supplies`;
}

function currentSelectionHeading() {
  if (state.base === "subject" && state.id !== DEFAULT_SUBJECT) {
    if (state.id.toLowerCase().includes("supplies")) {
      return state.id;
    }

    return `${state.id} Supplies`;
  }

  if (state.base === "grade" && state.id !== DEFAULT_GRADE) {
    const gradeLabel = state.id.startsWith("G")
      ? `Grade ${state.id.replace("G", "")}`
      : state.id;

    return `${gradeLabel} Supplies`;
  }

  return "";
}

function countSuppliesInItems(items) {
  return (items || []).reduce(
    (total, item) =>
      total +
      (item.sections || []).reduce(
        (sectionTotal, section) => sectionTotal + (section.supplies || []).length,
        0
      ),
    0
  );
}

function isMasterView() {
  return (
    (state.base === "subject" && state.id === DEFAULT_SUBJECT) ||
    (state.base === "grade" && state.id === DEFAULT_GRADE)
  );
}

function renderAffiliateDisclosure() {
  return `
    <p class="supply-affiliate-disclosure">
      * As an Amazon Associate we earn from qualifying purchases, and we also receive a small commission at no additional cost to you through other affiliate links on this list.
    </p>
  `;
}

function renderSectionHeading(label, showDisclosure = false) {
  return `
    <div class="supply-results-heading">
      <h2 class="supply-group-title">${escapeHtml(label)}</h2>
      ${showDisclosure ? renderAffiliateDisclosure() : ""}
    </div>
  `;
}

function renderSelectedViewMode(items) {
  const heading = currentSelectionHeading();

  const isDirectBasicSuppliesView =
    !heading &&
    Array.isArray(items) &&
    items.some((item) => item.subject === "Basic Supplies");
  
  const shouldSplitBasicSupplies =
    state.base === "grade" &&
    state.id !== DEFAULT_GRADE &&
    Array.isArray(items);

  if (shouldSplitBasicSupplies) {
    const regularItems = items.filter((item) => item.subject !== "Basic Supplies");
    const basicSupplyItems = items.filter((item) => item.subject === "Basic Supplies");

    return `
      ${heading ? renderSectionHeading(heading, true) : ""}
      ${renderCourseTopicMode(regularItems)}
      ${basicSupplyItems.length ? `
        <section class="supply-group supply-group-section">
          ${renderSectionHeading("Basic Supplies", false)}
          ${renderCourseTopicMode(basicSupplyItems)}
        </section>
      ` : ""}
    `;
  }

  return `
    ${heading ? renderSectionHeading(heading, true) : ""}
    ${isDirectBasicSuppliesView ? renderSectionHeading("Basic Supplies", true) : ""}
    ${renderCourseTopicMode(items)}
  `;
}

function renderGroupedMode(groups) {
  let visibleGroupIndex = 0;

  return groups.map((group) => {
    const groupHtml = renderCourseTopicMode(group.items);

    if (!groupHtml.trim()) return "";

    const html = `
      <section class="supply-group supply-group-section">
        ${renderSectionHeading(groupLabelWithSupplies(group), visibleGroupIndex === 0)}
        ${groupHtml}
      </section>
    `;

    visibleGroupIndex += 1;
    return html;
  }).join("");
}

function render() {
  syncControls();

  const title = "Supply List";
  const groups = filteredGroups();
  const items = groups ? [] : filteredItems();

  const renderedHtml = groups ? renderGroupedMode(groups) : renderSelectedViewMode(items);
  const SupplyCount = groups ? groups.length : countSuppliesInItems(items);

  const pageTitle = document.getElementById("supply-title");
  if (pageTitle) pageTitle.textContent = title;
  const summary = document.getElementById("supply-summary");
  if (summary) summary.textContent = isMasterView() ? "" : "";

  const results = document.getElementById("supply-results");

  if (!SupplyCount) {
    results.innerHTML = `<div class="empty-state">No supplies match these selections.</div>`;
    return;
  }

  results.innerHTML = renderedHtml;
}

async function loadFilterIndex() {
  if (state.filterIndex) return;

  const response = await fetch("./data/supply-views/master.json");
  if (!response.ok) throw new Error("Could not load filter index");

  state.filterIndex = await response.json();
}

function scrollToWorkingTop(options = {}) {
  const { behavior = "smooth" } = options;
  const target = document.getElementById("supply-working-top");

  if (!target) return;

  target.scrollIntoView({
    behavior,
    block: "start",
  });
}

async function loadView(options = {}) {
  const { scrollToFilters = false, instantScroll = false } = options;

  const preserveScrollY = window.scrollY;

  const results = document.getElementById("supply-results");
  results.innerHTML = `<div class="empty-state">Loading Supply view…</div>`;

  if (scrollToFilters) {
    window.scrollTo(0, preserveScrollY);
  }

  const response = await fetch(viewPath(state.base, state.id));
    if (!response.ok) throw new Error(`Could not load ${viewPath(state.base, state.id)}`);
  
    const loadedData = await response.json();
  
  if (loadedData?.view === "topic" || loadedData?.view === "course") {
    state.data = {
      items: [loadedData],
    };
  } else {
    state.data = loadedData;
  }
  
  writeParams();
  render();

  if (scrollToFilters) {
    scrollToWorkingTop({
      behavior: instantScroll ? "auto" : "smooth",
    });
  }
}

function isFocusedDirectView() {
  const params = new URLSearchParams(window.location.search);

  const isDirectJsonView =
    state.view === "topic" ||
    state.view === "course" ||
    params.get("view") === "topic" ||
    params.get("view") === "course";

  const isLessonLink =
    params.get("source") === "lesson" ||
    params.get("compact") === "1";

  const hasSpecificCourseOrTopic =
    Boolean(params.get("course")) ||
    Boolean(params.get("topic"));

  const hasSpecificPrimary =
    state.id !== (state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE);

  return isDirectJsonView || isLessonLink || hasSpecificCourseOrTopic || hasSpecificPrimary;
}

function setIntroCollapsed(isCollapsed) {
  const intro = document.getElementById("supply-intro-section");
  const button = document.getElementById("toggle-intro");

  if (!intro || !button) return;

  intro.classList.toggle("is-collapsed", isCollapsed);
  button.textContent = isCollapsed ? "About this page" : "Hide intro";
}

function setFiltersCollapsed(isCollapsed) {
  const controls = document.getElementById("supply-controls");
  const button = document.getElementById("toggle-filters");

  if (!controls || !button) return;

  controls.classList.toggle("is-collapsed", isCollapsed);
  button.textContent = isCollapsed ? "Show" : "Hide";
}

function initializePageState() {
  const introCollapsed =
    typeof pageUiState.introCollapsed === "boolean"
      ? pageUiState.introCollapsed
      : true;

  const filtersCollapsed =
    typeof pageUiState.filtersCollapsed === "boolean"
      ? pageUiState.filtersCollapsed
      : true;

  setIntroCollapsed(introCollapsed);
  setFiltersCollapsed(filtersCollapsed);
}

function bindControls() {
  document.querySelectorAll(".supply-base-button").forEach((button) => {
    button.addEventListener("click", async () => {
      exitDirectView({
        base: button.dataset.base,
        id: button.dataset.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE,
      });

      await loadView({ scrollToFilters: true, instantScroll: true });
    });
  });

  document.getElementById("primary-select").addEventListener("change", async (event) => {
    const selectedBase = state.base || "subject";

    exitDirectView({
      base: selectedBase,
      id: event.target.value,
    });

    await loadView({ scrollToFilters: true, instantScroll: true });
  });

  document.getElementById("track-filter").addEventListener("change", async (event) => {
    if (state.view) {
      exitDirectView({
        base: "subject",
        id: DEFAULT_SUBJECT,
      });
    }

    state.track = event.target.value;
    state.course = "";
    state.topic = "";

    await loadView({ scrollToFilters: false, instantScroll: true });
  });

  document.getElementById("course-filter").addEventListener("change", async (event) => {
    if (state.view) {
      exitDirectView({
        base: "subject",
        id: DEFAULT_SUBJECT,
      });
    }

    state.course = event.target.value;
    state.topic = "";

    await loadView({ scrollToFilters: false, instantScroll: true });
  });

  document.getElementById("topic-filter").addEventListener("change", async (event) => {
    if (state.view) {
      exitDirectView({
        base: "subject",
        id: DEFAULT_SUBJECT,
      });
    }

    state.topic = event.target.value;

    await loadView({ scrollToFilters: false, instantScroll: true });
  });

  document.getElementById("supply-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  document.querySelectorAll(".clear-select").forEach((button) => {
    button.addEventListener("click", async () => {
      const clearType = button.dataset.clear;

      if (state.view) {
        exitDirectView({
          base: "subject",
          id: DEFAULT_SUBJECT,
        });
      }

      if (clearType === "primary") {
        state.id = state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE;
        state.course = "";
        state.topic = "";
        await loadView({ scrollToFilters: true, instantScroll: true });
        return;
      }

      if (clearType === "course") {
        state.course = "";
        state.topic = "";
        await loadView({ scrollToFilters: false, instantScroll: true });
        return;
      }

      if (clearType === "topic") {
        state.topic = "";
        await loadView({ scrollToFilters: false, instantScroll: true });
        return;
      }

      if (clearType === "track") {
        state.track = "";
        await loadView({ scrollToFilters: false, instantScroll: true });
        return;
      }
    });
  });

  document.getElementById("clear-filters").addEventListener("click", async () => {
    exitDirectView({
      base: "subject",
      id: DEFAULT_SUBJECT,
      keepSearch: false,
    });

    document.getElementById("supply-search").value = "";

    await loadView({ scrollToFilters: true, instantScroll: true });
  });

  document.querySelector(".supply-controls-header").addEventListener("click", () => {
    const controls = document.getElementById("supply-controls");
    const isCollapsed = !controls.classList.contains("is-collapsed");

    pageUiState.filtersCollapsed = isCollapsed;
    saveSupplyPageUiState();

    setFiltersCollapsed(isCollapsed);
  });

  document.getElementById("toggle-intro").addEventListener("click", () => {
    const intro = document.getElementById("supply-intro-section");
    const isCollapsed = !intro.classList.contains("is-collapsed");

    pageUiState.introCollapsed = isCollapsed;
    saveSupplyPageUiState();

    setIntroCollapsed(isCollapsed);
  });
}

function bindBackToTop() {
  const button = document.getElementById("back-to-top");

  if (!button) return;

  const toggleVisibility = () => {
    button.classList.toggle("is-visible", window.scrollY > 500);
  };

  window.addEventListener("scroll", toggleVisibility);

  button.addEventListener("click", () => {
    scrollToWorkingTop();
  });

  toggleVisibility();
}

const Supply_MEMBER_UI_KEY = "alveary_Supply_member_ui_v1";

const memberUiState = {
  toolsOpen: false,
  filters: {
    mySupplies: false,
    myCourses: false,
    myNotes: false,
  },
};

function loadSupplyMemberUiState() {
  try {
    const raw = localStorage.getItem(Supply_MEMBER_UI_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return;

    memberUiState.toolsOpen = !!saved.toolsOpen;

    if (saved.filters && typeof saved.filters === "object") {
      memberUiState.filters.mySupplies = !!(
        saved.filters.mySupplies || saved.filters.mySupplys
      );
      memberUiState.filters.myCourses = !!saved.filters.myCourses;
      memberUiState.filters.myNotes = !!saved.filters.myNotes;
    }
  } catch {
    // ignore bad saved state
  }
}

function saveSupplyMemberUiState() {
  try {
    localStorage.setItem(Supply_MEMBER_UI_KEY, JSON.stringify(memberUiState));
  } catch {
    // ignore storage errors
  }
}

function syncMemberToolsUi() {
  const toggle = document.getElementById("member-tools-toggle");
  const filterButtons = document.querySelectorAll(".member-mini-toggle");

  document.body.classList.toggle("member-tools-enabled", memberUiState.toolsOpen);

  if (toggle) {
    toggle.classList.toggle("is-active", memberUiState.toolsOpen);
    toggle.setAttribute("aria-pressed", memberUiState.toolsOpen ? "true" : "false");
    toggle.textContent = memberUiState.toolsOpen ? "Hide Member Tools" : "Show Member Tools";
  }

  filterButtons.forEach((button) => {
    const key = button.dataset.memberFilter;
    const active = !!memberUiState.filters[key];

    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function bindMemberToolsShell() {
  const toggle = document.getElementById("member-tools-toggle");
  const filterButtons = document.querySelectorAll(".member-mini-toggle");

  loadSupplyMemberUiState();
  syncMemberToolsUi();

  if (toggle) {
    toggle.addEventListener("click", () => {
      memberUiState.toolsOpen = !memberUiState.toolsOpen;

      saveSupplyMemberUiState();
      syncMemberToolsUi();
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.memberFilter;
      if (!key || !(key in memberUiState.filters)) return;

      memberUiState.filters[key] = !memberUiState.filters[key];

      saveSupplyMemberUiState();
      syncMemberToolsUi();

      render();
    });
  });
}

async function init() {
  try {
    readParams();
    loadSupplyPageUiState();
    loadSupplyMemberState();
    migrateLegacySupplyMemberStateOnce();
    bindControls();
    bindBackToTop();
    initializePageState();
    bindMemberToolsShell();
    await loadFilterIndex();
    await loadView();
  } catch (error) {
    console.error(error);
    document.getElementById("supply-results").innerHTML =
      `<div class="empty-state">Could not load this Supply view.</div>`;
  }
}

init();
