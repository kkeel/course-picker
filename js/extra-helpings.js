(function () {
  const state = {
    data: null,
    selectedTerm: "all",
  };

  const els = {
    subject: document.getElementById("extraSubject"),
    title: document.getElementById("extraTitle"),
    subtitle: document.getElementById("extraSubtitle"),
    controls: document.getElementById("extraControls"),
    termFilter: document.getElementById("termFilter"),
    clearFilters: document.getElementById("clearFilters"),
    status: document.getElementById("extraStatus"),
    content: document.getElementById("extraContent"),
    backToTop: document.getElementById("back-to-top"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(value) {
    const raw = String(value || "").trim();

    if (!raw) return "";

    try {
      const url = new URL(raw, window.location.href);
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function getPageId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id") || "";
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

  function selectedTermNumber() {
    if (state.selectedTerm === "all") return null;
    return Number(state.selectedTerm);
  }

  function scopeMatchesSelectedTerm(scope) {
    const term = selectedTermNumber();
    if (!term) return true;

    const text = String(scope || "").toLowerCase();

    return (
      text.includes(`t${term}`) ||
      text.includes(`term ${term}`) ||
      text.includes(`term${term}`)
    );
  }

  function cleanMarkdownSource(value) {
    return String(value || "")
      .replace(/\\\[/g, "[")
      .replace(/\\\]/g, "]")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")");
  }

  function renderInlineMarkdown(value) {
    const raw = cleanMarkdownSource(value);
    const parts = [];
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+(?:\)[^\s)]*)?)\)/g;

    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(raw)) !== null) {
      const before = raw.slice(lastIndex, match.index);
      const label = match[1];
      const url = safeUrl(match[2]);

      if (before) parts.push(escapeHtml(before));

      if (url) {
        parts.push(
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
        );
      } else {
        parts.push(escapeHtml(label));
      }

      lastIndex = match.index + match[0].length;
    }

    const after = raw.slice(lastIndex);
    if (after) parts.push(escapeHtml(after));

    return parts.join("");
  }

  function renderIdeaContent(content) {
    const lines = cleanMarkdownSource(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) return "";

    const items = lines.map((line) => {
      const isUnchecked = line.startsWith("[ ]");
      const isChecked = line.toLowerCase().startsWith("[x]");

      const text = line.replace(/^\[( |x|X)\]\s*/, "");

      return `
        <li class="extra-idea-item">
          <span class="extra-checkbox ${isChecked ? "is-checked" : ""}" aria-hidden="true">
            ${isChecked ? "✓" : ""}
          </span>
          <span>${renderInlineMarkdown(text)}</span>
        </li>
      `;
    });

    return `<ul class="extra-idea-list">${items.join("")}</ul>`;
  }

  function visibleTerms() {
    const terms = state.data?.ideas?.terms || [];
    const selected = selectedTermNumber();

    return terms.filter((term) => {
      if (selected && Number(term.term) !== selected) return false;
      return Array.isArray(term.items) && term.items.length > 0;
    });
  }

  function visibleResources() {
    const resources = Array.isArray(state.data?.resources)
      ? state.data.resources
      : [];

    return resources.filter((resource) => scopeMatchesSelectedTerm(resource.scope));
  }

  function renderIdeas() {
    const terms = visibleTerms();

    if (!terms.length) {
      return `
        <section class="extra-empty-state">
          <h2 class="extra-empty-title">Ideas</h2>
          <p class="extra-empty-message">No term ideas are listed for this selection.</p>
        </section>
      `;
    }

    return `
      <section class="extra-ideas">
        <div class="extra-section-heading">
          <h2>Ideas</h2>
          <p>${escapeHtml(state.data?.ideas?.intro || "")}</p>
        </div>

        ${terms.map((term) => `
          <section class="extra-term" data-term="${escapeHtml(term.term)}">
            <h3 class="extra-term-title">${escapeHtml(term.title || `Term ${term.term}`)}</h3>

            <div class="extra-term-card">
              ${(term.items || []).map((item) => `
                <article class="extra-idea-block">
                  ${renderIdeaContent(item.content)}
                </article>
              `).join("")}
            </div>
          </section>
        `).join("")}
      </section>
    `;
  }

  function renderResourceLinks(resource) {
    const links = Array.isArray(resource.links) ? resource.links : [];

    if (!links.length) return "";

    return `
      <div class="extra-resource-meta-block">
        <div class="extra-resource-meta-label">Options</div>
        <div class="extra-resource-link-row">
          ${links.map((link) => {
            const url = safeUrl(link.url);
            if (!url) return "";

            return `
              <a
                class="extra-resource-link-pill"
                href="${escapeHtml(url)}"
                target="_blank"
                rel="noopener"
              >
                ${escapeHtml(link.text || "Option")}
              </a>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderResourceCard(resource) {
    return `
      <article class="extra-resource-card">
        <div class="extra-resource-cover-wrap">
          <img
            class="extra-resource-cover"
            src="./${escapeHtml(resource.imagePath || "")}"
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

        <div class="extra-resource-body">
          <div class="extra-resource-main-row">
            <div class="extra-resource-main-left">
              <h3 class="extra-resource-title">${escapeHtml(resource.title || "Untitled Resource")}</h3>

              <div class="extra-resource-subline">
                ${resource.author ? `<span>by ${escapeHtml(resource.author)}</span>` : ""}
                ${resource.isbnAsin ? `<span>ISBN/ASIN: ${escapeHtml(resource.isbnAsin)}</span>` : ""}
              </div>

              ${resource.resourceTagText ? `
                <div class="extra-format-list">
                  ${String(resource.resourceTagText)
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                    .map((tag) => `<span class="extra-format-pill">${escapeHtml(tag)}</span>`)
                    .join("")}
                </div>
              ` : ""}

              ${resource.rationale ? `
                <p class="extra-resource-rationale">
                  <span class="extra-resource-rationale-label">➜ RATIONALE:</span>
                  <span>${escapeHtml(resource.rationale)}</span>
                </p>
              ` : ""}
            </div>

            <div class="extra-resource-main-divider" aria-hidden="true"></div>

            <div class="extra-resource-main-right">
              ${resource.scope ? `
                <div class="extra-resource-meta-block">
                  <div class="extra-resource-meta-label">Scope</div>
                  <div class="extra-resource-meta-text">${escapeHtml(resource.scope)}</div>
                </div>
              ` : ""}

              ${renderResourceLinks(resource)}
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderResources() {
    const resources = visibleResources();

    return `
      <section class="extra-resources">
        <div class="extra-section-heading extra-section-heading--resources">
          <h2>Books, Games, & More</h2>
          <p>Optional resources connected to this course or topic.</p>
        </div>

        ${resources.length ? `
          <div class="extra-resource-list">
            ${resources.map(renderResourceCard).join("")}
          </div>
        ` : `
          <div class="extra-empty-state">
            <p class="extra-empty-message">No resources are listed for this selection.</p>
          </div>
        `}
      </section>
    `;
  }

  function render() {
    clearStatus();

    els.content.innerHTML = `
      ${renderIdeas()}
      ${renderResources()}
    `;
  }

  function bindControls() {
    els.termFilter.addEventListener("change", () => {
      state.selectedTerm = els.termFilter.value;
      render();
    });

    els.clearFilters.addEventListener("click", () => {
      state.selectedTerm = "all";
      els.termFilter.value = "all";
      render();
    });
  }

  function bindBackToTop() {
    if (!els.backToTop) return;

    const update = () => {
      els.backToTop.classList.toggle("is-visible", window.scrollY > 500);
    };

    window.addEventListener("scroll", update);

    els.backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    update();
  }

  async function loadExtraHelpings() {
    const id = getPageId();

    if (!id) {
      setStatus("Missing Extra Helpings page ID.", true);
      return;
    }

    try {
      const response = await fetch(`./data/extra-helpings/${encodeURIComponent(id)}.json`, {
        cache: "no-store",
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      state.data = await response.json();

      const title = state.data.title || "Extra Helpings";

      els.subject.textContent = state.data.subject || "Extra Helpings";
      els.title.textContent = title;
      els.subtitle.textContent = [
        state.data.gradeText,
        "Optional enrichment ideas, extra books, games, activities, and resources.",
      ].filter(Boolean).join(" · ");

      document.title = `Extra Helpings – ${title}`;

      els.controls.hidden = false;

      render();
    } catch (error) {
      console.error(error);
      setStatus("Could not load Extra Helpings for this course or topic.", true);
    }
  }

  bindControls();
  bindBackToTop();
  loadExtraHelpings();
})();
