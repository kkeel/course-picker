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

function prettyPrepText(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function renderPrepRow(row, isReady = false) {
  const check = isReady ? "✓" : "";
  const title = row.title || `Resource ${row.resourceId}`;

  return `
    <div class="tracker-book-row">
      <span class="tracker-book-check">${check}</span>

      <div>
        <div class="tracker-book-title">${title}</div>
        <div class="tracker-book-meta">
          <span class="tracker-pill">${prettyPrepText(row.kind)}</span>
          <span class="tracker-pill tracker-pill-muted">${prettyPrepText(row.mode)}</span>
        </div>
      </div>

      <div class="tracker-status">${prettyPrepText(row.status)}</div>
    </div>
  `;
}

function bookTrackerGroup(title, rows, isReady = false) {
  return `
    <section class="tracker-ledger-group tracker-book-group">
      <div class="tracker-ledger-group-title tracker-book-group-title">${title}</div>
      <div class="tracker-ledger-group-rows tracker-book-group-rows">
        ${
          rows.length
            ? rows.map(row => renderPrepRow(row, isReady)).join("")
            : `<div class="tracker-empty-state">Nothing here yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderBooksPanel() {
  const plannerState = readPlannerState();
  const optionsByResourceId =
    plannerState?.extras?.resources?.optionsByResourceId || {};

  const rows = [];

  Object.entries(optionsByResourceId).forEach(([resourceId, options]) => {
    (Array.isArray(options) ? options : []).forEach(option => {
      rows.push({
        resourceId,
        title: "",
        kind: option?.kind || "physical",
        mode: option?.mode || "purchase",
        status: option?.status || "not_ready",
      });
    });
  });

  const readyRows = rows.filter(row =>
    String(row.status || "").toLowerCase() === "ready"
  );

  const attentionRows = rows.filter(row => {
    const status = String(row.status || "").toLowerCase();
    return status === "not_ready" || !status;
  });

  const receivedRows = rows.filter(row =>
    String(row.status || "").toLowerCase() === "received"
  );

  const orderedRequestedRows = rows.filter(row => {
    const status = String(row.status || "").toLowerCase();
    return status === "ordered" || status === "requested";
  });

  setText("booksReadyCount", readyRows.length);
  setText("booksReceivedCount", receivedRows.length);
  setText("booksOrderedRequestedCount", orderedRequestedRows.length);
  setText("booksAttentionCount", attentionRows.length);

  const booksGroupedContainer = document.getElementById("booksGroupedRows");

  if (booksGroupedContainer) {
    booksGroupedContainer.innerHTML = [
      bookTrackerGroup("Needs Attention", attentionRows, false),
      bookTrackerGroup("Ordered / Requested", orderedRequestedRows, false),
      bookTrackerGroup("Received", receivedRows, false),
      bookTrackerGroup("Ready to Use", readyRows, true),
    ].join("");
  }
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
  const tabs = document.querySelectorAll(".tracker-tab");
  const panels = document.querySelectorAll(".tracker-panel");

  tabs.forEach(button => {
    button.addEventListener("click", () => {
      const target = button.dataset.tab;

      tabs.forEach(tab =>
        tab.classList.remove("is-active")
      );

      panels.forEach(panel =>
        panel.classList.remove("is-active")
      );

      button.classList.add("is-active");

      document
        .querySelector(`[data-panel="${target}"]`)
        ?.classList.add("is-active");
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderTracker();
  renderBooksPanel();
  initTabs();

  window.addEventListener("storage", event => {
    if (event.key === TRACKER_PLANNER_KEY) renderTracker();
  });
});
