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
    courses: {},
    topics: {},
    globalTopicTags: {},
    globalTopicStudents: {},
    globalTopicNotes: {},
  },

  openTools: new Set(),
  openTopics: new Set(),
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

function getCourseStateKey(row) {
  return String(row?.Sort_ID || row?.sortId || row?.courseId || row?.id || "").trim();
}

function getTopicId(row) {
  return String(row?.Topic_ID || row?.topicId || row?.topic_id || row?.id || "").trim();
}

function getTopicStateKey(row) {
  const courseKey = String(row?.courseId || row?.courseKey || row?.parentCourseId || "").trim();
  const topicId = getTopicId(row);

  if (!courseKey || !topicId) return "";
  return `${courseKey}::${topicId}`;
}

function getMemberRecordForRow(row) {
  const planner = state.plannerState || {};

  if (row?.rowType === "topic") {
    const instanceKey = getTopicStateKey(row);
    const topicId = getTopicId(row);
    const topicState = instanceKey ? planner.topics?.[instanceKey] : null;

    return {
      isBookmarked: !!topicState?.isBookmarked,
      tags: [
        ...(Array.isArray(topicState?.tags) ? topicState.tags : []),
        ...(Array.isArray(planner.globalTopicTags?.[topicId]) ? planner.globalTopicTags[topicId] : []),
      ],
      students: [
        ...(Array.isArray(topicState?.students) ? topicState.students : []),
        ...(Array.isArray(planner.globalTopicStudents?.[topicId]) ? planner.globalTopicStudents[topicId] : []),
      ].map(normalizeStudentId),
      noteText: planner.globalTopicNotes?.[topicId] || "",
    };
  }

  const courseKey = getCourseStateKey(row);
  const courseState = courseKey ? planner.courses?.[courseKey] : null;

  return {
    isBookmarked: !!courseState?.isBookmarked,
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

function getStudentById(id) {
  const sid = normalizeStudentId(id);
  return (state.plannerState.students || []).find(
    (student) => normalizeStudentId(student.id) === sid
  );
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

function renderActionButtons(item, options = {}) {
  const {
    type = "course",
    showTopicsToggle = false,
  } = options;

  const links = getActionLinks(item);

  const itemId = item.id || "";
  const toolsOpen = state.openTools.has(itemId);
  const topicsOpen = state.openTopics.has(itemId);

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
  if (!state.memberToolsEnabled) return "";

  const member = getMemberRecordForRow(item);
  const tags = [...new Set(member.tags || [])].filter(Boolean);
  const students = [...new Set(member.students || [])].filter(Boolean);
  const hasNote = String(member.noteText || "").trim().length > 0;

  const pieces = [];

  if (state.memberFilters.myCourses && member.isBookmarked) {
    pieces.push(`<span class="member-meta-chip member-meta-bookmark">★ My Course</span>`);
  }

  if (state.memberFilters.students && students.length) {
    pieces.push(
      ...students
        .map(getStudentById)
        .filter(Boolean)
        .map((student) => `
          <span
            class="member-meta-chip member-meta-student"
            style="--student-color:${escapeHtml(student.color || "#adb58f")};"
          >
            ${escapeHtml(student.name || "Student")}
          </span>
        `)
    );
  }

  if (state.memberFilters.planningTags && tags.length) {
    pieces.push(
      ...tags.map((tag) => `
        <span class="member-meta-chip member-meta-tag">
          ${escapeHtml(planningTagLabel(tag))}
        </span>
      `)
    );
  }

  if (hasNote) {
    pieces.push(`<span class="member-meta-chip member-meta-note">📝 Note</span>`);
  }

  if (!pieces.length) return "";

  return `
    <div class="member-card-meta">
      ${pieces.join("")}
    </div>
  `;
}

function renderCourseCard(item) {
  return `
    <article class="directory-card">
      <div class="card-topline">
        <h3 class="card-title">
          ${escapeHtml(item.lessonSetName || item.title || "")}
          <span class="title-grade">${escapeHtml(item.gradeText || "")}</span>
        </h3>
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
    <article class="topic-card">
      <div class="card-topline">
        <h3 class="card-title">
          ${escapeHtml(item.lessonSetName || item.title || "")}
          <span class="title-grade">${escapeHtml(item.gradeText || "")}</span>
        </h3>
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

    if (state.memberToolsEnabled) {
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
    }

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
            const topicsOpen = state.openTopics.has(course.id);
          
            return `
              <section class="topic-group ${topicsOpen ? "is-topics-open" : ""}">
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
            <section class="topic-group topic-group-course-only">
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
      courses: planner.courses || {},
      topics: planner.topics || {},
      globalTopicTags: planner.globalTopicTags || {},
      globalTopicStudents: planner.globalTopicStudents || {},
      globalTopicNotes: planner.globalTopicNotes || {},
    };

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

    await loadPlannerStateForLessonPlans();

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
      render();
    });
    
    document.querySelectorAll(".member-mini-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.memberFilter;
        if (!key) return;
    
        state.memberFilters[key] = !state.memberFilters[key];
    
        button.classList.toggle("is-active", !!state.memberFilters[key]);
        button.setAttribute("aria-pressed", state.memberFilters[key] ? "true" : "false");
    
        render();
      });
    });
    
    document.getElementById("planning-tag-filter")?.addEventListener("change", (event) => {
      state.selectedPlanningTag = event.target.value;
      render();
    });
    
    document.getElementById("student-filter")?.addEventListener("change", (event) => {
      state.selectedStudent = event.target.value;
      render();
    });

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
        render();
      });
    });

    document.getElementById("primary-select").addEventListener("change", async (event) => {
      state.selectedId = event.target.value;
      state.selectedCourse = "";
      state.selectedTopic = "";
    
      updateUrl();
      await loadSelectedView();
      render();
    });

    document.getElementById("track-filter").addEventListener("change", (event) => {
      state.selectedTrack = event.target.value;
    
      populateCourseFilter();
      populateTopicFilter();
    
      updateUrl();
      render();
    });

    document.getElementById("course-filter").addEventListener("change", (event) => {
      state.selectedCourse = event.target.value;
    
      state.selectedTopic = "";
      document.getElementById("topic-filter").value = "";
    
      populateTopicFilter();
    
      updateUrl();
      render();
    });

    document.getElementById("topic-filter").addEventListener("change", (event) => {
      state.selectedTopic = event.target.value;
      updateUrl();
      render();
    });

    const searchInput = document.getElementById("directory-search");
    searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
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
    
        render();
        return;
      }
    
      if (topicsButton) {
        const itemId = topicsButton.dataset.cardTopics;
    
        if (state.openTopics.has(itemId)) {
          state.openTopics.delete(itemId);
        } else {
          state.openTopics.add(itemId);
        }
    
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
          render();
          return;
        }
    
        if (target === "track") {
          state.selectedTrack = "";
          document.getElementById("track-filter").value = "";
    
          populateCourseFilter();
          populateTopicFilter();
    
          updateUrl();
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
          render();
          return;
        }
    
        if (target === "topic") {
          state.selectedTopic = "";
          document.getElementById("topic-filter").value = "";
    
          populateTopicFilter();
    
          updateUrl();
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
