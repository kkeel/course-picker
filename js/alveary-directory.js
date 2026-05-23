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

function renderActionButtons(item) {
  const links = getActionLinks(item);

  const actions = [
    {
      key: "lessonPdf",
      label: "Lesson PDF",
      icon: "📝",
      url: links.lessonPdf,
      primary: true,
      external: true,
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
      highlight: true,
    },
    {
      key: "books",
      label: "Book List Details",
      icon: "📚",
      url: links.books,
    },
    {
      key: "supplies",
      label: "Supply List Details",
      icon: "✂️",
      url: links.supplies,
    },
    {
      key: "editableSheet",
      label: "Editable Sheet",
      icon: "📊",
      url: links.editableSheet,
      external: true,
    },
  ].filter((action) => action.url);

  if (!actions.length) return "";

  return `
    <div class="card-actions card-action-grid">
      ${actions
        .map((action) => `
          <a
            class="card-action-link ${action.primary ? "is-primary" : ""} ${action.highlight ? "is-highlight" : ""}"
            href="${escapeHtml(action.url)}"
            target="_blank" rel="noopener"
          >
            <span class="card-action-icon">${escapeHtml(action.icon)}</span>
            <span class="card-action-label">${escapeHtml(action.label)}</span>
            <span class="card-action-arrow">↗</span>
          </a>
        `)
        .join("")}
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
        <span class="card-mini">${escapeHtml(item.subject || "Course")}</span>
      </div>

      ${renderActionButtons(item)}
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
        <span class="card-mini">Topic</span>
      </div>
      ${renderActionButtons(item)}
    </article>
  `;
}

function render() {
  const query = normalizeSearch(state.query);

  const visibleCourses = state.courses.filter((row) => rowMatchesQuery(row, query));
  const visibleTopics = state.topics.filter((row) => rowMatchesQuery(row, query));
  
  const topicGroupList = document.getElementById("topic-group-list");

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
              <div class="topic-group-topline">
                <div>
                  <h3 class="topic-group-title">
                    ${escapeHtml(course.lessonSetName || course.title || "")}
                    <span class="title-grade">${escapeHtml(course.gradeText || "")}</span>
                  </h3>
                </div>
                <span class="card-mini">${escapeHtml(course.subject || "Course")}</span>
              </div>
            
              ${renderActionButtons(course)}
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

    render();
  } catch (error) {
    document.getElementById("course-list").innerHTML =
      `<div class="empty-state">Could not load course list.</div>`;

    document.getElementById("topic-group-list").innerHTML =
      `<div class="empty-state">Could not load topic groups.</div>`;
    
    console.error(error);
  }
}

initDirectory();
