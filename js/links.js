(function () {
  const state = {
  data: null,
  selectedTerm: "all",
  selectedWeek: "all",
  selectedTopic: "all",
  quickAccessCollapsed: false
};

  const els = {
    subject: document.getElementById("linksSubject"),
    title: document.getElementById("linksTitle"),
    subtitle: document.getElementById("linksSubtitle"),
    controls: document.getElementById("linksControls"),
    termFilter: document.getElementById("termFilter"),
    weekFilter: document.getElementById("weekFilter"),
    topicFilter: document.getElementById("topicFilter"),
    clearFilters: document.getElementById("clearFilters"),
    quickAccessHeader: document.querySelector(".links-quick-access-header"),
    quickAccess: document.getElementById("linksQuickAccess"),
    quickAccessGrid: document.getElementById("linksQuickAccessGrid"),
    status: document.getElementById("linksStatus"),
    content: document.getElementById("linksContent")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getUrlParams() {
    const params = new URLSearchParams(window.location.search);

    return {
      id: params.get("id") || "",
      term: params.get("term") || "all",
      week: params.get("week") || "all"
    };
  }
  
  function getPacketId() {
    return getUrlParams().id;
  }

  function applyInitialFiltersFromUrl() {
    const params = getUrlParams();
  
    if (params.term && params.term !== "all") {
      state.selectedTerm = params.term;
    }
  
    if (params.week && params.week !== "all") {
      state.selectedWeek = params.week;
    }
  }

  function lessonDisplayLabel(lesson) {
    if (lesson.lessonLabel) return lesson.lessonLabel;
    if (lesson.sequence) return `Lesson ${lesson.sequence}`;
    return "Lesson";
  }

  function setStatus(message, isError = false) {
    els.status.hidden = false;
    els.status.textContent = message;
    els.status.style.color = isError ? "#9f2a2a" : "#596e5e";
    els.content.hidden = true;
  }

  function clearStatus() {
    els.status.hidden = true;
    els.content.hidden = false;
  }

  function getVisibleTerms() {
    if (!state.data?.terms) return [];

    return state.data.terms
      .filter(term => {
        if (state.selectedTerm !== "all" && String(term.termNumber) !== state.selectedTerm) {
          return false;
        }

        const weeks = getVisibleWeeks(term);
        return weeks.length > 0;
      });
  }

  function getVisibleWeeks(term) {
    const weeks = Array.isArray(term.weeks) ? term.weeks : [];
  
    return weeks
      .map(week => {
        const lessons = (week.lessons || []).filter(lesson => {
          if (state.selectedTopic === "all") return true;
  
          return (
            lesson.topicSlug === state.selectedTopic ||
            lesson.topicTitle === state.selectedTopic
          );
        });
  
        return {
          ...week,
          lessons
        };
      })
      .filter(week => {
        if (
          state.selectedWeek !== "all" &&
          String(week.weekNumber) !== state.selectedWeek
        ) {
          return false;
        }
  
        return Array.isArray(week.lessons) && week.lessons.length > 0;
      });
  }

  function renderFilters() {
    const terms = state.data.terms || [];

    els.termFilter.innerHTML = [
      `<option value="all">All terms</option>`,
      ...terms.map(term => {
        return `<option value="${escapeHtml(term.termNumber)}">${escapeHtml(term.term || `Term ${term.termNumber}`)}</option>`;
      })
    ].join("");

    els.termFilter.value = state.selectedTerm;

    renderWeekFilter();
    renderTopicFilter();
  }

  function renderWeekFilter() {
    const weekOptions = [];

    for (const term of state.data.terms || []) {
      if (state.selectedTerm !== "all" && String(term.termNumber) !== state.selectedTerm) continue;

      for (const week of term.weeks || []) {
        weekOptions.push({
          weekNumber: week.weekNumber,
          weekLabel: week.weekLabel || `Week ${week.weekNumber}`,
          termLabel: term.term || `Term ${term.termNumber}`
        });
      }
    }

    els.weekFilter.innerHTML = [
      `<option value="all">All weeks</option>`,
      ...weekOptions.map(week => {
        const label = state.selectedTerm === "all"
          ? `${week.termLabel} – ${week.weekLabel}`
          : week.weekLabel;

        return `<option value="${escapeHtml(week.weekNumber)}">${escapeHtml(label)}</option>`;
      })
    ].join("");

    const hasSelectedWeek = weekOptions.some(week => String(week.weekNumber) === state.selectedWeek);

    if (!hasSelectedWeek) {
      state.selectedWeek = "all";
    }

    els.weekFilter.value = state.selectedWeek;
  }

  function renderTopicFilter() {
    const topicMap = new Map();
  
    for (const term of state.data.terms || []) {
      for (const week of term.weeks || []) {
        for (const lesson of week.lessons || []) {
          const key =
            lesson.topicSlug ||
            lesson.topicTitle;
  
          const label =
            lesson.topicTitle ||
            lesson.linkLabel;
  
          if (key && label && !topicMap.has(key)) {
            topicMap.set(key, label);
          }
        }
      }
    }
  
    const topics = [...topicMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  
    els.topicFilter.innerHTML = [
      `<option value="all">All topics</option>`,
      ...topics.map(topic => `
        <option value="${escapeHtml(topic.value)}">
          ${escapeHtml(topic.label)}
        </option>
      `)
    ].join("");
  
    const hasSelectedTopic = topics.some(
      topic => topic.value === state.selectedTopic
    );
  
    if (!hasSelectedTopic) {
      state.selectedTopic = "all";
    }
  
    els.topicFilter.value = state.selectedTopic;
  
    els.topicFilter.parentElement.hidden = topics.length <= 1;
  }

    function renderQuickAccess() {
      const quickLinks = state.data?.quickLinks || {};
  
      const supplyListUrl = String(quickLinks.supplyListUrl || "").trim();
      const additionalLinks = Array.isArray(quickLinks.additional)
        ? quickLinks.additional
        : [];
  
      const links = [
        {
          label: quickLinks.extraHelpingsUrl
            ? "Extra Helpings"
            : "No Extra Helpings",
          icon: "🍯",
          url: quickLinks.extraHelpingsUrl || "#"
        },
        {
          label: quickLinks.bookListUrl
            ? "Book List Details"
            : "No Books",
          icon: "📚",
          url: quickLinks.bookListUrl || "#"
        },
        {
          label: supplyListUrl ? "Supply List Details" : "No Supplies",
          icon: "✂️",
          url: supplyListUrl || "#"
        },
        {
          label: "Basic Supply List",
          icon: "✏️",
          url:
            quickLinks.basicSuppliesUrl ||
            "https://planning.alveary.org/supply-details.html?view=course&id=rec02PG0uJRjfJewY"
        },
        {
          label: "Lesson PDF",
          icon: "📝",
          url: quickLinks.lessonPdfUrl || "#"
        }
      ];
  
      els.quickAccess.hidden = false;
      els.quickAccess.classList.toggle("is-collapsed", state.quickAccessCollapsed);
      
      els.quickAccessHeader.innerHTML = `
        <h2>Quick Links</h2>
        <button class="links-quick-access-toggle" type="button">
          ${state.quickAccessCollapsed ? "Show" : "Hide"}
        </button>
      `;
      
      els.quickAccessHeader
        .querySelector(".links-quick-access-toggle")
        .addEventListener("click", () => {
          state.quickAccessCollapsed = !state.quickAccessCollapsed;
          renderQuickAccess();
        });
  
      const primaryHtml = links.map(link => {
        const isDisabled = !link.url || link.url === "#";

        return `
          <a
            class="links-quick-access-card ${isDisabled ? "is-disabled" : ""}"
            href="${escapeHtml(isDisabled ? "#" : link.url)}"
            target="_blank"
            rel="noopener"
            aria-disabled="${isDisabled ? "true" : "false"}"
          >
            <span class="links-quick-access-icon">${escapeHtml(link.icon)}</span>
            <span class="links-quick-access-label">${escapeHtml(link.label)}</span>
            <span class="links-quick-access-arrow">↗</span>
          </a>
        `;
      }).join("");
  
      const additionalHtml = additionalLinks.length
        ? `
          <div class="links-additional-quicklinks">
            <div class="links-additional-quicklinks-list">
              ${additionalLinks.map(link => `
                <a
                  href="${escapeHtml(link.url)}"
                  target="_blank"
                  rel="noopener"
                >
                  ${escapeHtml(link.label)}
                </a>
              `).join("")}
            </div>
          </div>
        `
        : "";

      els.quickAccessGrid.innerHTML = primaryHtml + additionalHtml;
    }

  function renderLinks() {
    const terms = getVisibleTerms();

    if (!terms.length) {
      clearStatus();

      els.content.hidden = false;

      els.content.innerHTML = `
        <section class="links-empty-state">
          <h2 class="links-empty-title">Lesson Links</h2>

          <p class="links-empty-message">
            There are no lesson links for this lesson plan.
          </p>
        </section>
      `;

      return;
    }

    clearStatus();

    els.content.innerHTML = terms.map(term => {
      const weeks = getVisibleWeeks(term);

      return `
        <section class="link-term" data-term="${escapeHtml(term.termNumber)}">
          <h2 class="link-term-title">${escapeHtml(term.term || `Term ${term.termNumber}`)}</h2>
      
          <div class="link-term-card">
            ${weeks.map(week => `
            <div class="link-week" data-week="${escapeHtml(week.weekNumber)}">
              <div class="link-week-label">${escapeHtml(week.weekLabel || `Week ${week.weekNumber}`)}</div>

              <div class="link-week-lessons">
                ${(week.lessons || []).map(lesson => `
                  <article class="link-lesson" id="${escapeHtml(lesson.anchor)}">
                    <div class="link-lesson-label">
                      <div class="link-lesson-number">
                        ${escapeHtml(lessonDisplayLabel(lesson))}
                      </div>
                    
                      ${
                        lesson.topicTitle
                          ? `
                            <div class="link-lesson-topic">
                              ${escapeHtml(lesson.topicTitle)}
                            </div>
                          `
                          : ""
                      }
                    </div>
                    <div class="link-list">
                      ${(lesson.links || []).map(link => `
                        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">
                          ${escapeHtml(link.text || link.url)}
                        </a>
                      `).join("")}
                    </div>
                  </article>
                `).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
    }).join("");

    requestAnimationFrame(scrollToHashIfNeeded);
  }

  function scrollToHashIfNeeded() {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;

    const target = document.getElementById(hash);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadLinks() {
    const id = getPacketId();

    if (!id) {
      setStatus("Missing link page ID.", true);
      return;
    }

    try {
      const response = await fetch(`./link-pages/${encodeURIComponent(id)}.json`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      state.data = await response.json();

      applyInitialFiltersFromUrl();

      state.quickAccessCollapsed =
        state.selectedTerm !== "all" || state.selectedWeek !== "all";
      
      els.subject.style.display = "none";

      const pageTitle =
        state.data.lessonSetName ||
        state.data.title ||
        "Lesson Links";

      els.title.textContent = pageTitle;

      document.title = `Links – ${pageTitle}`;
      
      els.subtitle.style.display = "none";

      els.controls.hidden = false;

      renderQuickAccess();
      renderFilters();
      renderLinks();
    } catch (error) {
      console.error(error);
      setStatus("There are no lesson links for this page.");
    }
  }

  els.termFilter.addEventListener("change", () => {
    state.selectedTerm = els.termFilter.value;
    state.selectedWeek = "all";
    renderWeekFilter();
    renderLinks();
  });

  els.weekFilter.addEventListener("change", () => {
    state.selectedWeek = els.weekFilter.value;
    renderLinks();
  });

  els.topicFilter.addEventListener("change", () => {
    state.selectedTopic = els.topicFilter.value;
    renderLinks();
  });

  els.clearFilters.addEventListener("click", () => {
    state.selectedTerm = "all";
    state.selectedWeek = "all";
    state.selectedTopic = "all";
    renderFilters();
    renderLinks();
  });

  window.addEventListener("hashchange", scrollToHashIfNeeded);

  loadLinks();
})();
