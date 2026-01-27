(function () {
  const root = document.documentElement;
  let ticking = false;

  function updateAagStickyOffsets() {
    const filterWrap = document.querySelector(".filter-state-wrapper");

    // Default: sit under app header if filter wrapper can't be found
    const appHeader = document.querySelector(".app-header");
    let top = (appHeader ? Math.round(appHeader.getBoundingClientRect().bottom) : 0);

    // Preferred: sit under the LIVE bottom edge of the filter wrapper
    // (bar only when closed; bar+panel when open)
    if (filterWrap) {
      const r = filterWrap.getBoundingClientRect();
      top = Math.round(r.bottom);
    }

    root.style.setProperty("--aag-sticky-top", `${top}px`);
  }

  function requestUpdate() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateAagStickyOffsets();
      });
    }
  }

  window.addEventListener("load", requestUpdate);
  window.addEventListener("resize", requestUpdate);
  window.addEventListener("scroll", requestUpdate, { passive: true });
  document.addEventListener("DOMContentLoaded", requestUpdate);

  // Updates when the filter box expands/collapses or content changes size
  const filterWrap = document.querySelector(".filter-state-wrapper");
  if (filterWrap && "ResizeObserver" in window) {
    const ro = new ResizeObserver(requestUpdate);
    ro.observe(filterWrap);
  }
})();
