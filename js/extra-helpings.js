(function () {
  const state = {
    data: null,
  };

  const els = {
    title: document.getElementById("extra-title"),
    subtitle: document.getElementById("extra-subtitle"),
    status: document.getElementById("extra-status"),
    content: document.getElementById("extra-content"),
    ideasIntro: document.getElementById("extra-ideas-intro"),
    termList: document.getElementById("extra-term-list"),
    resourceList: document.getElementById("extra-resource-list"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getPageId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id") || "";
  }

  function setStatus(message, isError = false) {
    els.status.hidden = false;
    els.status.textContent = message;
    els.status.classList.toggle("is-error", isError);
    els.content.hidden = true;
  }

  function clearStatus() {
    els.status.hidden = true;
    els.content.hidden = false;
  }

  function renderInlineMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(
      /\\?\[([^\]]+)\]\\?\((https?:\/\/[^)]+)\)/g,
      (_match, label, url) => {
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
      }
    );

    return html;
  }

  function renderIdeaContent(content) {
    const lines = String(content || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) return "";

    return `
      <ul class="extra-idea-list">
        ${lines.map((line) => {
          const checked = line.startsWith("[x]") || line.startsWith("[X]");
          const unchecked = line.startsWith("[ ]");
          const clean = line.replace(/^\[[ xX]\]\s*/, "");

          return `
            <li class="extra-idea-item">
              ${unchecked || checked ? `
               
