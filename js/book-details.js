const SUBJECTS = [
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
  "Suggested Resources",
];

const GRADES = Array.from({ length: 12 }, (_, i) => `G${i + 1}`);

const state = {
  data: null,
  base: "grade",
  id: "G1",
  display: "course-topic",
  course: "",
  topic: "",
  query: "",
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
  if (base === "subject") return `./data/book-views/subject/${slugSubject(id)}.json`;
  return `./data/book-views/grade/${id}.json`;
}

function readParams() {
  const params = new URLSearchParams(window.location.search);

  state.base = params.get("base") || params.get("view") || "grade";
  state.id = params.get("id") || (state.base === "subject" ? "Science" : "G1");
  state.display = params.get("display") || "course-topic";
  state.course = params.get("course") || "";
  state.topic = params.get("topic") || "";
}

function writeParams() {
  const params = new URLSearchParams();

  params.set("base", state.base);
  params.set("id", state.id);
  params.set("display", state.display);

  if (state.course) params.set("course", state.course);
  if (state.topic) params.set("topic", state.topic);

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

function itemMatchesFilters(item) {
  if (state.course && item.id !== state.course) return false;

  if (state.topic) {
    return item.sections.some((section) => section.id === state.topic);
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

function populatePrimarySelectors() {
  const gradeSelect = document.getElementById("grade-select");
  const subjectSelect = document.getElementById("subject-select");

  gradeSelect.innerHTML = GRADES.map((grade) => `
    <option value="${grade}">Grade ${grade.replace("G", "")}</option>
  `).join("");

  subjectSelect.innerHTML = SUBJECTS.map((subject) => `
    <option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>
  `).join("");
}

function populateCourseTopicFilters() {
  const courseSelect = document.getElementById("course-filter");
  const topicSelect = document.getElementById("topic-filter");

  const items = state.data?.items || [];

  courseSelect.innerHTML = `
    <option value="">All courses</option>
    ${items.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>
    `).join("")}
  `;

  const topics = [];

  for (const item of items) {
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
  document.getElementById("base-select").value = state.base;
  document.getElementById("display-select").value = state.display;

  document.getElementById("grade-control").hidden = state.base !== "grade";
  document.getElementById("subject-control").hidden = state.base !== "subject";

  if (state.base === "grade") {
    document.getElementById("grade-select").value = state.id;
  } else {
    document.getElementById("subject-select").value = state.id;
  }
}

function renderBookCard(book) {
  const badges = [
    book.optional ? "Optional" : "",
    book.chooseOne ? "Choose One" : "",
    book.formatTags || "",
  ].filter(Boolean);

  return `
    <article class="book-card">
      <div class="book-cover-wrap">
        <img
          class="book-cover"
          src="./${escapeHtml(book.imagePath || book.placeholderPath || "")}"
          alt=""
          loading="lazy"
          onerror="this.style.display='none'"
        >
      </div>

      <div class="book-card-body">
        <div class="book-card-head">
          <h4 class="book-card-title">${escapeHtml(book.title)}</h4>
          ${badges.length ? `<div class="book-badges">${badges.map((b) => `<span>${escapeHtml(b)}</span>`).join("")}</div>` : ""}
        </div>

        ${book.author ? `<div class="book-author">${escapeHtml(book.author)}</div>` : ""}

        ${book.scopeText ? `<div class="book-meta"><strong>Used:</strong> ${escapeHtml(book.scopeText)}</div>` : ""}
        ${book.sharedText ? `<div class="book-meta"><strong>Also used in:</strong> ${escapeHtml(book.sharedText)}</div>` : ""}

        ${book.rationale ? `<p class="book-rationale">${escapeHtml(book.rationale)}</p>` : ""}
        ${book.notes ? `<p class="book-notes">${escapeHtml(book.notes)}</p>` : ""}
      </div>
    </article>
  `;
}

function renderCourseMode(items) {
  return items.map((item) => {
    const books = item.sections.flatMap((section) => section.books || []);

    return `
      <section class="book-course">
        <div class="book-course-head">
          <h2>${escapeHtml(item.title)}</h2>
          <div>${escapeHtml(item.subject || "")} ${item.gradeText ? `• ${escapeHtml(item.gradeText)}` : ""}</div>
        </div>
        <div class="book-card-list">
          ${books.map(renderBookCard).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function renderCourseTopicMode(items) {
  return items.map((item) => `
    <section class="book-course">
      <div class="book-course-head">
        <h2>${escapeHtml(item.title)}</h2>
        <div>${escapeHtml(item.subject || "")} ${item.gradeText ? `• ${escapeHtml(item.gradeText)}` : ""}</div>
      </div>

      ${(item.sections || []).map((section) => `
        <section class="book-section">
          <h3>${escapeHtml(section.title)}</h3>
          <div class="book-card-list">
            ${(section.books || []).map(renderBookCard).join("")}
          </div>
        </section>
      `).join("")}
    </section>
  `).join("");
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
  document.getElementById("book-summary").textContent =
    `${bookCount} books shown`;

  const results = document.getElementById("book-results");

  if (!items.length) {
    results.innerHTML = `<div class="empty-state">No books match these selections.</div>`;
    return;
  }

  results.innerHTML = state.display === "course"
    ? renderCourseMode(items)
    : renderCourseTopicMode(items);
}

async function loadView() {
  const results = document.getElementById("book-results");
  results.innerHTML = `<div class="empty-state">Loading book view…</div>`;

  const response = await fetch(viewPath(state.base, state.id));
  if (!response.ok) throw new Error(`Could not load ${viewPath(state.base, state.id)}`);

  state.data = await response.json();

  populateCourseTopicFilters();
  writeParams();
  render();
}

function bindControls() {
  document.getElementById("base-select").addEventListener("change", async (event) => {
    state.base = event.target.value;
    state.id = state.base === "subject" ? "Science" : "G1";
    state.course = "";
    state.topic = "";
    await loadView();
  });

  document.getElementById("grade-select").addEventListener("change", async (event) => {
    state.id = event.target.value;
    state.course = "";
    state.topic = "";
    await loadView();
  });

  document.getElementById("subject-select").addEventListener("change", async (event) => {
    state.id = event.target.value;
    state.course = "";
    state.topic = "";
    await loadView();
  });

  document.getElementById("display-select").addEventListener("change", (event) => {
    state.display = event.target.value;
    writeParams();
    render();
  });

  document.getElementById("course-filter").addEventListener("change", (event) => {
    state.course = event.target.value;
    if (state.course) state.topic = "";
    writeParams();
    populateCourseTopicFilters();
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
}

async function init() {
  try {
    readParams();
    populatePrimarySelectors();
    bindControls();
    await loadView();
  } catch (error) {
    console.error(error);
    document.getElementById("book-results").innerHTML =
      `<div class="empty-state">Could not load this book view.</div>`;
  }
}

init();
