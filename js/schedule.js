// js/schedule.js
// Schedule page local state (V1 scaffolding) + persistence

(function () {
  const STORAGE_KEY = "alveary_schedule_ui_v1";

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function loadUiState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? safeParse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveUiState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore (private mode, storage full, etc.)
    }
  }

  window.scheduleBuilder = function scheduleBuilder() {
    return {
      view: "track", // 'track' (student panels) or 'day' (later)

      // V1: students are placeholders (later these become real students)
      students: Array.from({ length: 15 }, (_, i) => {
        const n = i + 1;
        return { id: `S${n}`, name: `Student ${n}` };
      }),

      // Day labels (not tied to calendar days)
      dayLabels: ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"],

      // Global visible columns (Student View)
      visibleDays: [0, 1, 2, 3, 4],

      // Day View (later)
      visibleStudentCols: ["S1", "S2", "S3", "S4", "S5"],
      studentColsCursor: 0,

      // Two visible panels (default: Student 1 + Student 2)
      visibleStudentPanels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" }
      ],

      // ---------------------------
      // Persistence
      // ---------------------------
      getUiState() {
        return {
          view: this.view,
          visibleDays: Array.isArray(this.visibleDays) ? this.visibleDays.slice() : [0,1,2,3,4],
          panels: this.visibleStudentPanels.map(p => ({ slot: p.slot, studentId: p.studentId }))
        };
      },

      applyUiState(state) {
        if (!state) return;
      
        if (typeof state.view === "string") this.view = state.view;
      
        if (Array.isArray(state.visibleDays)) {
          this.visibleDays = state.visibleDays;
        }
      
        if (Array.isArray(state.panels) && state.panels.length) {
          this.visibleStudentPanels = state.panels.map((p) => {
            const slot = p.slot || "P1";
      
            // Default P1 -> S1, P2 -> S2 (even if studentId missing)
            let studentId = p.studentId;
            if (!studentId) studentId = slot === "P2" ? "S2" : "S1";
      
            return { slot, studentId };
          });
        }
      },

      persist() {
        saveUiState(this.getUiState());
      },

      watchPersist() {
        // Deep-ish watchers (works reliably for nested object changes)
        this.$watch(() => JSON.stringify(this.visibleStudentPanels), () => this.persist());
        this.$watch(() => JSON.stringify(this.visibleDays), () => this.persist());
      },

      setView(next) {
        this.view = next;
        this.persist();
      },

      // ---------------------------
      // Helpers
      // ---------------------------
      studentLabel(studentId) {
        const s = this.students.find(x => x.id === studentId);
        return s ? s.name : "Student";
      },

      dayLabel(i) {
        return this.dayLabels[i] || `Day ${i + 1}`;
      },

      ensureVisibleDays() {
        if (!this.visibleDays || !Array.isArray(this.visibleDays) || this.visibleDays.length === 0) {
          this.visibleDays = [0, 1, 2, 3, 4];
        }
        this.visibleDays = this.visibleDays
          .filter(i => Number.isInteger(i) && i >= 0 && i < this.dayLabels.length)
          .sort((a, b) => a - b);

        if (this.visibleDays.length === 0) this.visibleDays = [0, 1, 2, 3, 4];
      },

      // Keep the two student panels from selecting the same student
      ensureUniqueStudents() {
        const used = new Set();
        this.visibleStudentPanels.forEach(panel => {
          if (used.has(panel.studentId)) {
            const next = this.students.find(s => !used.has(s.id));
            panel.studentId = next ? next.id : this.students[0].id;
          }
          used.add(panel.studentId);
        });
      },

      onStudentSelectChange(idx) {
        // Enforce uniqueness and persist.
        this.ensureUniqueStudents();
        this.persist();
      },

      // ---------------------------
      // Global day visibility (Student View)
      // ---------------------------
      toggleDay(i) {
        this.ensureVisibleDays();
        const idx = this.visibleDays.indexOf(i);

        // don't allow hiding the last day
        if (idx >= 0) {
          if (this.visibleDays.length === 1) return;
          this.visibleDays.splice(idx, 1);
        } else {
          this.visibleDays.push(i);
          this.visibleDays.sort((a, b) => a - b);
        }

        this.persist();
      },

      showAllDays() {
        this.visibleDays = [0, 1, 2, 3, 4];
        this.persist();
      },

      // ---------------------------
      // Day View columns (later)
      // ---------------------------
      ensureVisibleStudentCols() {
        if (!this.visibleStudentCols || !Array.isArray(this.visibleStudentCols) || this.visibleStudentCols.length === 0) {
          this.visibleStudentCols = this.students.slice(0, 5).map(s => s.id);
        }

        const valid = new Set(this.students.map(s => s.id));
        this.visibleStudentCols = this.visibleStudentCols.filter(id => valid.has(id));

        if (this.visibleStudentCols.length === 0 && this.students.length) {
          this.visibleStudentCols = [this.students[0].id];
        }
      },

      buildStudentColsPage(startIdx) {
        const n = this.students.length;
        if (!n) return [];
        const ids = [];
        for (let k = 0; k < 5; k++) {
          const s = this.students[(startIdx + k) % n];
          ids.push(s.id);
        }
        return ids;
      },

      pageStudentCols(direction = 1) {
        const n = this.students.length;
        if (!n) return;

        this.studentColsCursor = (this.studentColsCursor + direction * 5) % n;
        if (this.studentColsCursor < 0) this.studentColsCursor += n;

        this.visibleStudentCols = this.buildStudentColsPage(this.studentColsCursor);
        this.ensureVisibleStudentCols();
        this.persist();
      },

      toggleStudentCol(id) {
        this.ensureVisibleStudentCols();
        const idx = this.visibleStudentCols.indexOf(id);

        if (idx >= 0) {
          if (this.visibleStudentCols.length === 1) return;
          this.visibleStudentCols.splice(idx, 1);
        } else {
          this.visibleStudentCols.push(id);
        }

        this.persist();
      },

      // ---------------------------
      // Init
      // ---------------------------
      init() {
        // Load saved UI state (if any)
        const saved = loadUiState();
      
        if (saved && typeof saved === "object") {
          // Apply saved view + days + panels
          this.applyUiState(saved);
        } else {
          // First-time defaults
          this.view = "track";
          this.visibleDays = [0, 1, 2, 3, 4];
          this.visibleStudentPanels = [
            { slot: "P1", studentId: "S1" },
            { slot: "P2", studentId: "S2" },
          ];
        }
      
        // Safety normalization (always)
        this.ensureVisibleDays();
        this.ensureUniqueStudents();
      
        // Start watchers AFTER state is settled
        this.watchPersist();
      
        // If there was no saved state, write the defaults once
        if (!saved) this.persist();
      },
    };
  };
})();
