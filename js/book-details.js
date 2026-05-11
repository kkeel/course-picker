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
    if (id === DEFAULT_SUBJECT) return "./data/book-views/master.json";
    return `./data/book-views/subject/${slugSubject(id)}.json`;
  }

  if (id === DEFAULT_GRADE) return "./data/book-views/master.json";
  return `./data/book-views/grade/${id}.json`;
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

function populateCourseTopicFilters() {
  const courseSelect = document.getElementById("course-filter");
  const topicSelect = document.getElementById("topic-filter");

  const items = (state.data?.items || []).filter(itemMatchesTrack);

  const courseStillExists = items.some((item) => item.id === state.course);
  if (!courseStillExists) {
    state.course = "";
    state.topic = "";
  }

  const selectedCourse = items.find((item) => item.id === state.course);
  const topicSourceItems = selectedCourse ? [selectedCourse] : items;

  const topics = [];

  for (const item of topicSourceItems) {
    for (const section of item.sections || []) {
      if (section.type === "topic") {
        topics.push({
          id: section.id,
          title: section.title,
          courseTitle: item.title,
        });
      }
    }
  }

  const topicStillExists = topics.some((topic) => topic.id === state.topic);
  if (!topicStillExists) state.topic = "";

  courseSelect.innerHTML = `
    <option value="">All courses</option>
    ${items.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>
    `).join("")}
  `;

  topicSelect.innerHTML = `
    <option value="">All topics</option>
    ${topics.map((topic) => `
      <option value="${escapeHtml(topic.id)}">
        ${escapeHtml(topic.courseTitle)} — ${escapeHtml(topic.title)}
      </option>
    `).join("")}
  `;

  courseSelect.value = state.course;
  topicSelect.value = state.topic;
}

function syncControls() {
  document.querySelectorAll(".book-base-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.base === state.base);
  });

  document.getElementById("track-filter").value = state.track;

  populatePrimarySelector();
  populateCourseTopicFilters();
}

function formatIcon(type) {
  if (type === "ebook") return "▣";
  if (type === "audiobook") return "▶";
  if (type === "video") return "◉";
  return "◆";
}

function renderBookCard(book) {
  const badges = [
    book.gradeLevelTag ? { label: book.gradeLevelTag, className: "book-badge--grade" } : null,
    book.optional ? { label: "Optional", className: "book-badge--optional" } : null,
    book.chooseOne ? { label: "Choose one", className: "book-badge--choose-one" } : null,
  ].filter(Boolean);

  const tipRows = [
    book.noteText ? { label: "NOTE:", text: book.noteText, className: "book-note-row" } : null,
    book.maySubText ? { label: "MAY SUBSTITUTE:", text: book.maySubText, className: "book-may-sub-row" } : null,
    book.discountText ? { label: "DISCOUNT:", text: book.discountText.replace(/^Discount:\s*/i, ""), className: "book-discount-row" } : null,
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
              ${book.isbn ? `<span>ISBN: ${escapeHtml(book.isbn)}</span>` : ""}
              ${book.asin ? `<span>ASIN: ${escapeHtml(book.asin)}</span>` : ""}
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
                    <span class="book-tipbox-label">ALT. FORMATS:</span>
                    <span class="book-format-list">
                      ${formatOptions.map((option) => `
                        <span class="book-format-pill book-format-pill--${escapeHtml(option.type || "other")}">
                          <span class="book-format-icon">${formatIcon(option.type)}</span>
                          ${escapeHtml(option.label)}
                        </span>
                      `).join("")}
                    </span>
                  </div>
                ` : ""}
              </div>
            ` : ""}
          </div>

          <div class="book-main-right">
            ${book.scopeText ? `
              <div class="book-meta-block">
                <div class="book-meta-label">Scope</div>
                <div class="book-meta-text">${escapeHtml(book.scopeText)}</div>
              </div>
            ` : ""}

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
                <div class="book-meta-label">↳ Also used in</div>
                <div class="book-meta-text">${escapeHtml(book.sharedText)}</div>
              </div>
            ` : ""}
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
          <h2>${escapeHtml(item.title)}</h2>
          <div>${escapeHtml(item.subject || "")} ${item.gradeText ? `• ${escapeHtml(item.gradeText)}` : ""}</div>
        </div>

        ${
          visibleSections.length
            ? visibleSections.map((section) => `
                <section class="book-section">
                  <h3>${escapeHtml(section.title)}</h3>

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

function render() {
  syncControls();

  const title = state.data?.title || "Book Details";
  const items = filteredItems();
  const bookCount = items.reduce(
    (total, item) => total + item.sections.reduce((sum, section) => sum + section.books.length, 0),
    0
  );

  document.getElementById("book-title").textContent = title;
  document.getElementById("book-summary").textContent = `${bookCount} books shown`;

  const results = document.getElementById("book-results");

  if (!items.length) {
    results.innerHTML = `<div class="empty-state">No books match these selections.</div>`;
    return;
  }

  results.innerHTML = renderCourseTopicMode(items);
}

async function loadView() {
  const results = document.getElementById("book-results");
  results.innerHTML = `<div class="empty-state">Loading book view…</div>`;

  const response = await fetch(viewPath(state.base, state.id));
  if (!response.ok) throw new Error(`Could not load ${viewPath(state.base, state.id)}`);

  state.data = await response.json();

  writeParams();
  render();
}

function bindControls() {
  document.querySelectorAll(".book-base-button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.base = button.dataset.base;
      state.id = state.base === "subject" ? DEFAULT_SUBJECT : DEFAULT_GRADE;
      state.course = "";
      state.topic = "";
      await loadView();
    });
  });

  document.getElementById("primary-select").addEventListener("change", async (event) => {
    state.id = event.target.value;
    state.course = "";
    state.topic = "";
    await loadView();
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
        await loadView();
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
    });
  });
}

async function init() {
  try {
    readParams();
    bindControls();
    await loadView();
  } catch (error) {
    console.error(error);
    document.getElementById("book-results").innerHTML =
      `<div class="empty-state">Could not load this book view.</div>`;
  }
}

init();
