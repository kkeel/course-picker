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

  function getPacketId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id") || "";
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

  function renderLinks() {
    const terms = getVisibleTerms();

    if (!terms.length) {
      setStatus("No links match the selected filters.");
      return;
    }

    clearStatus();

    els.content.innerHTML = terms.map(term => {
      const weeks = getVisibleWeeks(term);

      return `
        <section class="link-term" data-term="${escapeHtml(term.termNumber)}">
          <h2 class="link-term-title">${escapeHtml(term.term || `Term ${term.termNumber}`)}</h2>

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

      els.subject.textContent = state.data.subject || "Lesson Links";
      els.title.textContent = state.data.lessonSetName || state.data.title || "Lesson Links";
      els.subtitle.textContent = [
        state.data.gradeText,
        "Only lessons with links are shown."
      ].filter(Boolean).join(" • ");

      els.controls.hidden = false;

      renderFilters();
      renderLinks();
    } catch (error) {
      console.error(error);
      setStatus("Could not load this link page.", true);
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
