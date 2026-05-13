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
  base: "grade",
  id: DEFAULT_GRADE,
  course: "",
  topic: "",
  query: "",
  track: "",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  state.base = params.get("base") || "grade";
  state.id = params.get("id") || (state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE);
  state.course = params.get("course") || "";
  state.topic = params.get("topic") || "";
  state.track = params.get("track") || "";
}

function writeParams() {
  const params = new URLSearchParams();

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
                      ${purchaseOptions.map((option) => `
                        <span class="book-link-pill">${escapeHtml(option.label)}</span>
                      `).join("")}
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

    return `
      <section class="book-course" style="--subject-color: ${subjectColor(item.subject)};">
        <div class="book-course-head">
          <h2>${item.shared ? "↔ " : ""}${escapeHtml(item.title)}</h2>
        
          ${(item.schedText || item.gradeText || item.subject) ? `
            <div class="book-section-meta book-section-meta--course">
              ${item.schedText ? `<span class="book-meta-schedule">${escapeHtml(item.schedText)}</span>` : ""}
              ${item.gradeText ? `<span class="book-meta-grade">${escapeHtml(item.gradeText)}</span>` : ""}
            </div>
          ` : ""}
        </div>

        ${
          visibleSections.length
            ? visibleSections.map((section) => `
                <section class="book-section">
                  <h3>${section.shared ? "↔ " : ""}${escapeHtml(section.title)}</h3>

                    ${(section.schedText || section.gradeText) ? `
                      <div class="book-section-meta">
                        ${section.schedText ? `<span class="book-meta-schedule">${escapeHtml(section.schedText)}</span>` : ""}
                        ${section.gradeText ? `<span class="book-meta-grade">${escapeHtml(section.gradeText)}</span>` : ""}
                      </div>
                    ` : ""}

                  <div class="book-card-list">
                    ${(section.books || []).map(renderBookCard).join("")}
                  </div>
                </section>
              `).join("")
            : `
              <section class="book-section">
                <div class="book-card-list">
                  ${(item.sections?.[0]?.books || []).map(renderBookCard).join("")}
                </div>
              </section>
            `
        }
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
  return groups.map((group, index) => `
    <section class="book-group book-group-section">
      ${renderSectionHeading(groupLabelWithBooks(group), index === 0)}
      ${renderCourseTopicMode(group.items)}
    </section>
  `).join("");
}

function render() {
  syncControls();

  const title = "Book List";
  const groups = filteredGroups();
  const items = groups ? [] : filteredItems();

  const bookCount = groups
    ? groups.reduce(
        (total, group) =>
          total +
          group.items.reduce(
            (itemTotal, item) =>
              itemTotal +
              item.sections.reduce((sectionTotal, section) => sectionTotal + section.books.length, 0),
            0
          ),
        0
      )
    : items.reduce(
        (total, item) => total + item.sections.reduce((sum, section) => sum + section.books.length, 0),
        0
      );

  const pageTitle = document.getElementById("book-title");
  if (pageTitle) pageTitle.textContent = title;
  const summary = document.getElementById("book-summary");
  if (summary) summary.textContent = isMasterView() ? "" : "";

  const results = document.getElementById("book-results");

  if (!bookCount) {
    results.innerHTML = `<div class="empty-state">No books match these selections.</div>`;
    return;
  }

  results.innerHTML = groups ? renderGroupedMode(groups) : renderSelectedViewMode(items);
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

  state.data = await response.json();

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

  const isLessonLink =
    params.get("source") === "lesson" ||
    params.get("compact") === "1";

  const hasSpecificCourseOrTopic =
    Boolean(params.get("course")) ||
    Boolean(params.get("topic"));

  const hasSpecificPrimary =
    state.id !== (state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE);

  return isLessonLink || hasSpecificCourseOrTopic || hasSpecificPrimary;
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

  setIntroCollapsed(shouldCollapse);
  setFiltersCollapsed(shouldCollapse);
}

function bindControls() {
  document.querySelectorAll(".book-base-button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.base = button.dataset.base;
      state.id = state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE;
      state.course = "";
      state.topic = "";
      await loadView({ scrollToFilters: true, instantScroll: true });
    });
  });

  document.getElementById("primary-select").addEventListener("change", async (event) => {
    state.id = event.target.value;
    state.course = "";
    state.topic = "";
  
    await loadView({ scrollToFilters: true, instantScroll: true });
  });

  document.getElementById("track-filter").addEventListener("change", (event) => {
    state.track = event.target.value;
    state.course = "";
    state.topic = "";
    writeParams();
    render();
  });

  document.getElementById("course-filter").addEventListener("change", (event) => {
    state.course = event.target.value;
    state.topic = "";
    writeParams();
    render();
  });

  document.getElementById("topic-filter").addEventListener("change", (event) => {
    state.topic = event.target.value;
    writeParams();
    render();
  });

  document.getElementById("book-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  document.querySelectorAll(".clear-select").forEach((button) => {
    button.addEventListener("click", async () => {
      const clearType = button.dataset.clear;
  
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
        writeParams();
        render();
        return;
      }
  
      if (clearType === "topic") {
        state.topic = "";
        writeParams();
        render();
      }

      if (clearType === "track") {
        state.track = "";
        writeParams();
        render();
        return;
      }
      
    });
  });
  document.getElementById("clear-filters").addEventListener("click", async () => {
    state.id = state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE;
    state.course = "";
    state.topic = "";
    state.track = "";
    state.query = "";

    document.getElementById("book-search").value = "";

    await loadView({ scrollToFilters: true, instantScroll: true });
  });

  document.querySelector(".book-controls-header").addEventListener("click", () => {
    const controls = document.getElementById("book-controls");
    const isCollapsed = !controls.classList.contains("is-collapsed");
  
    setFiltersCollapsed(isCollapsed);
  });

  document.getElementById("toggle-intro").addEventListener("click", () => {
    const intro = document.getElementById("book-intro-section");
    const isCollapsed = !intro.classList.contains("is-collapsed");
  
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

function bindMemberToolsShell() {
  const toggle = document.getElementById("member-tools-toggle");
  const filterButtons = document.querySelectorAll(".member-mini-toggle");

  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const enabled = !document.body.classList.contains("member-tools-enabled");

    document.body.classList.toggle("member-tools-enabled", enabled);
    toggle.classList.toggle("is-active", enabled);
    toggle.setAttribute("aria-pressed", enabled ? "true" : "false");

    toggle.textContent = enabled
      ? "Member Tools: On"
      : "Member Tools: Off";
  });

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.toggle("is-active");
    });
  });
}

async function init() {
  try {
    readParams();
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
