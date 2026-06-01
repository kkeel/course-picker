const TRACKER_APP_CACHE_VERSION = window.APP_CACHE_VERSION || "2025-12-09-v1";
const TRACKER_PLANNER_KEY = window.PLANNER_STATE_KEY || `alveary_planner_${TRACKER_APP_CACHE_VERSION}`;
const TRACKER_RESOURCES_URL = "data/MA_Resources.json";
const TRACKER_ACTIVE_TAB_KEY = `${TRACKER_PLANNER_KEY}_active_tab`;

let trackerResourcesById = {};
let trackerResourcesLastUpdated = "";

function readPlannerState() {
  try {
    const raw = localStorage.getItem(TRACKER_PLANNER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Could not read tracker planner state", error);
    return {};
  }
}

async function loadTrackerResources() {
  try {
    const res = await fetch(TRACKER_RESOURCES_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${TRACKER_RESOURCES_URL}`);

    const json = await res.json();
    trackerResourcesLastUpdated = json?.lastUpdated || "";

    trackerResourcesById = {};

    for (const resource of json?.resources || []) {
      if (resource?.resourceId) {
        trackerResourcesById[String(resource.resourceId)] = resource;
      }
    }
  } catch (error) {
    console.warn("Could not load tracker resources", error);
    trackerResourcesById = {};
  }
}

function trackerCoverPath(resourceId) {
  if (!resourceId) return "img/placeholders/book.svg";

  const v = trackerResourcesLastUpdated
    ? `?v=${encodeURIComponent(trackerResourcesLastUpdated)}`
    : "";

  return `img/resources/${resourceId}.webp${v}`;
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

function prepStatusIcon(status) {
  const s = String(status || "not_ready").toLowerCase();

  const icons = {
    not_ready: "img/status-icons/status-not-ready.svg",
    requested: "img/status-icons/status-requested.svg",
    ordered: "img/status-icons/status-ordered.svg",
    received: "img/status-icons/status-received.svg",
    ready: "img/status-icons/status-ready.svg",
  };

  return icons[s] || icons.not_ready;
}

function prepKindIcon(kind) {
  return String(kind || "").toLowerCase() === "digital" ? "💻" : "📖";
}

function prepModeIcon(mode) {
  const key = String(mode || "purchase").toLowerCase();

  const icons = {
    save: "💾",
    print: "🖨️",
    purchase: "🛒",
    library: "📚",
    ebook: "💻",
    audiobook: "🎧",
    own: "🏠",
  };

  return icons[key] || "🛒";
}

function prepSelect(resourceId, index, field, value, options, extraClass = "") {
  return `
    <select
      class="tracker-prep-select ${extraClass}"
      data-resource-id="${resourceId}"
      data-option-index="${index}"
      data-field="${field}"
    >
      ${options.map(option => `
        <option value="${option.value}" ${String(value) === option.value ? "selected" : ""}>
          ${option.label}
        </option>
      `).join("")}
    </select>
  `;
}

function renderPrepRow(row) {
  const resource = trackerResourcesById[String(row.resourceId)] || {};
  if (!resource.title) {
    console.warn("Tracker resource missing from MA_Resources.json:", row.resourceId);
  }
  
  const title = resource.title || row.title || `Resource ${row.resourceId}`;
  const author = resource.author ? `by ${resource.author}` : "";
  const status = String(row.status || "not_ready").toLowerCase();

  return `
    <div class="tracker-book-row">
      <span class="tracker-status-icon tracker-status-${status}">
        <span
          class="tracker-status-mask"
          aria-hidden="true"
          style="--status-icon-url: url('${prepStatusIcon(status)}');"
        ></span>
      </span>

      <div class="tracker-book-line">
        <div class="tracker-book-title-wrap">
          <img
            src="${trackerCoverPath(row.resourceId)}"
            alt=""
            class="tracker-book-cover"
            onerror="this.onerror=null; this.src='img/placeholders/book.svg';"
          >
          <div>
            <div class="tracker-book-title">${title}</div>
            ${author ? `<div class="tracker-book-author">${author}</div>` : ""}
          </div>
        </div>

        <div class="tracker-book-controls tracker-prep-ledger-note">
          <div class="tracker-prep-note-part tracker-prep-note-mode">
            <span class="tracker-prep-sentence-icon" aria-hidden="true">
              ${prepModeIcon(row.mode)}
            </span>
        
            ${prepSelect(row.resourceId, row.index, "mode", row.mode, [
              { value: "purchase", label: "purchase" },
              { value: "library", label: "library" },
              { value: "ebook", label: "ebook" },
              { value: "audiobook", label: "audiobook" },
              { value: "own", label: "already own" },
              { value: "print", label: "print" },
              { value: "save", label: "save" },
            ], "tracker-prep-select-soft tracker-prep-mode-select")}
          </div>
        
          <span class="tracker-prep-bar">|</span>
        
          ${prepSelect(row.resourceId, row.index, "kind", row.kind, [
            { value: "physical", label: "physical" },
            { value: "digital", label: "digital" },
          ], "tracker-prep-select-soft tracker-prep-kind-select")}
        
          <span class="tracker-prep-bar">|</span>
        
          ${prepSelect(row.resourceId, row.index, "status", row.status, [
            { value: "not_ready", label: "NOT READY" },
            { value: "ordered", label: "ORDERED" },
            { value: "requested", label: "REQUESTED" },
            { value: "received", label: "RECEIVED" },
            { value: "ready", label: "READY" },
          ], `tracker-prep-status-select tracker-prep-status-${status}`)}
        </div>
      </div>
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
    if (!trackerResourcesById[String(resourceId)]?.title) return;
  
    (Array.isArray(options) ? options : []).forEach((option, index) => {
      rows.push({
        resourceId,
        index,
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

function savePrepOptionChange(resourceId, index, field, value) {
  const plannerState = readPlannerState();

  if (!plannerState.extras) plannerState.extras = {};
  if (!plannerState.extras.resources) plannerState.extras.resources = {};
  if (!plannerState.extras.resources.optionsByResourceId) {
    plannerState.extras.resources.optionsByResourceId = {};
  }

  const optionsByResourceId = plannerState.extras.resources.optionsByResourceId;
  const options = optionsByResourceId[resourceId];

  if (!Array.isArray(options) || !options[index]) return;

  options[index] = {
    ...options[index],
    [field]: value,
  };

  localStorage.setItem(TRACKER_PLANNER_KEY, JSON.stringify(plannerState));

  renderTracker();
  renderBooksPanel();
}

function initBookPrepControls() {
  document.addEventListener("change", event => {
    const select = event.target.closest(".tracker-prep-select");
    if (!select) return;

    savePrepOptionChange(
      select.dataset.resourceId,
      Number(select.dataset.optionIndex),
      select.dataset.field,
      select.value
    );
  });
}

function activateTrackerTab(target) {
  const tabs = document.querySelectorAll(".tracker-tab");
  const panels = document.querySelectorAll(".tracker-panel");

  tabs.forEach(tab =>
    tab.classList.toggle("is-active", tab.dataset.tab === target)
  );

  panels.forEach(panel =>
    panel.classList.toggle("is-active", panel.dataset.panel === target)
  );

  localStorage.setItem(TRACKER_ACTIVE_TAB_KEY, target);
}

function initTabs() {
  const tabs = document.querySelectorAll(".tracker-tab");
  const savedTab = localStorage.getItem(TRACKER_ACTIVE_TAB_KEY) || "overview";

  activateTrackerTab(savedTab);

  tabs.forEach(button => {
    button.addEventListener("click", () => {
      activateTrackerTab(button.dataset.tab);
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadTrackerResources();

  renderTracker();
  renderBooksPanel();
  initTabs();
  initBookPrepControls();

  window.addEventListener("storage", event => {
    if (event.key === TRACKER_PLANNER_KEY) {
      renderTracker();
      renderBooksPanel();
    }
  });
});
