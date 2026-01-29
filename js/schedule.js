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
      
      openStudentMenu: null, // which panel slot menu is open (P1/P2)

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
        // Load saved UI state (if any)
        const saved = loadUiState();
      
        if (saved && typeof saved === "object") {
          this.applyUiState(saved);
        } else {
          // First-time defaults
          this.view = "track";
          this.visibleDays = [0, 1, 2, 3, 4];
          this.visibleStudentPanels = [
            { slot: "P1", studentId: "S1" },
            { slot: "P2", studentId: "S2" }, // ✅ default slot 2
          ];
      
          // ✅ day-view scaffold needs this defined (even if you aren't using Day View yet)
          this.visibleStudentCols = ["S1", "S2", "S3", "S4", "S5"];
        }
      
        // Safety normalization (always)
        this.ensureVisibleDays();
        this.ensureUniqueStudents();
      
        // If there was no saved state, write the defaults once
        if (!saved) this.persist();
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

      applyUiState(state) {
        if (!state) return;
      
        if (typeof state.view === "string") this.view = state.view;
      
        if (Array.isArray(state.visibleDays)) {
          this.visibleDays = state.visibleDays;
        }
      
        // ✅ panels (student slots)
        if (Array.isArray(state.panels) && state.panels.length) {
          this.visibleStudentPanels = state.panels.map((p) => {
            const slot = p.slot || "P1";
      
            // Default P1 -> S1, P2 -> S2 (even if studentId missing)
            let studentId = p.studentId;
            if (!studentId) studentId = slot === "P2" ? "S2" : "S1";
      
            return { slot, studentId };
          });
        } else {
          // If panels missing, fall back safely
          this.visibleStudentPanels = [
            { slot: "P1", studentId: "S1" },
            { slot: "P2", studentId: "S2" },
          ];
        }
      
        // ✅ day-view scaffold (prevents Alpine crash from schedule.html)
        if (Array.isArray(state.studentCols) && state.studentCols.length) {
          this.visibleStudentCols = state.studentCols;
        } else if (!Array.isArray(this.visibleStudentCols) || !this.visibleStudentCols.length) {
          this.visibleStudentCols = ["S1", "S2", "S3", "S4", "S5"];
        }
      },
      
      studentLabel(id) {
        const s = this.students.find((x) => x.id === id);
        return s ? s.name : id;
      },

      ensureVisibleDays() {
        const max = (this.dayLabels?.length || 5) - 1;
      
        if (!Array.isArray(this.visibleDays)) this.visibleDays = [];
        // keep only valid ints
        this.visibleDays = this.visibleDays
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= max);
      
        // de-dupe + sort
        this.visibleDays = Array.from(new Set(this.visibleDays)).sort((a, b) => a - b);
      
        // if empty, default to all
        if (this.visibleDays.length === 0) {
          this.visibleDays = Array.from({ length: max + 1 }, (_, i) => i);
        }
      },
      
      ensureUniqueStudents() {
        // Make sure P1/P2 are not the same student
        if (!Array.isArray(this.visibleStudentPanels) || this.visibleStudentPanels.length === 0) return;
      
        const allIds = (this.students || []).map((s) => s.id);
        if (allIds.length === 0) return;
      
        const used = new Set();
      
        this.visibleStudentPanels = this.visibleStudentPanels.map((p, idx) => {
          const slot = p.slot || (idx === 1 ? "P2" : "P1");
          let studentId = p.studentId || (slot === "P2" ? "S2" : "S1");
      
          // if invalid id, fall back
          if (!allIds.includes(studentId)) {
            studentId = slot === "P2" ? (allIds[1] || allIds[0]) : allIds[0];
          }
      
          // if already used, pick the first unused
          if (used.has(studentId)) {
            const next = allIds.find((id) => !used.has(id)) || allIds[0];
            studentId = next;
          }
      
          used.add(studentId);
          return { slot, studentId };
        });
      },
      
      studentName(studentId) {
        const s = (this.students || []).find((x) => x.id === studentId);
        return s ? s.name : "Student";
      },
      
      closeStudentMenu() {
        this.openStudentMenu = null;
      },

      persist() {
        saveUiState({
          view: this.view,
          visibleDays: this.visibleDays,
          panels: this.visibleStudentPanels.map((p) => ({ slot: p.slot, studentId: p.studentId })),
      
          // ✅ keep this so schedule.html never references an undefined key
          studentCols: Array.isArray(this.visibleStudentCols) ? this.visibleStudentCols : [],
        });
      },
      
    };
  };
})();
