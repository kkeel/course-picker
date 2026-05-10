const DIRECTORY_INDEX_URL = "./data/alveary-directory-index.json";

const state = {
  rows: [],
  courses: [],
  topics: [],
  query: "",
  activeView: "course",
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

function bookDetailsUrl(item) {
  const base = "subject";
  const id = item.subject || "All Subjects";

  const params = new URLSearchParams();
  params.set("base", base);
  params.set("id", id);

  if (item.rowType === "topic") {
    params.set("topic", item.id);
  } else {
    params.set("course", item.id);
  }

  return `book-details.html?${params.toString()}`;
}

function renderCourseCard(item) {
  return `
    <article class="directory-card">
      <div class="card-topline">
        <h3 class="card-title">${escapeHtml(item.lessonSetName || item.title || "")}</h3>
        <span class="card-mini">${escapeHtml(item.subject || "Course")}</span>
      </div>

      <div class="card-meta">${escapeHtml(item.gradeText || "")}</div>

      <div class="card-actions">
        <a class="card-button" href="./${escapeHtml(bookDetailsUrl(item))}">
          Book Details
        </a>
      </div>
    </article>
  `;
}

function renderTopicCard(item) {
  return `
    <article class="topic-card">
      <div class="card-topline">
        <h3 class="card-title">${escapeHtml(item.lessonSetName || item.title || "")}</h3>
        <span class="card-mini">Topic</span>
      </div>

      <div class="card-meta">
        ${escapeHtml(item.gradeText || "")}
      </div>

      <div class="card-actions">
        <a class="card-button card-button-secondary" href="./${escapeHtml(bookDetailsUrl(item))}">
          Book Details
        </a>
      </div>
    </article>
  `;
}

function render() {
  const query = normalizeSearch(state.query);

  const visibleCourses = state.courses.filter((row) => rowMatchesQuery(row, query));
  const visibleTopics = state.topics.filter((row) => rowMatchesQuery(row, query));

  document.getElementById("directory-count").textContent =
    `${visibleCourses.length} courses`;

  const courseList = document.getElementById("course-list");
  const topicGroupList = document.getElementById("topic-group-list");

  courseList.innerHTML = visibleCourses.length
    ? visibleCourses.map(renderCourseCard).join("")
    : `<div class="empty-state">No matching courses found.</div>`;

  const topicsByCourseId = {};

  for (const topic of visibleTopics) {
    const key = topic.courseId || "uncategorized";

    if (!topicsByCourseId[key]) {
      topicsByCourseId[key] = {
        courseId: key,
        courseTitle: topic.courseTitle || "Other Topics",
        subject: topic.subject || "",
        topics: [],
      };
    }

    topicsByCourseId[key].topics.push(topic);
  }

  const groupedHtml = visibleCourses
    .map((course) => {
      const topicGroup = topicsByCourseId[course.id];

      if (topicGroup) {
        return `
          <section class="topic-group">
            <div class="topic-group-head">
              <h3 class="topic-group-title">${escapeHtml(course.lessonSetName || course.title || "")}</h3>
              <div class="topic-group-grade">${escapeHtml(course.gradeText || "")}</div>
            </div>
            <div class="topic-items">
              ${topicGroup.topics.map(renderTopicCard).join("")}
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

  topicGroupList.innerHTML = groupedHtml || `<div class="empty-state">No matching courses or topics found.</div>`;
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

async function initDirectory() {
  try {
    const response = await fetch(DIRECTORY_INDEX_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const index = await response.json();
    const rows = Array.isArray(index.rows) ? index.rows : [];

    state.rows = rows;
    state.courses = rows.filter((row) => row.rowType === "course");
    state.topics = rows.filter((row) => row.rowType === "topic");

    const searchInput = document.getElementById("directory-search");
    searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
      render();
    });

    document.querySelectorAll(".directory-toggle-button").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveView(button.dataset.view);
      });
    });

    setActiveView("course");
    render();
  } catch (error) {
    document.getElementById("course-list").innerHTML =
      `<div class="empty-state">Could not load course list.</div>`;

    document.getElementById("topic-group-list").innerHTML =
      `<div class="empty-state">Could not load topic groups.</div>`;

    document.getElementById("directory-count").textContent = "Load failed";
    console.error(error);
  }
}

initDirectory();
