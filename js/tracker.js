const TRACKER_APP_CACHE_VERSION = window.APP_CACHE_VERSION || "2025-12-09-v1";
const TRACKER_PLANNER_KEY = window.PLANNER_STATE_KEY || `alveary_planner_${TRACKER_APP_CACHE_VERSION}`;

function readPlannerState() {
  try {
    const raw = localStorage.getItem(TRACKER_PLANNER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Could not read tracker planner state", error);
    return {};
  }
}

function percent(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function summarizeOptions(optionsByResourceId = {}) {
  const rows = Object.values(optionsByResourceId || {}).flatMap(value =>
    Array.isArray(value) ? value : []
  );

  const total = rows.length;
  const ready = rows.filter(row => String(row?.status || "").toLowerCase() === "ready").length;
  const received = rows.filter(row => String(row?.status || "").toLowerCase() === "received").length;
  const ordered = rows.filter(row => String(row?.status || "").toLowerCase() === "ordered").length;
  const inProgress = rows.filter(row => String(row?.status || "").toLowerCase() === "in_progress").length;
  const notReady = rows.filter(row => {
    const status = String(row?.status || "not_ready").toLowerCase();
    return status === "not_ready" || !status;
  }).length;

  return {
    total,
    ready,
    received,
    ordered,
    inProgress,
    notReady,
    percent: percent(ready, total),
  };
}

function summarizeLessonPlans(plannerState) {
  const lessonPlans = plannerState?.extras?.lessonPlans?.items || {};
  const rows = Object.values(lessonPlans);

  const total = rows.length;
  const ready = rows.filter(row => String(row?.status || "") === "ready").length;
  const downloaded = rows.filter(row => String(row?.status || "") === "downloaded").length;
  const printed = rows.filter(row => String(row?.status || "") === "printed").length;

  return {
    total,
    ready,
    downloaded,
    printed,
    percent: percent(ready, total),
  };
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBar(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function ledgerGroup(title, rows) {
  return `
    <section class="tracker-ledger-group">
      <div class="tracker-ledger-group-title">${title}</div>
      <div class="tracker-ledger-group-rows">
        ${rows.join("")}
      </div>
    </section>
  `;
}

function ledgerRow(label, value) {
  return `
    <div class="tracker-ledger-row">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderTracker() {
  const plannerState = readPlannerState();

  const books = summarizeOptions(
    plannerState?.extras?.resources?.optionsByResourceId || {}
  );

  const supplies = summarizeOptions(
    plannerState?.extras?.supplies?.optionsByResourceId || {}
  );

  const lessons = summarizeLessonPlans(plannerState);

  const activeCategories = [books, supplies, lessons].filter(x => x.total > 0);
  const overall = activeCategories.length
    ? Math.round(activeCategories.reduce((sum, item) => sum + item.percent, 0) / activeCategories.length)
    : 0;

  setText("overallPercent", `${overall}%`);
  setBar("overallBar", overall);

  setText("booksPercent", `${books.percent}%`);
  setText(
    "booksSummary",
    books.total
      ? `${books.ready} of ${books.total} prep items ready`
      : "No book prep tracking yet."
  );

  setText("suppliesPercent", `${supplies.percent}%`);
  setText(
    "suppliesSummary",
    supplies.total
      ? `${supplies.ready} of ${supplies.total} prep items ready`
      : "No supply prep tracking yet."
  );

  setText("lessonPercent", `${lessons.percent}%`);
  setText(
    "lessonSummary",
    lessons.total
      ? `${lessons.ready} of ${lessons.total} lesson plans ready`
      : "Lesson plan tracking will be added next."
  );

  const ledger = document.getElementById("trackerLedgerRows");
  if (ledger) {
        ledger.innerHTML = [
      ledgerGroup("Books", [
        ledgerRow("Ready", `${books.ready} / ${books.total}`),
        ledgerRow("Received", books.received),
        ledgerRow("Ordered", books.ordered),
        ledgerRow("In Progress", books.inProgress),
      ]),
      ledgerGroup("Supplies", [
        ledgerRow("Ready", `${supplies.ready} / ${supplies.total}`),
        ledgerRow("Received", supplies.received),
        ledgerRow("Ordered", supplies.ordered),
        ledgerRow("In Progress", supplies.inProgress),
      ]),
      ledgerGroup("Lesson Plans", [
        ledgerRow("Ready for School", `${lessons.ready} / ${lessons.total}`),
        ledgerRow("Downloaded", lessons.downloaded),
        ledgerRow("Printed", lessons.printed),
      ]),
    ].join("");
  }
}

function initTabs() {
  document.querySelectorAll(".tracker-tab").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tracker-tab").forEach(btn =>
        btn.classList.remove("is-active")
      );
      button.classList.add("is-active");
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderTracker();
  initTabs();

  window.addEventListener("storage", event => {
    if (event.key === TRACKER_PLANNER_KEY) renderTracker();
  });
});
