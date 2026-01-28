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
    
      // Visible panel slots (2 visible at a time)
      visibleStudentPanels: [
        { slot: "P1", studentId: "S1", pinned: false, visibleDays: [0,1,2,3,4] },
        { slot: "P2", studentId: "S2", pinned: false, visibleDays: [0,1,2,3,4] }
      ],
    
      // Cursor for paging through students
      studentCursor: 0, // points to the "next" student index for unpinned slots
    
      // ---------- helpers ----------
      studentLabel(studentId) {
        const s = this.students.find(x => x.id === studentId);
        return s ? s.name : "Student";
      },

      // ---------- day visibility (per panel) ----------
      dayLabel(i) {
        return this.dayLabels[i] || `Day ${i + 1}`;
      },
      
      ensurePanelDays(panel) {
        if (!panel.visibleDays || !Array.isArray(panel.visibleDays) || panel.visibleDays.length === 0) {
          panel.visibleDays = [0, 1, 2, 3, 4];
        }
        // keep in range + sorted
        panel.visibleDays = panel.visibleDays
          .filter(i => Number.isInteger(i) && i >= 0 && i < this.dayLabels.length)
          .sort((a,b) => a - b);
      },
      
      toggleDay(panel, i) {
        this.ensurePanelDays(panel);
        const idx = panel.visibleDays.indexOf(i);
      
        // don’t allow hiding the last visible day
        if (idx >= 0) {
          if (panel.visibleDays.length === 1) return;
          panel.visibleDays.splice(idx, 1);
        } else {
          panel.visibleDays.push(i);
          panel.visibleDays.sort((a,b) => a - b);
        }
      },
      
      showAllDays(panel) {
        panel.visibleDays = [0, 1, 2, 3, 4];
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
        this.visibleStudentPanels.forEach(p => this.ensurePanelDays(p));
      }
    };
  };
})();
