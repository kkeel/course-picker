// schedule.js
// Schedule page UI state (Student View / "track") + persistence
(function () {
  const STORAGE_KEY = "alveary_schedule_ui_v1";

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function loadUiState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? safeParse(raw) : null;
  }

  function saveUiState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }

  function defaultState() {
    return {
      view: "track",
      visibleDays: [0, 1, 2, 3, 4],
      panels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" }, // ✅ default Student 2
      ],
    };
  }

  function normalizeState(state, allStudentIds) {
    const d = defaultState();

    // view
    const view = typeof state?.view === "string" ? state.view : d.view;

    // visibleDays
    let visibleDays = Array.isArray(state?.visibleDays)
      ? state.visibleDays.slice()
      : d.visibleDays.slice();

    visibleDays = visibleDays
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 4);

    if (!visibleDays.length) visibleDays = d.visibleDays.slice();
    visibleDays = Array.from(new Set(visibleDays)).sort((a, b) => a - b);

    // panels
    let panels = Array.isArray(state?.panels) ? state.panels.slice() : d.panels.slice();

    panels = panels
      .map((p, idx) => {
        const slot = p?.slot || (idx === 1 ? "P2" : "P1");
        let studentId = p?.studentId || (slot === "P2" ? "S2" : "S1");

        // if invalid, fall back to something real
        if (Array.isArray(allStudentIds) && allStudentIds.length) {
          if (!allStudentIds.includes(studentId)) {
            studentId = slot === "P2" ? (allStudentIds[1] || allStudentIds[0]) : allStudentIds[0];
          }
        }

        return { slot, studentId };
      })
      .slice(0, 2);

    // ensure exactly 2 panels
    if (panels.length < 2) panels = d.panels.slice();

    // ensure unique students
    if (panels[0].studentId === panels[1].studentId) {
      const fallback =
        panels[0].studentId === "S1"
          ? "S2"
          : "S1";
      panels[1].studentId = fallback;
    }

    return { view, visibleDays, panels };
  }

  window.scheduleBuilder = function scheduleBuilder() {
    return {
      // -----------------------------
      // state used by schedule.html
      // -----------------------------
      view: "track",
      visibleDays: [0, 1, 2, 3, 4],

      dayLabels: ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"],

      // two visible student panels
      visibleStudentPanels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" },
      ],

      // placeholder students (until you wire real students)
      students: Array.from({ length: 15 }, (_, i) => {
        const n = i + 1;
        return { id: `S${n}`, name: `Student ${n}` };
      }),

      // dropdown menu UI
      openStudentMenu: null,

      // -----------------------------
      // init + persistence
      // -----------------------------
      init() {
        const saved = loadUiState();

        const allIds = (this.students || []).map((s) => s.id);
        const normalized = normalizeState(saved || defaultState(), allIds);

        this.view = normalized.view;
        this.visibleDays = normalized.visibleDays;
        this.visibleStudentPanels = normalized.panels;

        // close any open menu on load (prevents weird "stuck open")
        this.openStudentMenu = null;

        // always persist normalized state back (keeps storage clean)
        this.persist();
      },

      persist() {
        saveUiState({
          view: this.view,
          visibleDays: this.visibleDays,
          panels: this.visibleStudentPanels.map((p) => ({ slot: p.slot, studentId: p.studentId })),
        });
      },

      // -----------------------------
      // header controls
      // -----------------------------
      setView(next) {
        this.view = next;
        this.persist();
      },

      isDayVisible(i) {
        return this.visibleDays.includes(i);
      },

      toggleDay(i) {
        if (this.isDayVisible(i)) {
          this.visibleDays = this.visibleDays.filter((d) => d !== i);
        } else {
          this.visibleDays = [...this.visibleDays, i].sort((a, b) => a - b);
        }

        // never allow empty
        if (!this.visibleDays.length) this.visibleDays = [0, 1, 2, 3, 4];

        this.persist();
      },

      showAllDays() {
        this.visibleDays = [0, 1, 2, 3, 4];
        this.persist();
      },

      // -----------------------------
      // dropdown helpers (used by your HTML)
      // -----------------------------
      toggleStudentMenu(idx) {
        this.openStudentMenu = this.openStudentMenu === idx ? null : idx;
      },

      closeStudentMenu() {
        this.openStudentMenu = null;
      },

      getStudentName(studentId) {
        const s = (this.students || []).find((x) => x.id === studentId);
        return s ? s.name : "Student";
      },

      setPanelStudent(idx, studentId) {
        if (!Array.isArray(this.visibleStudentPanels)) return;
        if (!this.visibleStudentPanels[idx]) return;

        // update target panel
        const next = this.visibleStudentPanels.map((p, i) =>
          i === idx ? { ...p, studentId } : { ...p }
        );

        // enforce uniqueness across the two visible panels
        if (next[0].studentId === next[1].studentId) {
          const allIds = (this.students || []).map((s) => s.id);
          const fallback = allIds.find((id) => id !== next[0].studentId) || "S1";
          next[1].studentId = fallback;
        }

        this.visibleStudentPanels = next;
        this.persist();
      },

      // -----------------------------
      // display helpers
      // -----------------------------
      dayLabel(i) {
        const n = Number(i);
        return this.dayLabels[n] || `Day ${n + 1}`;
      },
    };
  };
})();
