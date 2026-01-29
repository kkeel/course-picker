// schedule.js
// Schedule page local UI state (V1 scaffolding) + persistence
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
      view: "track",                 // "track" (Student panels) or "day" (later)
      visibleDays: [0, 1, 2, 3, 4],   // Day 1-5 indices
      panels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" }, // <-- default Student 2
      ],
    };
  }

  function normalizeState(state) {
    const d = defaultState();

    // view
    const view = typeof state?.view === "string" ? state.view : d.view;

    // visibleDays
    let visibleDays = Array.isArray(state?.visibleDays) ? state.visibleDays.slice() : d.visibleDays.slice();
    visibleDays = visibleDays
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 4);

    // If empty, fall back to all days
    if (!visibleDays.length) visibleDays = d.visibleDays.slice();

    // panels
    let panels = Array.isArray(state?.panels) ? state.panels.slice() : d.panels.slice();
    panels = panels
      .map((p, idx) => {
        const slot = p?.slot || (idx === 1 ? "P2" : "P1");
        let studentId = p?.studentId;

        // if missing, default by slot
        if (!studentId) studentId = slot === "P2" ? "S2" : "S1";

        return { slot, studentId };
      })
      .slice(0, 2);

    // ensure exactly 2 panels
    if (panels.length < 2) {
      panels = d.panels.slice();
    }

    // ensure unique students across the two panels
    if (panels[0].studentId === panels[1].studentId) {
      panels[1].studentId = panels[0].studentId === "S1" ? "S2" : "S1";
    }

    return { view, visibleDays, panels };
  }

  // Alpine component
  window.scheduleBuilder = function scheduleBuilder() {
    return {
      // mode
      view: "track",

      // V1 placeholder students (later replaced with real students)
      students: Array.from({ length: 15 }, (_, i) => {
        const n = i + 1;
        return { id: `S${n}`, name: `Student ${n}` };
      }),

      // Day labels (not tied to calendar days)
      dayLabels: ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"],

      // Global visible day columns
      visibleDays: [0, 1, 2, 3, 4],

      // THE source of truth for the two visible panels
      visibleStudentPanels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" },
      ],

      init() {
        const saved = loadUiState();
        const state = normalizeState(saved || defaultState());

        this.view = state.view;
        this.visibleDays = state.visibleDays;
        this.visibleStudentPanels = state.panels;

        // write back once so incognito / first load always becomes consistent
        this.persist();
      },

      persist() {
        saveUiState({
          view: this.view,
          visibleDays: this.visibleDays,
          panels: this.visibleStudentPanels,
        });
      },

      // ---------- view ----------
      setView(next) {
        this.view = next;
        this.persist();
      },

      // ---------- days ----------
      isDayVisible(i) {
        return this.visibleDays.includes(i);
      },

      toggleDay(i) {
        if (this.isDayVisible(i)) {
          this.visibleDays = this.visibleDays.filter((d) => d !== i);
        } else {
          this.visibleDays = [...this.visibleDays, i].sort((a, b) => a - b);
        }
        if (!this.visibleDays.length) this.visibleDays = [0, 1, 2, 3, 4];
        this.persist();
      },

      showAllDays() {
        this.visibleDays = [0, 1, 2, 3, 4];
        this.persist();
      },

      // ---------- students ----------
      setPanelStudent(idx, studentId) {
        const next = this.visibleStudentPanels.map((p, i) =>
          i === idx ? { ...p, studentId } : { ...p }
        );

        // enforce unique (so comparing works)
        if (next[0].studentId === next[1].studentId) {
          const fallback = next[0].studentId === "S1" ? "S2" : "S1";
          next[1].studentId = fallback;
        }

        this.visibleStudentPanels = next;
        this.persist();
      },

      // ---------- helpers ----------
      dayLabel(i) {
        return this.dayLabels[i] || `Day ${i + 1}`;
      },
    };
  };
})();
