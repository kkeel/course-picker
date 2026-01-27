  (function () {
    function setAagFilterHeightVar() {
      const w = document.querySelector('.filter-state-wrapper');
      const h = w ? Math.round(w.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--aag-filter-h', h + 'px');
    }
  
    window.addEventListener('load', setAagFilterHeightVar);
    window.addEventListener('resize', setAagFilterHeightVar);
  
    const w = document.querySelector('.filter-state-wrapper');
    if (w && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(setAagFilterHeightVar);
      ro.observe(w);
    }
  
    setAagFilterHeightVar();
  })();

    function updateAagStickyOffsets() {
      const appHeader = document.querySelector(".app-header");
      const headerH = appHeader ? appHeader.getBoundingClientRect().height : 85;
    
      const filterWrap = document.getElementById("aagFilterSticky");
      const filterH = filterWrap ? filterWrap.getBoundingClientRect().height : 0;
    
      // small breathing room so the table header doesn't touch the filter bar
      const top = Math.round(headerH + filterH + 8);
      document.documentElement.style.setProperty("--aag-sticky-top", `${top}px`);
    }

    document.addEventListener("DOMContentLoaded", () => {
      updateAagStickyOffsets();
      window.addEventListener("resize", updateAagStickyOffsets);
    });

(function(){
  const root = document.documentElement;

  function setStickyOffsets(){
    // your app header (top nav) - adjust selectors if yours differs
    const header =
      document.querySelector('.app-header') ||
      document.querySelector('.site-header') ||
      document.querySelector('header');

    // the sticky filter bar row
    const filterBar = document.querySelector('.aag-filters .filter-state-bar');

    const headerH = header ? header.offsetHeight : 0;
    const filterH = filterBar ? filterBar.offsetHeight : 0;

    // app already uses --app-header-h; set it here too as a safe fallback
    if (headerH) root.style.setProperty('--app-header-h', headerH + 'px');

    // chart header should sit UNDER header + filter bar
    root.style.setProperty('--aag-sticky-top', (headerH + filterH) + 'px');
  }

  window.addEventListener('load', setStickyOffsets);
  window.addEventListener('resize', setStickyOffsets);

  // when user toggles filter open/close, recalc after layout settles
  document.addEventListener('click', (e) => {
    if (e.target.closest('.filter-state-bar') || e.target.closest('.filter-toggle') || e.target.closest('[data-action="toggle-filters"]')) {
      setTimeout(setStickyOffsets, 0);
    }
  });
})();
