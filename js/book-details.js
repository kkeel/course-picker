const ALVEARY_CONFIG = window.ALVEARY_CONFIG || {};

const SUBJECTS = ALVEARY_CONFIG.subjects || ["All Subjects"];
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

const BOOK_PAGE_UI_KEY = "alveary_book_page_ui_v1";

const pageUiState = {
  introCollapsed: null,
  filtersCollapsed: null,
};

function loadBookPageUiState() {
  try {
    const raw = localStorage.getItem(BOOK_PAGE_UI_KEY);
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

function saveBookPageUiState() {
  try {
    localStorage.setItem(BOOK_PAGE_UI_KEY, JSON.stringify(pageUiState));
  } catch {
    // ignore storage errors
  }
}

/* =========================================================
   Member Book State
   Canonical IDs:
   - book.resourceId = Airtable resource record ID
   - book.instanceKey = course/topic/resource instance from JSON
   ========================================================= */

const BOOK_MEMBER_STATE_KEY = "alveary_book_member_state_v1";

const bookMemberState = {
  version: 1,

  books: {
    // Global: resource is in My Books somewhere
    myBooks: [],

    // Instance ownership:
    // {
    //   "recResourceId": [
    //     "course:recCourseId:resource:recResourceId",
    //     "course:recCourseId:topic:recTopicId:resource:recResourceId"
    //   ]
    // }
    myBooksOwnersByResourceId: {},
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

function normalizeBookMemberState() {
  bookMemberState.books.myBooks = uniqueStrings(bookMemberState.books.myBooks);

  const ownersMap = bookMemberState.books.myBooksOwnersByResourceId || {};
  const nextOwnersMap = {};

  Object.entries(ownersMap).forEach(([resourceId, owners]) => {
    const rid = normalizeId(resourceId);
    if (!rid) return;

    const cleanOwners = uniqueStrings(owners);
    if (cleanOwners.length) {
      nextOwnersMap[rid] = cleanOwners;
    }
  });

  bookMemberState.books.myBooksOwnersByResourceId = nextOwnersMap;
}

function loadBookMemberState() {
  try {
    const raw = localStorage.getItem(BOOK_MEMBER_STATE_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);
    const savedBooks = saved?.books;

    if (!savedBooks || typeof savedBooks !== "object") return;

    bookMemberState.books.myBooks = Array.isArray(savedBooks.myBooks)
      ? savedBooks.myBooks
      : [];

    bookMemberState.books.myBooksOwnersByResourceId =
      savedBooks.myBooksOwnersByResourceId &&
      typeof savedBooks.myBooksOwnersByResourceId === "object"
        ? savedBooks.myBooksOwnersByResourceId
        : {};

    normalizeBookMemberState();
  } catch {
    // ignore bad saved state
  }
}

function saveBookMemberState() {
  try {
    normalizeBookMemberState();
    localStorage.setItem(BOOK_MEMBER_STATE_KEY, JSON.stringify(bookMemberState));
  } catch {
    // ignore storage errors
  }
}

const BOOK_MEMBER_LEGACY_MIGRATED_KEY = "alveary_book_member_legacy_migrated_v1";

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
    // If not, we let the global myBooks save behave as a legacy/global save.
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
    // If not, we let the global myBooks save behave as a legacy/global save.
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

function migrateLegacyBookMemberStateOnce() {
  try {
    if (localStorage.getItem(BOOK_MEMBER_LEGACY_MIGRATED_KEY) === "1") return;

    const plannerKey = resolveLegacyPlannerKey();
    if (!plannerKey) return;

    const raw = localStorage.getItem(plannerKey);
    if (!raw) return;

    const legacy = JSON.parse(raw);
    const legacyResources = legacy?.extras?.resources;

    if (!legacyResources || typeof legacyResources !== "object") return;

    const legacyMyBooks = Array.isArray(legacyResources.myBooks)
      ? legacyResources.myBooks
      : [];

    const legacyOwners =
      legacyResources.myBooksOwnersByResourceId &&
      typeof legacyResources.myBooksOwnersByResourceId === "object"
        ? legacyResources.myBooksOwnersByResourceId
        : {};

    bookMemberState.books.myBooks = uniqueStrings([
      ...bookMemberState.books.myBooks,
      ...legacyMyBooks,
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

      bookMemberState.books.myBooksOwnersByResourceId[rid] = uniqueStrings([
        ...bookOwnerKeys(rid),
        ...convertedOwners,
      ]);
    });

    normalizeBookMemberState();
    saveBookMemberState();

    localStorage.setItem(BOOK_MEMBER_LEGACY_MIGRATED_KEY, "1");
  } catch {
    // ignore migration errors
  }
}

function bookResourceId(book) {
  return normalizeId(book?.resourceId || book?.id);
}

function bookInstanceKey(book) {
  return normalizeId(book?.instanceKey);
}

function isBookInMyBooks(bookOrResourceId) {
  const resourceId =
    typeof bookOrResourceId === "string"
      ? normalizeId(bookOrResourceId)
      : bookResourceId(bookOrResourceId);

  if (!resourceId) return false;

  return bookMemberState.books.myBooks.includes(resourceId);
}

function bookOwnerKeys(resourceId) {
  const rid = normalizeId(resourceId);
  if (!rid) return [];

  const owners = bookMemberState.books.myBooksOwnersByResourceId?.[rid];
  return uniqueStrings(owners);
}

function isBookOwnedHere(book) {
  const resourceId = bookResourceId(book);
  const instanceKey = bookInstanceKey(book);

  if (!resourceId || !instanceKey) return false;

  return bookOwnerKeys(resourceId).includes(instanceKey);
}

function isBookGhostHere(book) {
  const resourceId = bookResourceId(book);
  const instanceKey = bookInstanceKey(book);

  if (!resourceId || !instanceKey) return false;
  if (!isBookInMyBooks(resourceId)) return false;

  const owners = bookOwnerKeys(resourceId);

  // Legacy/global-only saves behave as active everywhere until scoped.
  if (!owners.length) return false;

  return !owners.includes(instanceKey);
}

function bookSaveStatus(book) {
  if (isBookOwnedHere(book)) return "active";
  if (isBookGhostHere(book)) return "ghost";
  if (isBookInMyBooks(book)) return "legacy";
  return "empty";
}

/* =========================================================
   Read-only Course Planner Adapter
   Book page may READ course state,
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

function shouldIncludeBookByMemberFilters(book) {
  const filters = memberUiState.filters || {};

  // My Books filter:
  // show books saved HERE or legacy/global saved books
  // hide ghost-only copies
  if (filters.myBooks) {
    const status = bookSaveStatus(book);

    if (status !== "active" && status !== "legacy") {
      return false;
    }
  }

  return true;
}

function addBookOwnerHere(book) {
  const resourceId = bookResourceId(book);
  const instanceKey = bookInstanceKey(book);

  if (!resourceId) return;

  bookMemberState.books.myBooks = uniqueStrings([
    ...bookMemberState.books.myBooks,
    resourceId,
  ]);

  if (instanceKey) {
    const owners = bookOwnerKeys(resourceId);
    bookMemberState.books.myBooksOwnersByResourceId[resourceId] = uniqueStrings([
      ...owners,
      instanceKey,
    ]);
  }

  saveBookMemberState();
}

function removeBookOwnerHere(book) {
  const resourceId = bookResourceId(book);
  const instanceKey = bookInstanceKey(book);

  if (!resourceId) return;

  const owners = bookOwnerKeys(resourceId).filter((key) => key !== instanceKey);

  if (owners.length) {
    bookMemberState.books.myBooksOwnersByResourceId[resourceId] = owners;
  } else {
    delete bookMemberState.books.myBooksOwnersByResourceId[resourceId];
    bookMemberState.books.myBooks = bookMemberState.books.myBooks.filter(
      (id) => id !== resourceId
    );
  }

  saveBookMemberState();
}

function toggleBookSavedHere(book) {
  const status = bookSaveStatus(book);

  if (status === "active") {
    removeBookOwnerHere(book);
  } else {
    addBookOwnerHere(book);
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

async function handleBookProtectedLinkClick(event, linkEl) {
  const href = linkEl?.getAttribute("href") || "";
  const needsAuth =
    linkEl?.dataset?.memberOnly === "true" ||
    href.includes("alveary.org/login") ||
    href === "#";

  if (!needsAuth) return true;

  const auth = await window.AlvearyAuth?.whoami?.({ force: true });

  if (auth?.ok) {
    return true;
  }

  event.preventDefault();

  await window.AlvearyAuth?.openAuth?.("LOGIN");

  await window.AlvearyAuth?.whoami?.({ force: true });

  refreshMemberstackSecureLinks();

  return false;
}

function refreshMemberstackSecureLinks() {
  const existing = document.querySelector('script[data-memberstack-app]');
  if (!existing) return;

  const clone = document.createElement("script");
  clone.setAttribute(
    "data-memberstack-app",
    existing.getAttribute("data-memberstack-app") || ""
  );
  clone.src = existing.src;
  clone.type = "text/javascript";

  existing.parentNode.insertBefore(clone, existing.nextSibling);
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
    return `./data/book-views/topic/${encodeURIComponent(id)}.json`;
  }

  if (state.view === "course") {
    return `./data/book-views/course/${encodeURIComponent(id)}.json`;
  }

  if (base === "subject") {
    if (id === DEFAULT_SUBJECT) return "./data/book-views/by-subject.json";
    return `./data/book-views/subject/${slugSubject(id)}.json`;
  }

  if (id === DEFAULT_GRADE) return "./data/book-views/by-grade.json";
  return `./data/book-views/grade/${id}.json`;
}

function filteredGroups() {
  if (!Array.isArray(state.data?.groups)) return null;

  return state.data.groups
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
              books: (section.books || []).filter((book) => bookMatches(book, state.query)),
            }))
            .filter((section) => section.books.length);

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

function bookMatches(book, query) {
  if (!query) return true;

  const haystack = [
    book.title,
    book.author,
    book.rationale,
    book.notes,
    book.scopeText,
    book.sharedText,
    book.formatTags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function itemMatchesTrack(item) {
  if (!state.track) return true;

  const text = [
    item.title,
    item.subject,
    item.gradeText,
    ...(item.sections || []).map((section) => section.title),
  ].join(" ").toLowerCase();

  const isCanadian = text.includes("canadian") || text.includes("canada");
  const isUS = text.includes("u.s.") || text.includes("us ") || text.includes("american");

  if (state.track === "canadian") return isCanadian;
  if (state.track === "us") return !isCanadian;

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
          books: (section.books || []).filter((book) => bookMatches(book, state.query)),
        }))
        .filter((section) => section.books.length);

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

  const scopedFilterItems = isMasterView()
    ? filterIndexItems()
    : (state.data?.items || []);
  
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
  document.querySelectorAll(".book-base-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.base === state.base);
  });

  document.getElementById("track-filter").value = state.track;

  populatePrimarySelector();
  populateCourseTopicFilters();
  syncClearButtons();
}

function renderBookSaveButton(book) {
  const status = bookSaveStatus(book);
  const resourceId = bookResourceId(book);
  const instanceKey = bookInstanceKey(book);

  if (!resourceId || !instanceKey) return "";

  if (status === "active" || status === "legacy") {
    return `
      <span class="bookmark-region book-save-region">
        <button
          type="button"
          class="bookmark-btn bookmark-btn--solid book-save-btn"
          onclick="event.stopPropagation(); toggleBookSavedHereByInstanceKey('${escapeHtml(instanceKey)}')"
          aria-label="Remove from My Books"
          title="In My Books"
        >
          <img src="img/icons/book-icon-active.png" alt="" class="bookmark-icon" />
        </button>
      </span>
    `;
  }

  if (status === "ghost") {
    return `
      <span class="bookmark-region book-save-region">
        <button
          type="button"
          class="bookmark-btn bookmark-btn--ghost book-save-btn"
          onclick="event.stopPropagation(); addBookOwnerHereByInstanceKey('${escapeHtml(instanceKey)}')"
          aria-label="In My Books elsewhere — add here"
          title="In My Books elsewhere — add here"
        >
          <img src="img/icons/book-icon-active.png" alt="" class="bookmark-icon" />
          <span class="bookmark-apply">+</span>
        </button>
      </span>
    `;
  }

  return `
    <span class="bookmark-region book-save-region">
      <button
        type="button"
        class="bookmark-btn bookmark-btn--empty book-save-btn"
        onclick="event.stopPropagation(); toggleBookSavedHereByInstanceKey('${escapeHtml(instanceKey)}')"
        aria-label="Add to My Books"
        title="Add to My Books"
      >
        <img src="img/icons/book-icon-inactive.png" alt="" class="bookmark-icon" />
        <span class="bookmark-apply">+</span>
      </button>
    </span>
  `;
}

function findBookByInstanceKey(instanceKey) {
  const key = normalizeId(instanceKey);
  if (!key) return null;

  const sourceItems = state.data?.items || [];
  const sourceGroups = state.data?.groups || [];

  const items = Array.isArray(sourceGroups) && sourceGroups.length
    ? sourceGroups.flatMap((group) => group.items || [])
    : sourceItems;

  for (const item of items) {
    for (const section of item.sections || []) {
      for (const book of section.books || []) {
        if (bookInstanceKey(book) === key) {
          return book;
        }
      }
    }
  }

  return null;
}

function toggleBookSavedHereByInstanceKey(instanceKey) {
  const book = findBookByInstanceKey(instanceKey);
  if (!book) return;

  toggleBookSavedHere(book);
}

function addBookOwnerHereByInstanceKey(instanceKey) {
  const book = findBookByInstanceKey(instanceKey);
  if (!book) return;

  addBookOwnerHere(book);
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

function renderReadOnlyBookmark(status = false, label = "Add Books") {
  return `
    <span class="bookmark-region bookmark-region--readonly">
      <button
        type="button"
        class="header-bookmark-btn ${
          status ? "header-bookmark-btn--solid" : "header-bookmark-btn--empty"
        }"
        disabled
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        <img
          src="img/icons/${
            status ? "book-icon-active.png" : "book-icon-inactive.png"
          }"
          alt=""
          class="header-bookmark-icon"
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

  const label = variant === "all" ? "All Books" : "Add Books";

  return `
    <div class="card-header-tools">
      <div class="card-header-actions">
        ${renderReadOnlyBookmark(saved, label)}

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

function renderBookCard(book) {
  const badges = [
    book.gradeLevelTag ? { label: book.gradeLevelTag, className: "book-badge--grade" } : null,
    book.optional ? { label: "Optional", className: "book-badge--optional" } : null,
    book.chooseOne ? { label: "Choose one", className: "book-badge--choose-one" } : null,
  ].filter(Boolean);

  const tipRows = [
    book.noteText ? { label: "NOTE:", text: book.noteText, className: "book-note-row" } : null,
    book.maySubText ? { label: "➜ May sub:", text: book.maySubText, className: "book-may-sub-row" } : null,
    // Hide discount/code on the public view for now.
    // We can restore this later inside Member Tools mode.
    null,
  ].filter(Boolean);

  const formatOptions = Array.isArray(book.formatOptions) ? book.formatOptions : [];
  const purchaseOptions = Array.isArray(book.purchaseOptions) ? book.purchaseOptions : [];

  return `
    <article class="book-card">
      <div class="book-card-bookmark-corner">
        ${renderBookSaveButton(book)}
      </div>
      ${badges.length ? `
        <div class="book-card-badges">
          ${badges.map((badge) => `
            <span class="book-badge ${badge.className}">${escapeHtml(badge.label)}</span>
          `).join("")}
        </div>
      ` : ""}

      <div class="book-cover-wrap">
        <img
          class="book-cover"
          src="./${escapeHtml(book.imagePath || book.placeholderPath || "")}"
          alt=""
          loading="lazy"
          onerror="
            if (this.dataset.fallback !== 'placeholder') {
              this.dataset.fallback = 'placeholder';
              this.src = './img/placeholders/book.svg';
            } else {
              this.style.display='none';
            }
          "
        >
      </div>

      <div class="book-card-body">
        <div class="book-main-row">
          <div class="book-main-left">
            <h4 class="book-card-title">${escapeHtml(book.title)}</h4>

            <div class="book-subline">
              ${book.author ? `<span>by ${escapeHtml(book.author)}</span>` : ""}
              ${book.isbnAsin ? `<span>ISBN/ASIN: ${escapeHtml(book.isbnAsin)}</span>` : ""}
              ${!book.isbnAsin && book.isbn ? `<span>ISBN: ${escapeHtml(book.isbn)}</span>` : ""}
              ${!book.isbnAsin && book.asin ? `<span>ASIN: ${escapeHtml(book.asin)}</span>` : ""}
            </div>

            ${book.rationale ? `
              <p class="book-rationale">
                <span class="book-rationale-label">➜ RATIONALE:</span>
                <span>${escapeHtml(book.rationale)}</span>
              </p>
            ` : ""}

            ${(tipRows.length || formatOptions.length) ? `
              <div class="book-tipbox">
                ${tipRows.map((row) => `
                  <div class="${row.className}">
                    <span class="book-tipbox-label">${escapeHtml(row.label)}</span>
                    <span>${escapeHtml(row.text)}</span>
                  </div>
                `).join("")}

                ${formatOptions.length ? `
                  <div class="book-format-row">
                    <span class="book-tipbox-label">Alt. Formats:</span>
                    <span class="book-format-list">
                      ${formatOptions.map((option) => `
                        <span class="book-format-pill book-format-pill--${escapeHtml(option.type || "other")}">
                          ${escapeHtml(option.label)}
                        </span>
                      `).join("")}
                    </span>
                  </div>
                ` : ""}
              </div>
            ` : ""}
          </div>

          <div class="book-main-divider" aria-hidden="true"></div>

            <div class="book-main-right">
              <div class="book-scope-column">
                ${book.scopeText ? `
                  <div class="book-meta-block book-meta-block--scope">
                    <div class="book-meta-label">Scope</div>
                    <div class="book-meta-text">${escapeHtml(book.scopeText)}</div>
                  </div>
                ` : ""}
              </div>
            
              <div class="book-actions-column">
                ${purchaseOptions.length ? `
                  <div class="book-meta-block book-purchase-block">
                    <div class="book-meta-label">Purchase Options</div>
                    <div class="book-link-row">
                      ${purchaseOptions.map((option) => {
                        const label = option.label || "Link";
                        const url = option.url || "";
                        const memberstackId = option.memberstackId || "";
                        const isMemberOnly = Boolean(option.memberOnly && memberstackId);
                      
                        if (isMemberOnly) {
                          return `
                            <a
                              class="book-link-pill book-link-pill--member"
                              href="#"
                              data-member-only="true"
                              data-ms-secure-link="${escapeHtml(memberstackId)}"
                              onclick="return handleBookProtectedLinkClick(event, this)"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              ${escapeHtml(label)}
                            </a>
                          `;
                        }
                      
                        if (!url) {
                          return `<span class="book-link-pill book-link-pill--disabled">${escapeHtml(label)}</span>`;
                        }
                      
                        return `
                          <a
                            class="book-link-pill"
                            href="${escapeHtml(url)}"
                            target="_blank"
                            rel="sponsored noopener noreferrer"
                          >
                            ${escapeHtml(label)}
                          </a>
                        `;
                      }).join("")}
                    </div>
                  </div>
                ` : ""}
            
                ${book.sharedText ? `
                  <div class="book-meta-block book-shared-block">
                    <div class="book-meta-label">↔ Shared</div>
                    <div class="book-meta-text">${escapeHtml(book.sharedText)}</div>
                  </div>
                ` : ""}
              </div>
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
          const books = (section.books || []).filter((book) =>
            shouldIncludeBookByMemberFilters(book)
          );

          if (!books.length) return "";

          return `
            <section class="book-section">
              <div class="book-section-head">
                <div class="book-section-head-left">
                  <div class="book-title-with-students">
                    <h3>${section.shared ? "↔ " : ""}${escapeHtml(section.title)}</h3>
                    ${renderStudentChips(section.students || section.assignedStudents || [])}
                  </div>

                  ${(section.schedText || section.gradeText) ? `
                    <div class="book-section-meta">
                      ${section.schedText ? `<span class="book-meta-schedule">${escapeHtml(section.schedText)}</span>` : ""}
                      ${section.gradeText ? `<span class="book-meta-grade">${escapeHtml(section.gradeText)}</span>` : ""}
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

              <div class="book-card-list">
                ${books.map((book) => renderBookCard(book)).join("")}
              </div>
            </section>
          `;
        }).join("")
      : (() => {
          const books = (item.sections?.[0]?.books || []).filter((book) =>
            shouldIncludeBookByMemberFilters(book)
          );

          if (!books.length) return "";

          return `
            <section class="book-section">
              <div class="book-card-list">
                ${books.map((book) => renderBookCard(book)).join("")}
              </div>
            </section>
          `;
        })();

    if (!sectionsHtml.trim()) return "";

    return `
      <section class="book-course" style="--subject-color: ${subjectColor(item.subject)};">
        <div class="book-course-head">
          <div class="book-course-head-main">
            <div class="book-course-head-left">
              <div class="book-title-with-students">
                <h2>${item.shared ? "↔ " : ""}${escapeHtml(item.title)}</h2>
                ${renderStudentChips(item.students || item.assignedStudents || [])}
              </div>

              ${(item.schedText || item.gradeText || item.subject) ? `
                <div class="book-section-meta book-section-meta--course">
                  ${item.schedText ? `<span class="book-meta-schedule">${escapeHtml(item.schedText)}</span>` : ""}
                  ${item.gradeText ? `<span class="book-meta-grade">${escapeHtml(item.gradeText)}</span>` : ""}
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

function groupLabelWithBooks(group) {
  const label = group.label || "";
  const isMasterView =
    (state.base === "subject" && state.id === DEFAULT_SUBJECT) ||
    (state.base === "grade" && state.id === DEFAULT_GRADE);

  if (isMasterView) return label;

  return `${label} Books`;
}

function currentSelectionHeading() {
  if (state.base === "subject" && state.id !== DEFAULT_SUBJECT) {
    return `${state.id} Books`;
  }

  if (state.base === "grade" && state.id !== DEFAULT_GRADE) {
    const gradeLabel = state.id.startsWith("G")
      ? `Grade ${state.id.replace("G", "")}`
      : state.id;

    return `${gradeLabel} Books`;
  }

  return "";
}

function countBooksInItems(items) {
  return (items || []).reduce(
    (total, item) =>
      total +
      (item.sections || []).reduce(
        (sectionTotal, section) => sectionTotal + (section.books || []).length,
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
    <p class="book-affiliate-disclosure">
      * As an Amazon Associate we earn from qualifying purchases, and we also receive a small commission at no additional cost to you through other affiliate links on this list.
    </p>
  `;
}

function renderSectionHeading(label, showDisclosure = false) {
  return `
    <div class="book-results-heading">
      <h2 class="book-group-title">${escapeHtml(label)}</h2>
      ${showDisclosure ? renderAffiliateDisclosure() : ""}
    </div>
  `;
}

function renderSelectedViewMode(items) {
  const heading = currentSelectionHeading();

  return `
    ${heading ? renderSectionHeading(heading, true) : ""}
    ${renderCourseTopicMode(items)}
  `;
}

function renderGroupedMode(groups) {
  let visibleGroupIndex = 0;

  return groups.map((group) => {
    const groupHtml = renderCourseTopicMode(group.items);

    if (!groupHtml.trim()) return "";

    const html = `
      <section class="book-group book-group-section">
        ${renderSectionHeading(groupLabelWithBooks(group), visibleGroupIndex === 0)}
        ${groupHtml}
      </section>
    `;

    visibleGroupIndex += 1;
    return html;
  }).join("");
}

function render() {
  syncControls();

  const title = "Book List";
  const groups = filteredGroups();
  const items = groups ? [] : filteredItems();

  const renderedHtml = groups ? renderGroupedMode(groups) : renderSelectedViewMode(items);
  const bookCount = renderedHtml.trim() ? 1 : 0;

  const pageTitle = document.getElementById("book-title");
  if (pageTitle) pageTitle.textContent = title;

  const summary = document.getElementById("book-summary");
  if (summary) summary.textContent = isMasterView() ? "" : "";

  const results = document.getElementById("book-results");

  if (!bookCount) {
    results.innerHTML = `<div class="empty-state">No books match these selections.</div>`;
    setTimeout(refreshMemberstackSecureLinks, 0);
    return;
  }

  results.innerHTML = renderedHtml;
  setTimeout(refreshMemberstackSecureLinks, 0);
}

async function loadFilterIndex() {
  if (state.filterIndex) return;

  const response = await fetch("./data/book-views/master.json");
  if (!response.ok) throw new Error("Could not load filter index");

  state.filterIndex = await response.json();
}

function scrollToWorkingTop(options = {}) {
  const { behavior = "smooth" } = options;
  const target = document.getElementById("book-working-top");

  if (!target) return;

  target.scrollIntoView({
    behavior,
    block: "start",
  });
}

async function loadView(options = {}) {
  const { scrollToFilters = false, instantScroll = false } = options;

  const preserveScrollY = window.scrollY;

  const results = document.getElementById("book-results");
  results.innerHTML = `<div class="empty-state">Loading book view…</div>`;

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
  const intro = document.getElementById("book-intro-section");
  const button = document.getElementById("toggle-intro");

  if (!intro || !button) return;

  intro.classList.toggle("is-collapsed", isCollapsed);
  button.textContent = isCollapsed ? "About this page" : "Hide intro";
}

function setFiltersCollapsed(isCollapsed) {
  const controls = document.getElementById("book-controls");
  const button = document.getElementById("toggle-filters");

  if (!controls || !button) return;

  controls.classList.toggle("is-collapsed", isCollapsed);
  button.textContent = isCollapsed ? "Show" : "Hide";
}

function initializePageState() {
  const shouldCollapse = isFocusedDirectView();

  const introCollapsed =
    typeof pageUiState.introCollapsed === "boolean"
      ? pageUiState.introCollapsed
      : shouldCollapse;

  const filtersCollapsed =
    typeof pageUiState.filtersCollapsed === "boolean"
      ? pageUiState.filtersCollapsed
      : shouldCollapse;

  setIntroCollapsed(introCollapsed);
  setFiltersCollapsed(filtersCollapsed);
}

function bindControls() {
  document.querySelectorAll(".book-base-button").forEach((button) => {
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

  document.getElementById("book-search").addEventListener("input", (event) => {
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

    document.getElementById("book-search").value = "";

    await loadView({ scrollToFilters: true, instantScroll: true });
  });

  document.querySelector(".book-controls-header").addEventListener("click", () => {
    const controls = document.getElementById("book-controls");
    const isCollapsed = !controls.classList.contains("is-collapsed");

    pageUiState.filtersCollapsed = isCollapsed;
    saveBookPageUiState();

    setFiltersCollapsed(isCollapsed);
  });

  document.getElementById("toggle-intro").addEventListener("click", () => {
    const intro = document.getElementById("book-intro-section");
    const isCollapsed = !intro.classList.contains("is-collapsed");

    pageUiState.introCollapsed = isCollapsed;
    saveBookPageUiState();

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

const BOOK_MEMBER_UI_KEY = "alveary_book_member_ui_v1";

const memberUiState = {
  toolsOpen: false,
  filters: {
    myBooks: false,
    myCourses: false,
    myNotes: false,
  },
};

function loadBookMemberUiState() {
  try {
    const raw = localStorage.getItem(BOOK_MEMBER_UI_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return;

    memberUiState.toolsOpen = !!saved.toolsOpen;

    if (saved.filters && typeof saved.filters === "object") {
      memberUiState.filters.myBooks = !!saved.filters.myBooks;
      memberUiState.filters.myCourses = !!saved.filters.myCourses;
      memberUiState.filters.myNotes = !!saved.filters.myNotes;
    }
  } catch {
    // ignore bad saved state
  }
}

function saveBookMemberUiState() {
  try {
    localStorage.setItem(BOOK_MEMBER_UI_KEY, JSON.stringify(memberUiState));
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

  loadBookMemberUiState();
  syncMemberToolsUi();

  if (toggle) {
    toggle.addEventListener("click", () => {
      memberUiState.toolsOpen = !memberUiState.toolsOpen;

      saveBookMemberUiState();
      syncMemberToolsUi();
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.memberFilter;
      if (!key || !(key in memberUiState.filters)) return;

      memberUiState.filters[key] = !memberUiState.filters[key];

      saveBookMemberUiState();
      syncMemberToolsUi();

      render();
    });
  });
}

async function init() {
  try {
    readParams();
    loadBookPageUiState();
    loadBookMemberState();
    migrateLegacyBookMemberStateOnce();
    bindControls();
    bindBackToTop();
    initializePageState();
    bindMemberToolsShell();
    await loadFilterIndex();
    await loadView();
  } catch (error) {
    console.error(error);
    document.getElementById("book-results").innerHTML =
      `<div class="empty-state">Could not load this book view.</div>`;
  }
}

init();
