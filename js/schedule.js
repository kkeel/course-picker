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
        { slot: "P1", studentId: "S1", pinned: false },
        { slot: "P2", studentId: "S2", pinned: false }
      ],
    
      // Cursor for paging through students
      studentCursor: 0, // points to the "next" student index for unpinned slots
    
      // ---------- helpers ----------
      studentLabel(studentId) {
        const s = this.students.find(x => x.id === studentId);
        return s ? s.name : "Student";
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
    
      // Make sure visible slots are unique and in-range
      normalizeVisibleStudents() {
        const used = new Set();
    
        // Ensure pinned ones are unique first
        for (const p of this.visibleStudentPanels) {
          if (!p.studentId) p.studentId = this.students[0]?.id || "S1";
          if (used.has(p.studentId)) p.studentId = null;
          used.add(p.studentId);
        }
    
        // Fill nulls with first available
        for (const p of this.visibleStudentPanels) {
          if (p.studentId) continue;
          const next = this.students.find(s => !used.has(s.id));
          p.studentId = next ? next.id : this.students[0]?.id || "S1";
          used.add(p.studentId);
        }
      },
    
      // Get next available student id starting at index (wraps)
      nextStudentIdFrom(startIdx, usedSet, direction = 1) {
        const n = this.students.length;
        if (!n) return "S1";
        let idx = startIdx;
    
        for (let tries = 0; tries < n; tries++) {
          const s = this.students[(idx + n) % n];
          if (!usedSet.has(s.id)) return s.id;
          idx += direction;
        }
        // fallback (all used)
        return this.students[(startIdx + n) % n].id;
      },
    
      // Page student panels forward/backward, keeping pinned panels fixed
      pageStudents(direction = 1) {
        // direction: +1 next, -1 prev
        const used = new Set(
          this.visibleStudentPanels.filter(p => p.pinned).map(p => p.studentId)
        );
    
        // Build list of unpinned panels (these will change)
        const unpinned = this.visibleStudentPanels.filter(p => !p.pinned);
    
        // If all pinned, nothing to page
        if (unpinned.length === 0) return;
    
        // Start from cursor, assign each unpinned slot a new student
        // Cursor moves by number of unpinned slots (feels like paging)
        let cursor = this.studentCursor;
    
        for (const panel of unpinned) {
          const id = this.nextStudentIdFrom(cursor, used, direction);
          panel.studentId = id;
          used.add(id);
          cursor += direction;
        }
    
        // Advance cursor by “page size”
        this.studentCursor = (this.studentCursor + direction * unpinned.length) % this.students.length;
    
        this.normalizeVisibleStudents();
      },
    
      init() {
        this.normalizeVisibleStudents();
        this.ensureVisibleDays();
      
        // Initialize Day View student columns
        this.visibleStudentCols = this.buildStudentColsPage(this.studentColsCursor);
        this.ensureVisibleStudentCols();
      }
    };
  };
})();
