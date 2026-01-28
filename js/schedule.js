// js/schedule.js
// Schedule page local state (V1 scaffolding)

(function () {
  // Alpine component for schedule page
  window.scheduleBuilder = function scheduleBuilder() {
    return {
      view: "track", // 'track' (student panels) or 'day' (later)
    
      // V1: students are placeholders (later these become real students)
      students: Array.from({ length: 15 }, (_, i) => {
        const n = i + 1;
        return { id: `S${n}`, name: `Student ${n}` };
      }),
    
      // Day labels (not tied to calendar days)
      // Later you can let users edit these.
      dayLabels: ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"],

      // Global visible columns:
      // - Student View: visibleDays controls Day 1–5 columns inside each student panel
      visibleDays: [0, 1, 2, 3, 4],
      
      // - Day View (next): visibleStudentCols controls which students appear as columns
      visibleStudentCols: ["S1", "S2", "S3", "S4", "S5"],
      studentColsCursor: 0,
    
      // Visible panel slots (2 visible at a time)
      visibleStudentPanels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" }
      ],
    
      // ---------- helpers ----------
      studentLabel(studentId) {
        const s = this.students.find(x => x.id === studentId);
        return s ? s.name : "Student";
      },

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

      // ---------- global day visibility ----------
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
      },
      
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
      },
      
      showAllDays() {
        this.visibleDays = [0, 1, 2, 3, 4];
      },
      
      
      // ---------- global student columns (for Day View later) ----------
      ensureVisibleStudentCols() {
        if (!this.visibleStudentCols || !Array.isArray(this.visibleStudentCols) || this.visibleStudentCols.length === 0) {
          this.visibleStudentCols = this.students.slice(0, 5).map(s => s.id);
        }
      
        // Remove any ids that don't exist
        const valid = new Set(this.students.map(s => s.id));
        this.visibleStudentCols = this.visibleStudentCols.filter(id => valid.has(id));
      
        // Ensure at least 1
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
        // direction: +1 next set of students, -1 previous set
        const n = this.students.length;
        if (!n) return;
      
        // Move cursor by 5 for "page" feel
        this.studentColsCursor = (this.studentColsCursor + direction * 5) % n;
        if (this.studentColsCursor < 0) this.studentColsCursor += n;
      
        this.visibleStudentCols = this.buildStudentColsPage(this.studentColsCursor);
        this.ensureVisibleStudentCols();
      },
      
      toggleStudentCol(id) {
        this.ensureVisibleStudentCols();
        const idx = this.visibleStudentCols.indexOf(id);
      
        // don't allow hiding the last column
        if (idx >= 0) {
          if (this.visibleStudentCols.length === 1) return;
          this.visibleStudentCols.splice(idx, 1);
        } else {
          this.visibleStudentCols.push(id);
        }
      },
    
      init() {
        this.ensureVisibleDays();
        this.ensureUniqueStudents();
      
        this.visibleStudentCols = this.buildStudentColsPage(this.studentColsCursor);
        this.ensureVisibleStudentCols();
      }
    };
  };
})();
