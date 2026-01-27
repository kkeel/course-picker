(function () {
  const root = document.documentElement;

  function updateAagStickyOffsets() {
    const appHeader = document.querySelector(".app-header");
    const headerH = appHeader ? Math.round(appHeader.getBoundingClientRect().height) : 0;

    // This wrapper's height automatically changes when filtersOpen toggles
    // because the panel is x-show'd in/out.
    const filterWrap = document.querySelector(".filter-state-wrapper");
    const filterH = filterWrap ? Math.round(filterWrap.getBoundingClientRect().height) : 0;

    // Put the chart header directly under whatever is currently "live"
    // (bar only when closed, bar+panel when open)
    const top = headerH + filterH + 8;

    root.style.setProperty("--aag-sticky-top", `${top}px`);
    root.style.setProperty("--aag-filter-h", `${filterH}px`); // optional, safe
    if (headerH) root.style.setProperty("--app-header-h", `${headerH}px`); // safe fallback
  }

  // Run on load/resize
  window.addEventListener("load", updateAagStickyOffsets);
  window.addEventListener("resize", updateAagStickyOffsets);

  // Observe filter wrapper resizing (dropdowns, open/close, manage students expansion, etc.)
  const filterWrap = document.querySelector(".filter-state-wrapper");
  if (filterWrap && "ResizeObserver" in window) {
    const ro = new ResizeObserver(() => updateAagStickyOffsets());
    ro.observe(filterWrap);
  }

  // Also run once ASAP
  document.addEventListener("DOMContentLoaded", updateAagStickyOffsets);
})();
