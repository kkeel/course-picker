(function () {
  const state = {
    data: null,
    selectedTerm: "all",
    selectedWeek: "all"
  };

  const els = {
    subject: document.getElementById("linksSubject"),
    title: document.getElementById("linksTitle"),
    subtitle: document.getElementById("linksSubtitle"),
    controls: document.getElementById("linksControls"),
    termFilter: document.getElementById("termFilter"),
    weekFilter: document.getElementById("weekFilter"),
    clearFilters: document.getElementById("clearFilters"),
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

    return weeks.filter(week => {
      if (state.selectedWeek !== "all" && String(week.weekNumber) !== state.selectedWeek) {
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

    function renderQuickAccess() {
      const quickLinks = state.data?.quickLinks || {};
  
      const supplyListUrl = String(quickLinks.supplyListUrl || "").trim();
      const additionalLinks = Array.isArray(quickLinks.additional)
        ? quickLinks.additional
        : [];
  
      const links = [
        {
          label: "Extra Helpings",
          icon: "🍯",
          url: quickLinks.extraHelpingsUrl || "#"
        },
        {
          label: "Book List Details",
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
  
      const primaryHtml = `
        <div class="links-quick-access-grid">
          ${links.map(link => {
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
          }).join("")}
        </div>
      `;
  
      const additionalHtml = additionalLinks.length
        ? `
          <div class="links-additional-quicklinks">
            <h3>Additional Quick Links</h3>
  
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
          <h2 class="links-empty-title">
            ${escapeHtml(
              state.data.lessonSetName ||
              state.data.title ||
              "Lesson Links"
            )}
          </h2>

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
                    <div class="link-lesson-label">${escapeHtml(lessonDisplayLabel(lesson))}</div>
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

  els.clearFilters.addEventListener("click", () => {
    state.selectedTerm = "all";
    state.selectedWeek = "all";
    renderFilters();
    renderLinks();
  });

  window.addEventListener("hashchange", scrollToHashIfNeeded);

  loadLinks();
})();
