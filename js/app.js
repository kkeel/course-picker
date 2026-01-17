// Data URL for pre-built course JSON
const MA_COURSES_JSON_URL = "data/MA_Courses.json";

// Bump this version string whenever you change the JSON shape
// or the UI state we store in localStorage.
const APP_CACHE_VERSION = "2025-12-09-v1";

// Keys for localStorage
const COURSES_CACHE_KEY = `alveary_courses_${APP_CACHE_VERSION}`;
const UI_STATE_KEY      = `alveary_ui_${APP_CACHE_VERSION}`;
const PLANNER_STATE_KEY = `alveary_planner_${APP_CACHE_VERSION}`;

function setAppHeaderHeightVar() {
  const header = document.querySelector(".app-header");
  if (!header) return;

  const h = header.offsetHeight || 0;
  document.documentElement.style.setProperty("--app-header-h", `${h}px`);
}

// Set once on load, and keep updated for rotation / resize
window.addEventListener("load", setAppHeaderHeightVar, { passive: true });
window.addEventListener("resize", setAppHeaderHeightVar, { passive: true });
window.addEventListener("orientationchange", setAppHeaderHeightVar, { passive: true });

// ---------------- PRINT FALLBACK: IN-PLACE PRINT WITH EAGER IMAGE PRELOAD ----------------
// Put this near the bottom of app.js (top-level, not inside coursePlanner()).
(function () {
  // Preload all images (especially lazy ones) by probing their srcs.
  async function preloadImagesFromElements(imgEls, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 45000;
    const concurrency = opts.concurrency ?? 8;

    const srcs = imgEls
      .map(img => img.currentSrc || img.src)
      .filter(Boolean);

    if (!srcs.length) return;

    let idx = 0;
    let active = 0;
    let done = 0;

    await new Promise(resolve => {
      const start = Date.now();

      function pump() {
        if (done >= srcs.length) return resolve();
        if (Date.now() - start > timeoutMs) return resolve();

        while (active < concurrency && idx < srcs.length) {
          const src = srcs[idx++];
          active++;

          const probe = new Image();
          probe.onload = probe.onerror = () => {
            active--;
            done++;
            pump();
          };
          probe.src = src;
        }
      }

      pump();
    });
  }

  // Public hook used by your existing fallback logic in app.js
  window.alvearyPrintInPlaceWithEagerImages = async function () {
    // Grab book covers (tight selector so we don’t waste time on icons)
    const covers = Array.from(document.querySelectorAll("img.resource-img"));

    // Force eager-ish behavior
    covers.forEach(img => {
      try { img.loading = "eager"; } catch (e) {}
      img.setAttribute("loading", "eager");

      img.decoding = "sync";
      img.setAttribute("decoding", "sync");

      // Chromium hint
      try { img.fetchPriority = "high"; } catch (e) {}
      img.setAttribute("fetchpriority", "high");
    });

    // IMPORTANT: even if the browser keeps them "lazy", probing srcs forces fetch.
    await preloadImagesFromElements(covers, { timeoutMs: 120000, concurrency: 8 });

    // Let the browser paint decoded images before print snapshot
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Now print in-place (this is the path that keeps your existing page numbers/footers working)
    window.print();
  };

  // Safety net: if user hits Ctrl/Cmd+P, still try to preload covers first.
  // NOTE: beforeprint can't be truly async in all browsers, but the probe fetch helps anyway.
  window.addEventListener("beforeprint", () => {
    try {
      const covers = Array.from(document.querySelectorAll("img.resource-img"));
      covers.forEach(img => {
        try { img.loading = "eager"; } catch (e) {}
        img.setAttribute("loading", "eager");
      });
      // fire-and-forget prefetch (best effort)
      preloadImagesFromElements(covers, { timeoutMs: 30000, concurrency: 8 });
    } catch (e) {}
  });
})();

function coursePlanner() {
  return {

    authRole: "public",
    isAuthed: false,
    isMember: false,
    isStaff: false,

      // existing state
      step: 3,
      openStep(n) {
        this.step = n;
        window.scrollTo({ top: 0, behavior: "smooth" });
      },

      // Global planning-tag menu (modal-style)
      planningMenuOpen: false,
      planningMenuItem: null,   // the course OR topic currently being edited
      planningMenuX: 0,
      planningMenuY: 0,

      openPlanningMenu(evt, item) {
        const rect = evt.currentTarget.getBoundingClientRect();
        const menuWidth = 260; // keep in sync with CSS / markup

        // Position horizontally so the menu's right edge lines up with the button,
        // but keep it inside the viewport with a small margin.
        let x = rect.right - menuWidth;
        const margin = 16;
        if (x < margin) x = margin;
        if (x + menuWidth > window.innerWidth - margin) {
          x = window.innerWidth - margin - menuWidth;
        }

        // Position below the button, but don't let it run off the bottom of the screen.
        let y = rect.bottom + 8;
        const maxY = window.innerHeight - margin - 260; // approx max menu height
        if (y > maxY) y = maxY;

        this.planningMenuX = x;
        this.planningMenuY = y;
        this.planningMenuItem = item;
        this.planningMenuOpen = true;
      },

      closePlanningMenu() {
        this.planningMenuOpen = false;
        this.planningMenuItem = null;
      },

      // Global student-assign menu (modal-style)
      studentAssignMenuOpen: false,
      studentAssignMenuItem: null, // the course OR topic currently being edited
      studentAssignMenuX: 0,
      studentAssignMenuY: 0,

      openStudentAssignMenu(evt, item) {
        const rect = evt.currentTarget.getBoundingClientRect();
        const menuWidth = 260; // keep consistent with planning menu width + CSS

        // Left-align to the button (since your + button is on the left)
        let x = rect.left;
        const margin = 16;
        if (x < margin) x = margin;
        if (x + menuWidth > window.innerWidth - margin) {
          x = window.innerWidth - margin - menuWidth;
        }

        // Prefer below the button, but clamp to viewport
        let y = rect.bottom + 8;
        const maxY = window.innerHeight - margin - 260; // approx max menu height
        if (y > maxY) y = maxY;
        if (y < margin) y = margin;

        this.studentAssignMenuX = x;
        this.studentAssignMenuY = y;
        this.studentAssignMenuItem = item;
        this.studentAssignMenuOpen = true;
      },

      closeStudentAssignMenu() {
        this.studentAssignMenuOpen = false;
        this.studentAssignMenuItem = null;
      },

      // ✅ Reactive tick to force Alpine to re-evaluate assigned-student counts
      // when deep nested arrays change (e.g., `item.studentIds`).
      studentCountTick: 0,

    // ✅ NEW SOURCE OF TRUTH (to match Planning Tags):
    // Store assigned students directly on the clicked item object as `item.studentIds`.
    // TODO(cleanup): Once verified, remove legacy plannerState-based student helpers
    // (_getAssignedStudentIds / _setAssignedStudentIds) and globalTopicStudents union logic.
    
    isStudentAssigned(item, studentId) {
      if (!item || !studentId) return false;
      const ids = Array.isArray(item.studentIds) ? item.studentIds : [];
      return ids.map(String).includes(String(studentId));
    },
    
    toggleStudentAssignment(item, student) {
      if (!item) return;
    
      if (!item.studentIds) item.studentIds = [];
    
      const next = item.studentIds.map(String);
    
      const sid = String(student.id);
      const idx = next.indexOf(sid);
    
      if (idx >= 0) {
        next.splice(idx, 1);
      } else {
        next.push(sid);
      }
    
      item.studentIds = this._normalizeStudentIds(next);
    
      // ✅ NEW — keep global ghost memory in sync (planning-tag equivalent)
      const topicId = item && item.Topic_ID ? String(item.Topic_ID).trim() : "";
      if (topicId) this.recomputeGlobalTopicStudents(topicId);
    
      this.persistPlannerStateDebounced();
      // force any badge/count UI to update immediately
      this.studentCountTick++;
    },

    getStudentById(id) {
      const sid = String(id);
      return (this.students || []).find(s => String(s.id) === sid) || null;
    },

    // Keep student id arrays consistent across the app (and prevent duplicate-count bugs)
    _normalizeStudentIds(ids) {
      const arr = Array.isArray(ids) ? ids : [];
      const seen = new Set();
      const out = [];
      for (const raw of arr) {
        const v = String(raw).trim();
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
      return out;
    },
    
    // Count ACTIVE assigned students on an item (ignores ghosts; de-duped; ignores unknown ids)
    assignedStudentCount(item) {
      if (!item) return 0;

      // Touch the reactive tick so Alpine knows this depends on assignment changes.
      // (We increment `studentCountTick` whenever students are added/removed.)
      const _tick = this.studentCountTick;

      const ids = this._normalizeStudentIds(item.studentIds);
      let n = 0;
      for (const id of ids) {
        if (this.getStudentById(id)) n++;
      }
      return n;
    },

    removeStudentAssignment(item, studentId) {
      if (!item) return;
    
      const sid = String(studentId);
    
      // 1) remove locally (this card instance only)
      const cur = Array.isArray(item.studentIds) ? item.studentIds.map(String) : [];
      item.studentIds = this._normalizeStudentIds(cur.filter(id => id !== sid));
    
      // 2) if this is a TOPIC instance, keep global ghost memory in sync
      const topicId = item && item.Topic_ID ? String(item.Topic_ID).trim() : "";
      if (topicId) this.recomputeGlobalTopicStudents(topicId);
    
      // 3) persist
      this.persistPlannerStateDebounced();
      // force any badge/count UI to update immediately
      this.studentCountTick++;
    },

      //OLD CODE BELOW

      _isCourseItem(item) {
        // Courses in this app consistently have a Sort_ID (like "003.002.003") and/or a subject.
        return !!(item && (item.Sort_ID || item.subject || item.grade));
      },

      _courseKey(course) {
        return (course && (course.Sort_ID || course.id || course.courseId)) || null;
      },

      _topicInstanceKey(topic) {
        // Topic cards may repeat; we use the topic record/id for the instance key.
        return (topic && (topic.recordID || topic.id || topic.Topic_ID || topic.Sort_ID)) || null;
      },

      _topicGlobalKey(topic) {
        // Shared topic identity for "ghost" students across repeated topic cards.
        return (topic && (topic.Topic_ID || topic.id || topic.recordID)) || null;
      },

      _ensurePlannerCourseState(course) {
        const key = this._courseKey(course);
        if (!key) return null;

        if (!this.plannerState) this.plannerState = {};
        if (!this.plannerState.courses) this.plannerState.courses = {};
        if (!this.plannerState.courses[key]) this.plannerState.courses[key] = {};

        const st = this.plannerState.courses[key];
        if (!Array.isArray(st.students)) st.students = [];
        return st;
      },

      _ensurePlannerTopicState(topic) {
        const key = this._topicInstanceKey(topic);
        if (!key) return null;
      
        if (!this.plannerState) this.plannerState = {};
        if (!this.plannerState.topics) this.plannerState.topics = {};
        if (!this.plannerState.topics[key]) this.plannerState.topics[key] = {};
      
        const st = this.plannerState.topics[key];
        if (!Array.isArray(st.students)) st.students = [];
      
        // ✅ Track the shared Topic identity so we can build "ghost" students later
        const gk = this._topicGlobalKey(topic);
        if (gk) st.globalKey = gk;
      
        return st;
      },

      // TODO(cleanup): LEGACY student assignment storage (plannerState-based).
      // We are transitioning to `item.studentIds` as the single source of truth,
      // matching how Planning Tags store on `item.planningTags`.
      // Once student chips + persistence are verified, delete:
      // - _getAssignedStudentIds
      // - _setAssignedStudentIds
      // - _ensurePlannerCourseState / _ensurePlannerTopicState (if only used for students)
      // - plannerState.globalTopicStudents union logic (unless we re-add as "ghost suggestions")
      _getAssignedStudentIds(item) {
        if (this._isCourseItem(item)) {
          const st = this._ensurePlannerCourseState(item);
          return st ? st.students : [];
        } else {
          const st = this._ensurePlannerTopicState(item);
          return st ? st.students : [];
        }
      },

      _setAssignedStudentIds(item, studentIds) {
        const safe = Array.isArray(studentIds) ? studentIds : [];

        if (this._isCourseItem(item)) {
          const st = this._ensurePlannerCourseState(item);
          if (!st) return;
          st.students = safe;

          // Optional: keep a mirrored array on the item for immediate UI use if needed later
          item.students = safe;
        } else {
          const st = this._ensurePlannerTopicState(item);
          if (!st) return;
          st.students = safe;

          // Optional mirror
          item.students = safe;

          // Update globalTopicStudents for "ghost student" rendering (union across all instances)
          const gk = this._topicGlobalKey(item);
          if (gk) {
            if (!this.plannerState.globalTopicStudents) this.plannerState.globalTopicStudents = {};
          
            // Recompute union of students across ALL topic instances that share this Topic_ID
            const union = new Set();
            const topicsState = this.plannerState.topics || {};
            for (const k of Object.keys(topicsState)) {
              const t = topicsState[k];
              if (!t) continue;
              if (t.globalKey !== gk) continue;
              if (!Array.isArray(t.students)) continue;
              for (const sid of t.students) union.add(String(sid));
            }
          
            this.plannerState.globalTopicStudents[gk] = Array.from(union);
          
            // (Optional mirror for older code paths)
            this.globalTopicStudents = this.plannerState.globalTopicStudents;
          }
        }
      },

      studentChipsForItem(item) {
        if (!item) return [];
      
        const all = Array.isArray(this.students) ? this.students : [];
        const byId = new Map(all.map(s => [s.id, s]));
      
        // ✅ Use new source of truth (matches Planning Tags approach)
        const fullIds = (Array.isArray(item.studentIds) ? item.studentIds : []).map(String);
        const fullSet = new Set(fullIds);
      
        // Courses: only show fully assigned
        if (this._isCourseItem(item)) {
          return fullIds
            .map(id => byId.get(id))
            .filter(Boolean)
            .map(s => ({ ...s, ghost: false }));
        }
      
        // Topics: show fully assigned + ghosts from other instances of same Topic_ID
        const gk = this._topicGlobalKey(item);
        const globalIds = gk && this.globalTopicStudents
          ? (this.globalTopicStudents[gk] || []).map(String)
          : [];
      
        const ghosts = globalIds.filter(id => !fullSet.has(id));
      
        const full = fullIds
          .map(id => byId.get(id))
          .filter(Boolean)
          .map(s => ({ ...s, ghost: false }));
      
        const ghostObjs = ghosts
          .map(id => byId.get(id))
          .filter(Boolean)
          .map(s => ({ ...s, ghost: true }));
      
        return [...full, ...ghostObjs];
      },

      // new global detail toggle
      courseListViewMode: "full",
      _hasSetCourseListViewMode: false,
      showAllDetails: true,
      myCoursesOnly: false,
      myNotesOpen: false,
      editMode: false, // staff-only
      studentDropdownOpen: false,

      // debounce handle for saving UI state
      uiPersistDebounce: null,
    
      // debounce handle for saving planner state
      plannerPersistDebounce: null,

      // --- FILTER PANEL ---
      filtersOpen: true,

      // --- STUDENTS (local, user-defined) ---
      studentsOpen: false,
      colorPickerFor: null,
      newStudentName: "",
      students: [],             
      selectedStudents: [],

      // Student rail open/close per item (default collapsed)
      // Keys like "course:<id>" and "topic:<id>"
      studentRailCollapsed: {},

      // color palette follows SUBJECT order (unique colors only)
      studentColorPalette: [],
      studentColorCursor: 0,

      get canAddStudent() {
        return (
          (this.newStudentName || "").trim().length > 0 &&
          (this.students || []).length < 15
        );
      },

      get courseListViewModeClass() {
        const m = (this.courseListViewMode || "full");
        return `listview-${m}`;
      },

      toggleStudentsOpen() {
        this.studentsOpen = !this.studentsOpen;
        // keep UI stable; no need to persist open/close state
      },

      buildStudentColorPalette() {
        const uniq = [];
        const seen = new Set();

        (this.subjectOptions || []).forEach(subj => {
          const c = this.subjectColor(subj);
          if (!c) return;
          const key = String(c).toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          uniq.push(c);
        });

        return uniq;
      },

      nextDefaultStudentColor() {
        const pal = this.studentColorPalette || [];
        if (!pal.length) return "#dde2d5";
        const idx = (this.studentColorCursor || 0) % pal.length;
        this.studentColorCursor = (this.studentColorCursor || 0) + 1;
        return pal[idx];
      },

      addStudent() {
        const name = (this.newStudentName || "").trim();
        if (!name) return;
        if ((this.students || []).length >= 15) return;

        const id = `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const color = this.nextDefaultStudentColor();

        this.students = [
          ...(this.students || []),
          { id, name, color }
        ];

        this.newStudentName = "";
        this.colorPickerFor = null;

        this.persistPlannerStateDebounced();
      },

      removeStudent(id) {
        if (!id) return;
      
        const sid = String(id);
      
        // 1) Remove from roster
        this.students = (this.students || []).filter(s => String(s.id) !== sid);
      
        // 2) Remove from student filter selection
        this.selectedStudents = (this.selectedStudents || []).filter(x => String(x) !== sid);
      
        // 3) Remove from ALL assignments (courses + topics)
        //    This prevents “orphan” studentIds from lingering on cards.
        (this.courses || []).forEach(c => {
          if (!Array.isArray(c.studentIds)) return;
          c.studentIds = c.studentIds.map(String).filter(x => x !== sid);
        });
      
        Object.values(this.topicsByCourse || {}).forEach(list => {
          (list || []).forEach(t => {
            if (!Array.isArray(t.studentIds)) return;
            t.studentIds = t.studentIds.map(String).filter(x => x !== sid);
          });
        });
      
        // 4) Close color picker if it was open for this student
        if (this.colorPickerFor === id) {
          this.colorPickerFor = null;
        }
      
        // 5) Persist + refresh UI
        this.persistPlannerStateDebounced();
        this.applyFilters();
        // force any badge/count UI to update immediately
        this.studentCountTick++;
      },

      updateStudentName(id, name) {
        this.students = (this.students || []).map(s =>
          s.id === id ? { ...s, name } : s
        );
        this.persistPlannerStateDebounced();
      },

      toggleStudentColorPicker(id) {
        this.colorPickerFor = (this.colorPickerFor === id) ? null : id;
      },

      setStudentColor(id, color) {
        if (!id || !color) return;
        this.students = (this.students || []).map(s =>
          s.id === id ? { ...s, color } : s
        );
      
        // ✅ auto-close swatches after pick
        this.colorPickerFor = null;
      
        this.persistPlannerStateDebounced();
      },

      // --- PRINT TIP MODAL ---
     printTipOpen: false,
     printTipDontShowAgain: false,

      // --- FILTER STATE (grade) ---
      selectedGrades: [],          // e.g. ["G1", "G3"]
      gradeDropdownOpen: false,
      gradeOptions: [
        { code: "G1",  label: "Grade 1"  },
        { code: "G2",  label: "Grade 2"  },
        { code: "G3",  label: "Grade 3"  },
        { code: "G4",  label: "Grade 4"  },
        { code: "G5",  label: "Grade 5"  },
        { code: "G6",  label: "Grade 6"  },
        { code: "G7",  label: "Grade 7"  },
        { code: "G8",  label: "Grade 8"  },
        { code: "G9",  label: "Grade 9"  },
        { code: "G10", label: "Grade 10" },
        { code: "G11", label: "Grade 11" },
        { code: "G12", label: "Grade 12" },
      ],

      // --- FILTER STATE (subject) ---
      selectedSubjects: [],       // e.g. ["Science", "Art"]
      subjectDropdownOpen: false,
      // Order matches subject display (Science, then Alt. Science Options directly after)
      subjectOptions: [
        "Architecture",
        "Art",
        "Bible",
        "Citizenship",
        "English",
        "Geography",
        "History",
        "Latin",
        "Life Skills",
        "Literature",
        "Math",
        "Modern Language",
        "Music",
        "Physical Education",
        "Science",
        "Alt. Science Options",
      ],

      // --- FILTER STATE (planning tags) ---
      selectedTags: [],
      tagDropdownOpen: false,

      // --- FILTER STATE (search) ---
      searchQuery: "",

      // --- PLANNING TAG OPTIONS ---
      // Adjust image filenames/paths as needed so they match your repo
      planningTagOptions: [
        {
          id: "core",
          label: "Core",
          img: "img/Core%20Subjects.png",
        },
        {
          id: "family",
          label: "Family",
          img: "img/Family%20Subjects.png",
        },
        {
          id: "combine",
          label: "Combine",
          img: "img/Combine%20Subjects.png",
        },
        {
          id: "high-interest",
          label: "High interest",
          img: "img/High%20Interest%20Subjects.png",
        },
        {
          id: "additional",
          label: "Additional",
          img: "img/Additional%20Subjects.png",
        },
      ],

      // Global "memory" of which Topic_IDs have ever been tagged
      // Example shape: { "CHURCH_HISTORY_1_3": ["core", "family"] }
      globalTopicTags: {},

      // Global notes for topics (shared across all instances of the same Topic_ID)
      // Example shape: { "CHURCH_HISTORY_1_3": "My running note text..." }
      globalTopicNotes: {},

      toggleFiltersOpen() {
        this.filtersOpen = !this.filtersOpen;
        this.persistUiStateDebounced();
      },

      setCourseListViewMode(mode) {
        const allowed = new Set(["full", "compact", "minimal"]);
        const next = allowed.has(mode) ? mode : "full";
      
        this.courseListViewMode = next;
        this.showAllDetails = (next === "full");
      
        this._hasSetCourseListViewMode = true;
        this.persistUiStateDebounced();
      },
      
      // Back-compat if anything still calls it
      toggleAllDetails() {
        this.setCourseListViewMode(this.courseListViewMode === "full" ? "compact" : "full");
      },

      toggleMyCoursesOnly() {
        this.myCoursesOnly = !this.myCoursesOnly;
        this.persistUiStateDebounced();
      },

      // Open/close all notes for items that are bookmarked AND have notes
      toggleMyNotes() {
        this.myNotesOpen = !this.myNotesOpen;
        const shouldOpen = this.myNotesOpen;
      
        const groups = this.coursesBySubject || {};
      
        Object.values(groups).forEach(courses => {
          (courses || []).forEach(course => {
            const hasTopics = Array.isArray(course.topics) && course.topics.length > 0;
      
            // Course-level notes (only for topic-less courses)
            if (!hasTopics) {
              const openCourseNote =
                shouldOpen &&
                this.isCourseBookmarked &&
                this.hasCourseNote &&
                this.isCourseBookmarked(course) &&
                this.hasCourseNote(course);
      
              course.noteOpen = !!openCourseNote;
            }
      
            // Topic-level notes
            if (hasTopics && this.hasTopicNote && this.isTopicBookmarked) {
              course.topics.forEach(topic => {
                const openTopicNote =
                  shouldOpen &&
                  this.isTopicBookmarked(topic) &&
                  this.hasTopicNote(topic);
      
                topic.noteOpen = !!openTopicNote;
              });
            }
          });
        });

        this.persistUiStateDebounced();
      },

      toggleEditMode() {
        if (!this.isStaff) {
          this.editMode = false;
          return;
        }
        this.editMode = !this.editMode;
        this.persistUiStateDebounced?.();
      },
      
      // Subject → courses map used by the template.
      // When myCoursesOnly is off, just return the normal filtered view.
      // When it's on, keep only courses with bookmarks.
      visibleCourseGroups() {
        // No special filtering when toggle is off
        if (!this.myCoursesOnly) return this.coursesBySubject;
      
        const result = {};
        const entries = Object.entries(this.coursesBySubject || {});
      
        entries.forEach(([subject, courses]) => {
          const filteredCourses = (courses || []).filter(course => {
            const hasTopics = Array.isArray(course.topics) && course.topics.length > 0;
      
            // Any bookmarked topic *in this course*?
            const anyTopicBookmarked =
              hasTopics && course.topics.some(t => this.isTopicBookmarked(t));
      
            // Course-level bookmark for topic-less courses
            const courseBookmarked =
              !hasTopics && this.isCourseBookmarked(course);
      
            // Visible if there is either a course bookmark or
            // at least one topic bookmark in THIS course
            return anyTopicBookmarked || courseBookmarked;
          });
      
          if (filteredCourses.length > 0) {
            result[subject] = filteredCourses;
          }
        });
      
        return result;
      },
      
      visibleTopicsForCourse(course) {
        let topics = Array.isArray(course.topics) ? course.topics : [];
      
        // Student filter: only show the topics that match the selected student(s)
        if (this.selectedStudents?.length) {
          topics = topics.filter(t => this.studentMatchesTopic(t));
        }
      
        // My Courses toggle: only show bookmarked topics (applies after student filtering too)
        if (this.myCoursesOnly) {
          topics = topics.filter(t => this.isTopicBookmarked(t));
        }
      
        return topics;
      },

      // label helper for chips
      gradeLabelFromCode(code) {
        const found = this.gradeOptions.find(o => o.code === code);
        return found ? found.label : code;
      },

      // Label for print header under "Alveary"
      gradePrintLabel() {
        // Default when no grade filters are applied
        if (!this.selectedGrades || this.selectedGrades.length === 0) {
          return "Master";
        }
      
        // Map selected grade codes to labels like "Grade 1", "Grade 3"
        const labels = this.selectedGrades
          .map(code => this.gradeLabelFromCode(code))
          .filter(Boolean);
      
        if (labels.length === 0) return "Master";
      
        // Remove duplicates
        const unique = [...new Set(labels)];
      
        // Single grade: just return "Grade 1", "Kindergarten", etc.
        if (unique.length === 1) {
          return unique[0];
        }
      
        // Multiple grades: "Grades 3, 4" style
        const stripped = unique.map(label =>
          label.replace(/^Grade[s]?\s*/i, "").trim()
        );
      
        return `Grades ${stripped.join(", ")}`;
      },

      // toggle a grade in/out of the selection
      toggleGrade(code) {
        const idx = this.selectedGrades.indexOf(code);
        if (idx === -1) {
          this.selectedGrades.push(code);
        } else {
          this.selectedGrades.splice(idx, 1);
        }
        this.applyFilters();
      },

      // remove a single grade (chip ×)
      removeGrade(code) {
        this.selectedGrades = this.selectedGrades.filter(c => c !== code);
        this.applyFilters();
      },

      // --- SUBJECT FILTER HELPERS ---
      toggleSubject(name) {
        const idx = this.selectedSubjects.indexOf(name);
        if (idx === -1) {
          this.selectedSubjects.push(name);
        } else {
          this.selectedSubjects.splice(idx, 1);
        }
        this.applyFilters();
      },

      removeSubject(name) {
        this.selectedSubjects = this.selectedSubjects.filter(s => s !== name);
        this.applyFilters();
      },

      // --- TAG FILTER HELPERS ---

      // label helper for planning-tag chips
      planningTagLabel(id) {
        const found = this.planningTagOptions.find(o => o.id === id);
        return found ? found.label : id;
      },

      // image helper for planning-tag icons
      planningTagImage(id) {
        const found = this.planningTagOptions.find(o => o.id === id);
        return found ? found.img : "";
      },

      // toggle a planning tag in/out of the filter selection
      toggleSelectedTag(id) {
        const idx = this.selectedTags.indexOf(id);
        if (idx === -1) {
          this.selectedTags.push(id);
        } else {
          this.selectedTags.splice(idx, 1);
        }
        this.applyFilters();
      },

      // remove a single tag (chip × in the filter bar)
      removeSelectedTag(id) {
        this.selectedTags = this.selectedTags.filter(t => t !== id);
        this.applyFilters();
      },

      subjectMatches(courseSubject) {
        if (!this.selectedSubjects.length) return true; // no subject filter
        if (!courseSubject) return false;
        const subj = courseSubject.trim();
        return this.selectedSubjects.includes(subj);
      },

      // Does this course match the current tag filter?
      // For now, this checks tags on the course itself AND on any of its topics.
      tagMatchesCourse(course) {
        if (!this.selectedTags.length) return true; // no tag filter => match all

        const tagIds = new Set();

        if (Array.isArray(course.planningTags)) {
          course.planningTags.forEach(t => tagIds.add(t.id));
        }

        if (Array.isArray(course.topics)) {
          course.topics.forEach(topic => {
            if (topic && Array.isArray(topic.planningTags)) {
              topic.planningTags.forEach(t => tagIds.add(t.id));
            }
          });
        }

      // course matches if any selected tag is present
      return this.selectedTags.some(id => tagIds.has(id));
      },

      courseMatchesSearch(course, searchLower) {
        const q = (searchLower || "").trim();
        if (!q) return true;
      
        // 1. Collect all searchable text
        const pieces = [
          course.title,
          course.subject,
          course.description,
          course.tips,
          course.gradeText,
          course.schedText,
          course.metaLine,
        ];
      
        // course-level notes
        const courseNote = this.plan?.[course.id]?.note;
        if (courseNote) pieces.push(courseNote);
      
        if (Array.isArray(course.topics)) {
          course.topics.forEach(topic => {
            if (!topic) return;
      
            pieces.push(
              topic.Topic || topic.title,
              topic.description,
              topic.tips,
              topic.Grade_Text || topic.gradeText,
              topic.Scheduling_R3 || topic.schedText
            );
      
            // topic-level notes (support topic.topic_id or topic.id)
            const topicNote = this.plan?.[topic.topic_id]?.note || this.plan?.[topic.id]?.note;
            if (topicNote) pieces.push(topicNote);
          });
        }
      
        // 2. Normalize to lowercase and split into "words"
        const haystack = pieces
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
      
        const words = haystack.split(/[^a-z0-9]+/); // split on spaces & punctuation
      
        // 3. Match whole word or word prefix (so "natu" still finds "nature")
        return words.some(w => w && (w === q || w.startsWith(q)));
      },

      // For a given topic, which globally-known tags have NOT yet been applied here?
      missingGlobalTagsForTopic(topic) {
        if (!topic) return [];

        const topicId = (topic.Topic_ID || "").trim();
        if (!topicId) return [];

        const global = this.globalTopicTags[topicId] || [];
        if (!global.length) return [];

        const localIds = new Set(
          (topic.planningTags || []).map(t => t.id)
        );

      // Only show tags that are global but not yet applied locally
      return global.filter(id => !localIds.has(id));
      },

      // Apply a previously used ("global") tag to this specific topic instance
      applyGlobalTagToTopic(topic, tagId) {
        if (!topic) return;

        const topicId = (topic.Topic_ID || "").trim();
        const opt = this.planningTagOptions.find(o => o.id === tagId);
        if (!opt) return;

        if (!topic.planningTags) topic.planningTags = [];

        // If it already has this tag locally, do nothing
        if (topic.planningTags.some(t => t.id === tagId)) {
          return;
        }

        // Add to the plan layer for this topic instance
        topic.planningTags.push({
          id: opt.id,
          label: opt.label,
          img: opt.img,
        });

       // Also make sure the global memory knows about it (for safety)
       if (topicId) {
          if (!this.globalTopicTags[topicId]) {
            this.globalTopicTags[topicId] = [];
          }
          if (!this.globalTopicTags[topicId].includes(tagId)) {
            this.globalTopicTags[topicId].push(tagId);
          }
        }

        this.persistPlannerStateDebounced();
      },

      missingGlobalStudentsForItem(item) {
        if (!item) return [];
      
        // Courses do NOT have ghost students (ghosts are topic-repeats only)
        if (this._isCourseItem(item)) return [];
      
        const topicId = item && item.Topic_ID ? String(item.Topic_ID).trim() : "";
        if (!topicId) return [];
      
        // ✅ Match planning-tag logic: read from the LIVE global map
        const global = (this.globalTopicStudents?.[topicId] || []).map(String);
      
        // local assignments for THIS topic instance
        const local = (Array.isArray(item.studentIds) ? item.studentIds : []).map(String);
        const localSet = new Set(local);
      
        // return only ghosts (in global, not local)
        return global.filter(sid => !localSet.has(sid));
      },

      // Apply a previously-assigned ("ghost") student to this specific topic instance.
      // Mirrors applyGlobalTagToTopic() behavior for Planning Tags.
      applyGlobalStudentToItem(item, studentId) {
        if (!item || !studentId) return;
      
        // Courses don't have ghost students; applying is topic-only
        if (this._isCourseItem(item)) return;
      
        const sid = String(studentId);
      
        if (!Array.isArray(item.studentIds)) item.studentIds = [];
      
        // If already locally assigned, do nothing
        const cur = item.studentIds.map(String);
        if (cur.includes(sid)) return;
      
        // Add locally (this instance)
        cur.push(sid);
        item.studentIds = this._normalizeStudentIds(cur);
      
        // Keep global ghost memory in sync
        const topicId = item && item.Topic_ID ? String(item.Topic_ID).trim() : "";
        if (topicId) this.recomputeGlobalTopicStudents(topicId);
      
        this.persistPlannerStateDebounced();
        // force any badge/count UI to update immediately
        this.studentCountTick++;
      },

      // ==== TOPIC NOTES (shared by Topic_ID) =====================

      // Read the shared note text for this topic (all instances share by Topic_ID)
      topicNoteText(topic) {
        if (!topic || !topic.Topic_ID) return "";
        const id = String(topic.Topic_ID).trim();
        if (!id) return "";
        return this.globalTopicNotes[id] || "";
      },

      // Update the shared note text for this topic
      updateTopicNoteText(topic, text) {
        if (!topic || !topic.Topic_ID) return;
        const id = String(topic.Topic_ID).trim();
        if (!id) return;
        this.globalTopicNotes[id] = text;
        this.persistPlannerStateDebounced();
      },

      // Does this topic have any note text?
      hasTopicNote(topic) {
        return this.topicNoteText(topic).trim().length > 0;
      },

      // Open/close the note accordion for a particular topic card
      toggleTopicNoteOpen(topic) {
        if (!topic) return;
        topic.noteOpen = !topic.noteOpen;
      },

      // After removing a plan tag from a topic, make sure the global memory
      // stays accurate. If no topic with this Topic_ID still has this tag,
      // remove it from globalTopicTags.
      cleanupGlobalTopicTag(topicId, tagId) {
        if (!topicId || !tagId) return;

        let stillUsed = false;
        const subjects = Object.keys(this.allCoursesBySubject || {});

        for (const subject of subjects) {
          const courses = this.allCoursesBySubject[subject] || [];
          for (const course of courses) {
            if (!Array.isArray(course.topics)) continue;

            for (const topic of course.topics) {
              if (!topic) continue;
              const tid = (topic.Topic_ID || "").trim();
              if (tid !== topicId) continue;

              if (
                Array.isArray(topic.planningTags) &&
                topic.planningTags.some(t => t.id === tagId)
              ) {
                stillUsed = true;
                break;
              }
            }

            if (stillUsed) break;
          }

          if (stillUsed) break;
        }

        if (!stillUsed && this.globalTopicTags[topicId]) {
          this.globalTopicTags[topicId] =
            this.globalTopicTags[topicId].filter(id => id !== tagId);
          if (this.globalTopicTags[topicId].length === 0) {
            delete this.globalTopicTags[topicId];
          }
        }

        this.persistPlannerStateDebounced();
      },

      // --- STUDENT GHOST MEMORY (shared by Topic_ID) -----------------

      recomputeGlobalTopicStudents(topicId) {
        if (!topicId) return;
      
        const union = new Set();
        const subjects = Object.keys(this.allCoursesBySubject || {});
      
        for (const subject of subjects) {
          const courses = this.allCoursesBySubject[subject] || [];
          for (const course of courses) {
            if (!Array.isArray(course.topics)) continue;
      
            for (const t of course.topics) {
              if (!t) continue;
              const tid = String(t.Topic_ID || "").trim();
              if (tid !== topicId) continue;
      
              const ids = Array.isArray(t.studentIds) ? t.studentIds : [];
              ids.map(String).forEach(sid => union.add(sid));
            }
          }
        }
      
        if (!this.globalTopicStudents) this.globalTopicStudents = {};
      
        const arr = Array.from(union);
        if (arr.length) this.globalTopicStudents[topicId] = arr;
        else delete this.globalTopicStudents[topicId];
      },

      // --- PLANNING TAG HELPERS ---
      togglePlanningTag(item, opt) {
        if (!item || !opt) return;

        if (!item.planningTags) item.planningTags = [];

        const existingIndex = item.planningTags.findIndex(t => t.id === opt.id);

        // Detect if this item is a Topic (has Topic_ID)
        const topicId =
          item && item.Topic_ID ? String(item.Topic_ID).trim() : "";

        if (existingIndex === -1) {
          // ADD tag at the plan layer
          item.planningTags.push({
            id: opt.id,
            label: opt.label,
            img: opt.img,
          });

          // If it's a topic, also remember this tag at the global layer
          if (topicId) {
            if (!this.globalTopicTags[topicId]) {
              this.globalTopicTags[topicId] = [];
            }
            if (!this.globalTopicTags[topicId].includes(opt.id)) {
              this.globalTopicTags[topicId].push(opt.id);
            }
          }
        } else {
          // REMOVE tag at the plan layer
          item.planningTags.splice(existingIndex, 1);

          // If it's a topic, re-check whether this tag is still used anywhere
          if (topicId) {
            this.cleanupGlobalTopicTag(topicId, opt.id);
          }
        }

        // close after click
        this.closePlanningMenu();
        this.persistPlannerStateDebounced();
      },

      removePlanningTag(item, tagId) {
        if (!item || !item.planningTags) return;

        item.planningTags = item.planningTags.filter(t => t.id !== tagId);

        // If this is a topic (has Topic_ID), update globalTopicTags as needed
        const topicId =
          item && item.Topic_ID ? String(item.Topic_ID).trim() : "";
        if (topicId) {
          this.cleanupGlobalTopicTag(topicId, tagId);
        }

        this.persistPlannerStateDebounced();
      },

      // --- STUDENT OPTION HELPERS ---
      studentById(id) {
        const needle = String(id);
        return (this.students || []).find(s => String(s.id) === needle) || null;
      },
      
      studentNameFromId(id) {
        if (String(id) === "__any__") return "All Students";
        const s = this.studentById(id);
        return s ? (s.name || "Unnamed") : "";
      },
      
      studentColorFromId(id) {
        if (String(id) === "__any__") return "#9eaa99";
        const s = this.studentById(id);
        return s?.color || "#596e5e";
      },

      studentRailKeyForCourse(course) {
        const id = course?.recordID || course?.id || "";
        return `course:${String(id)}`;
      },

      studentRailKeyForTopic(topic) {
        const id = topic?.recordID || topic?.id || "";
        return `topic:${String(id)}`;
      },

      isStudentRailCollapsed(itemKey) {
        // Minimal view = all student rails collapsed (closed)
        if ((this.courseListViewMode || "full") === "minimal") return true;
      
        const map = this.studentRailCollapsed || {};
        return (map[itemKey] === true);
      },

      toggleStudentRailCollapsed(itemKey) {
        if (!itemKey) return;
        if (!this.studentRailCollapsed) this.studentRailCollapsed = {};
        const nextCollapsed = !this.isStudentRailCollapsed(itemKey);
        this.studentRailCollapsed[itemKey] = nextCollapsed;

        // persist with planner state (same pattern as bookmarks/tags/notes)
        this.persistPlannerStateDebounced();
      },
      
      toggleStudentFilter(id) {
        if (id === undefined || id === null) return;
        const sid = String(id);
        const ANY = "__any__";
      
        if (!Array.isArray(this.selectedStudents)) this.selectedStudents = [];
        this.selectedStudents = this.selectedStudents.map(String);
      
        // "Any student tag" is mutually exclusive with specific students
        if (sid === ANY) {
          if (this.selectedStudents.includes(ANY)) {
            this.selectedStudents = [];
          } else {
            this.selectedStudents = [ANY];
          }
          this.applyFilters();
          return;
        }
      
        // If ANY is selected and user picks a specific student, remove ANY first
        this.selectedStudents = this.selectedStudents.filter(x => x !== ANY);
      
        const idx = this.selectedStudents.indexOf(sid);
        if (idx === -1) this.selectedStudents.push(sid);
        else this.selectedStudents.splice(idx, 1);
      
        this.applyFilters();
      },
      
      removeStudentFilter(id) {
        const sid = String(id);
        this.selectedStudents = (this.selectedStudents || []).map(String).filter(x => x !== sid);
        this.applyFilters();
      },

      studentMatchesCourse(course) {
        // Match-all when the student filter is not active (same as planning tags)
        if (!this.selectedStudents?.length) return true;
      
        const ANY = "__any__";
        const selected = (this.selectedStudents || []).map(String);
      
        const ids = new Set();
      
        const addIds = (arr) => {
          this._normalizeStudentIds(arr).forEach(id => ids.add(id));
        };
      
        // Course-level studentIds
        addIds(course?.studentIds);
      
        // Topic-level studentIds (any topic in this course)
        if (Array.isArray(course?.topics)) {
          course.topics.forEach(t => addIds(t?.studentIds));
        }
      
        // If "All Students" is selected, match ONLY if at least one REAL student exists here
        if (selected.includes(ANY)) {
          for (const id of ids) {
            if (this.studentById(id)) return true;
          }
          return false;
        }
      
        // If the student filter is active and NOTHING is assigned here, do not match
        if (ids.size === 0) return false;
      
        return selected.some(id => ids.has(id));
      },

      studentMatchesTopic(topic) {
        // Match-all when the student filter is not active
        if (!this.selectedStudents?.length) return true;
      
        const ANY = "__any__";
        const selected = (this.selectedStudents || []).map(String);
      
        const ids = new Set();
        this._normalizeStudentIds(topic?.studentIds).forEach(id => ids.add(id));
      
        // If "All Students" is selected, match ONLY if at least one REAL student exists on this topic instance
        if (selected.includes(ANY)) {
          for (const id of ids) {
            if (this.studentById(id)) return true;
          }
          return false;
        }
      
        // If filter is active and topic has no students assigned, it should NOT match
        if (ids.size === 0) return false;
      
        return selected.some(id => ids.has(id));
      },

      // --- BOOKMARK HELPERS (My courses) ---

      // Is this course bookmarked (for courses without topics)?
      isCourseBookmarked(course) {
        return !!(course && course.isBookmarked);
      },

      // Toggle bookmark on this specific course
      toggleCourseBookmark(course) {
        if (!course) return;
        course.isBookmarked = !course.isBookmarked;
        this.persistPlannerStateDebounced();
      },

      // ==== COURSE NOTES (only for courses with NO topics) =======

      courseNoteText(course) {
        if (!course) return "";
        return course.noteText || "";
      },

      updateCourseNoteText(course, text) {
        if (!course) return;
        course.noteText = text;
        this.persistPlannerStateDebounced();
      },

      hasCourseNote(course) {
        if (!course) return false;
        return (course.noteText || "").trim().length > 0;
      },

      toggleCourseNoteOpen(course) {
        if (!course) return;
        course.noteOpen = !course.noteOpen;
      },

      // Is this topic bookmarked *here* in this course?
      isTopicBookmarked(topic) {
        return !!(topic && topic.isBookmarked);
      },

      // Toggle bookmark on this specific topic instance
      toggleTopicBookmark(topic) {
        if (!topic) return;
        topic.isBookmarked = !topic.isBookmarked;
        this.persistPlannerStateDebounced();
      },

      // Are *all* topics in this course bookmarked?
      allTopicsBookmarked(course) {
        if (!course || !Array.isArray(course.topics) || !course.topics.length) return false;
        return course.topics.every(t => t && t.isBookmarked);
      },
      
      // Quickmark: bookmark or un-bookmark *all* topics in this course
      toggleAllTopicsBookmark(course) {
        if (!course || !Array.isArray(course.topics) || !course.topics.length) return;
      
        const markAll = !this.allTopicsBookmarked(course); // if not all → bookmark all; if all → clear all
      
        course.topics.forEach(topic => {
          if (!topic) return;
          topic.isBookmarked = markAll;
        });

        this.persistPlannerStateDebounced();
      },

      // Is this same Topic_ID bookmarked in any *other* course?
      topicBookmarkedElsewhere(topic) {
        if (!topic || !topic.Topic_ID) return false;

        const topicId = String(topic.Topic_ID).trim();
        if (!topicId) return false;

        const all = this.allCoursesBySubject || {};
        const subjects = Object.keys(all);

        for (const subject of subjects) {
          const courses = all[subject] || [];
          for (const course of courses) {
            if (!Array.isArray(course.topics)) continue;

            for (const t of course.topics) {
              if (!t) continue;
              if (t === topic) continue; // skip this exact instance
              if (String(t.Topic_ID || "").trim() !== topicId) continue;
              if (t.isBookmarked) return true;
            }
          }
        }
        return false;
      },

      // Turn a ghost bookmark into a real bookmark on this topic
      applyBookmarkFromElsewhere(topic) {
        if (!topic) return;
        topic.isBookmarked = true;
        this.persistPlannerStateDebounced();
      },

      // clear everything (used by Clear selected button)
      clearAllFilters() {
        // grade
        this.selectedGrades = [];
        this.gradeDropdownOpen = false;

        // subject
        this.selectedSubjects = [];
        this.subjectDropdownOpen = false;

        // planning tags
        this.selectedTags = [];
        this.tagDropdownOpen = false;

        // students
        this.selectedStudents = [];
        this.studentDropdownOpen = false;

        // search
        this.searchQuery = "";

        this.applyFilters();
      },

      clearAllBookmarks() {
        const groups = this.allCoursesBySubject || {};
      
        Object.values(groups).forEach(courses => {
          (courses || []).forEach(course => {
            if (!course) return;
      
            // clear course-level bookmark (for courses without topics)
            course.isBookmarked = false;
      
            // clear topic-level bookmarks (for courses with topics)
            if (Array.isArray(course.topics)) {
              course.topics.forEach(topic => {
                if (!topic) return;
                topic.isBookmarked = false;
              });
            }
          });
        });
      
        // Rebuild visibleCourseGroups / filters view after changes
        this.applyFilters();
        this.persistPlannerStateDebounced();
      },

      // helper: does this item match the grade filter?
      gradeMatches(tags) {
        if (!this.selectedGrades.length) return true;  // no filter => match all
        if (!tags || !tags.length) return false;
        return this.selectedGrades.some(code => tags.includes(code));
      },

      // rebuild coursesBySubject from allCoursesBySubject + filters
      applyFilters() {
        const hasGrade   = this.selectedGrades.length > 0;
        const hasSubject = this.selectedSubjects.length > 0;
        const hasTag     = this.selectedTags.length > 0;
        const hasStudent = this.selectedStudents.length > 0;

        const search = (this.searchQuery || "").trim().toLowerCase();
        const hasSearch = !!search;

        // No filters and no search => show full dataset
        if (!hasGrade && !hasSubject && !hasTag && !hasStudent && !hasSearch) {
          this.coursesBySubject = this.allCoursesBySubject;
          this.persistUiStateDebounced();
          return;
        }

        const filtered = {};
        const subjects = Object.keys(this.allCoursesBySubject);

        subjects.forEach(subject => {
          const courses = this.allCoursesBySubject[subject];
          const subjectCourses = [];

          courses.forEach(course => {
            const matchesGrade   = !hasGrade   || this.gradeMatches(course.gradeTags);
            const matchesSubject = !hasSubject || this.subjectMatches(course.subject);
            const matchesTag     = !hasTag     || this.tagMatchesCourse(course);
            const matchesSearch  = !hasSearch  || this.courseMatchesSearch(course, search);
            const matchesStudent = !hasStudent || this.studentMatchesCourse(course);

            if (!(matchesGrade && matchesSubject && matchesTag && matchesStudent && matchesSearch)) return;

            subjectCourses.push(course);
          });

          if (subjectCourses.length) {
            filtered[subject] = subjectCourses;
          }
        });

        this.coursesBySubject = filtered;
        this.persistUiStateDebounced();
      },

    openPrintTip() {
      // If user chose "don't show again", go straight to printing
      try {
        const hidden = localStorage.getItem("ALVEARY_HIDE_PRINT_TIP") === "1";
        if (hidden) {
          this.printView();
          return;
        }
      } catch (e) {}
    
      // Otherwise show the modal
      this.printTipDontShowAgain = false;
      this.printTipOpen = true;
    },
    
    confirmPrintTipAndPrint() {
      // Save preference
      try {
        if (this.printTipDontShowAgain) {
          localStorage.setItem("ALVEARY_HIDE_PRINT_TIP", "1");
        }
      } catch (e) {}
    
      this.printTipOpen = false;
    
      // Proceed with your existing print flow (Paged.js + page numbers)
      this.printView();
    },
    
    closePrintTip() {
      this.printTipOpen = false;
    },

      printView() {
      // Close any open dropdowns so they don’t overlay the printout
      this.gradeDropdownOpen = false;
      this.subjectDropdownOpen = false;
      this.tagDropdownOpen = false;
      this.studentDropdownOpen = false;
    
      // ✅ Automation / headless / reliable mode:
      // If URL contains ?pdf=1 (or ?forceInPlacePrint=1), skip popup printing entirely.
      const params = new URLSearchParams(window.location.search);
      const forceInPlace =
        params.get("pdf") === "1" || params.get("forceInPlacePrint") === "1";
    
      if (forceInPlace) {
        if (window.alvearyPrintInPlaceWithEagerImages) {
          window.alvearyPrintInPlaceWithEagerImages();
          return;
        }
        window.print();
        return;
      }
    
      // ✅ Human mode: prefer the Paged.js popup flow if it exists
      if (window.alvearyPrintWithPaged) {
        try { window.alvearyPrintWithPaged(); }
        catch (e) {
          // If it errors, fall back to in-place eager printing
          if (window.alvearyPrintInPlaceWithEagerImages) window.alvearyPrintInPlaceWithEagerImages();
          else window.print();
        }
        return;
      }
    
      // If the paged print function is missing, still preload images and then print in-place.
      if (window.alvearyPrintInPlaceWithEagerImages) {
        window.alvearyPrintInPlaceWithEagerImages();
        return;
      }
    
      // Last resort
      window.print();
    },

    // ===============================
    // AUTO-PRINT (automation only)
    // Trigger via: ?autoprint=1&grade=G1   (or G2..G12)
    // Master list: ?autoprint=1&master=1
    // ===============================
    async autoPrintFromQuery() {
      try {
        const params = new URLSearchParams(window.location.search);
    
        // Only run when explicitly requested
        if (params.get("autoprint") !== "1") return;
    
        // Decide target: one grade OR master
        const isMaster = params.get("master") === "1";
        const grade = (params.get("grade") || "").trim().toUpperCase(); // "G1".."G12"
    
        // Safety: if not master, require a valid grade code
        const validGrades = new Set(this.gradeOptions.map(g => String(g.code).toUpperCase()));
        if (!isMaster && !validGrades.has(grade)) {
          console.warn("[autoprint] Invalid or missing grade param:", grade);
          return;
        }
    
        // Ensure we generate a stable, complete view for PDFs
        // (only affects this run; does not persist unless you want it to)
        this.courseListViewMode = "full";
        this.showAllDetails = true;
    
        // Start from a clean slate so "Master" truly means EVERYTHING
        this.clearAllFilters();
    
        // Apply grade filter (or leave empty for Master)
        if (!isMaster) {
          this.selectedGrades = [grade];
        } else {
          this.selectedGrades = [];
        }
    
        // Build filtered dataset
        this.applyFilters();
    
        // Set a helpful title (often becomes the default PDF filename in headless printing)
        const label = this.gradePrintLabel(); // "Grade 1" or "Master"
        document.title = `Alveary Course List — ${label}`;
    
        // Let DOM settle (filters + layout) before print snapshot
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    
        // Use your existing print flow (Paged.js popup if present, else fallback)
        this.printView();
      } catch (e) {
        console.warn("[autoprint] Failed:", e);
      }
    },

      // 🔹 NEW: summary text for the state bar
      get filterSummary() {
        const parts = [];
      
        if (this.selectedGrades?.length) {
          parts.push(
            this.selectedGrades
              .map(code => this.gradeLabelFromCode(code))
              .join(", ")
          );
        }
      
        if (this.selectedSubjects?.length) {
          parts.push(this.selectedSubjects.join(", "));
        }
      
        if (this.selectedTags?.length) {
          parts.push(
            this.selectedTags.length === 1
              ? this.planningTagLabel(this.selectedTags[0])
              : `${this.selectedTags.length} tags`
          );
        }

        if (this.selectedStudents?.length) {
          parts.push(
            this.selectedStudents.length === 1
              ? this.studentNameFromId(this.selectedStudents[0])
              : `${this.selectedStudents.length} students`
          );
        }
      
        // NEW: show My Courses when that toggle is on
        if (this.myCoursesOnly) {
          parts.push("My courses");
        }
      
        if (this.searchQuery) {
          parts.push(`Search: “${this.searchQuery}”`);
        }
      
        return parts.length ? parts.join(" • ") : "";
      },

      // ---------------- NEW STATE FOR COURSES (still inside the object!) ---------------
      isLoadingCourses: true,
      loadError: "",
      allCoursesBySubject: {}, // full dataset
      coursesBySubject: {},    // filtered view

      subjectColors: {
        "Architecture": "#a0a6be",
        "Art": "#907061",
        "Bible": "#964945",
        "Citizenship": "#62765c",
        "English": "#9b5b7b",
        "Geography": "#4d8da2",
        "History": "#6b6bbf",
        "Latin": "#5a5373",
        "Life Skills": "#d1b358",
        "Literature": "#c07669",
        "Math": "#6d7eaa",
        "Modern Language": "#6db4b2",
        "Music": "#9e6bac",
        "Physical Education": "#bd855e",
        "Science": "#96a767",
        "Alt. Science Options": "#96a767",
      },

      subjectColor(name) {
        if (!name) return "#dde2d5";
        const key = Object.keys(this.subjectColors).find(k =>
          k.toLowerCase() === name.toLowerCase()
        );
        return key ? this.subjectColors[key] : "#dde2d5";
      },

    // ---------- UI STATE PERSISTENCE (filters, toggles, search) ----------

    loadUiState() {
      if (typeof window === "undefined" || !window.localStorage) return;
    
      try {
        const raw = localStorage.getItem(UI_STATE_KEY);
        if (!raw) return;
    
        const saved = JSON.parse(raw) || {};
    
        if (Array.isArray(saved.selectedSubjects)) {
          this.selectedSubjects = saved.selectedSubjects;
        }
        if (Array.isArray(saved.selectedGrades)) {
          this.selectedGrades = saved.selectedGrades;
        }
        if (Array.isArray(saved.selectedTags)) {
          this.selectedTags = saved.selectedTags;
        }
        if (typeof saved.searchQuery === "string") {
          this.searchQuery = saved.searchQuery;
        }
        if (typeof saved.myCoursesOnly === "boolean") {
          this.myCoursesOnly = saved.myCoursesOnly;
        }
        // Prefer new view-mode if present
        if (typeof saved.courseListViewMode === "string") {
          const m = saved.courseListViewMode;
          this.courseListViewMode = (m === "compact" || m === "minimal" || m === "full") ? m : "full";
          this.showAllDetails = (this.courseListViewMode === "full");
        } else if (typeof saved.showAllDetails === "boolean") {
          // Back-compat: old toggle maps into view mode
          this.courseListViewMode = saved.showAllDetails ? "full" : "compact";
          this.showAllDetails = !!saved.showAllDetails;
        }
        if (typeof saved.myNotesOpen === "boolean") {
          this.myNotesOpen = saved.myNotesOpen;
        }
    
        if (typeof saved.filtersOpen === "boolean") {
          this.filtersOpen = saved.filtersOpen;
        }

        if (typeof saved.editMode === "boolean") {
          this.editMode = saved.editMode;
        }

        if (Array.isArray(saved.selectedStudents)) {
          this.selectedStudents = saved.selectedStudents;
        }
    
      } catch (err) {
        console.warn("Could not load UI state from localStorage", err);
      }
    },

    persistUiState() {
      if (typeof window === "undefined" || !window.localStorage) return;

      const payload = {
        selectedSubjects: this.selectedSubjects,
        selectedGrades:   this.selectedGrades,
        selectedTags:     this.selectedTags,
        searchQuery:      this.searchQuery,
        myCoursesOnly:    this.myCoursesOnly,
        
        ...(this._hasSetCourseListViewMode ? { courseListViewMode: this.courseListViewMode } : {}),
        
        myNotesOpen:      this.myNotesOpen,
        filtersOpen:      this.filtersOpen,
        editMode:         this.editMode,
        selectedStudents: this.selectedStudents,
      };

      try {
        localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.warn("Could not persist UI state to localStorage", err);
      }
    },

    persistUiStateDebounced() {
      if (this.uiPersistDebounce) {
        clearTimeout(this.uiPersistDebounce);
      }
      this.uiPersistDebounce = setTimeout(() => {
        this.persistUiState();
      }, 150);
    },

    // ---------- PLANNER STATE (bookmarks, tags, notes) ----------

    loadPlannerStateFromStorage() {
      if (typeof window === "undefined" || !window.localStorage) return;

      let raw;
      try {
        raw = localStorage.getItem(PLANNER_STATE_KEY);
      } catch (err) {
        console.warn("Could not read planner state from localStorage", err);
        return;
      }
      if (!raw) return;

      let state;
      try {
        state = JSON.parse(raw);
      } catch (err) {
        console.warn("Invalid planner state JSON", err);
        return;
      }
      if (!state || state.version !== APP_CACHE_VERSION) return;

      // Restore global topic-level notes and tags
      this.globalTopicTags  = state.globalTopicTags  || {};
      this.globalTopicNotes = state.globalTopicNotes || {};

      // Restore global topic-level student memory (for "ghost" chips)
      this.globalTopicStudents = state.globalTopicStudents || {};

      // Restore students (and cursor)
      if (Array.isArray(state.students)) {
        this.students = state.students
          .filter(s => s && s.id)
          .map(s => ({
            id: String(s.id),
            name: typeof s.name === "string" ? s.name : "",
            color: typeof s.color === "string" && s.color ? s.color : "",
          }));
      }

      // Palette may not be built yet if subject options change; rebuild if needed
      if (!Array.isArray(this.studentColorPalette) || !this.studentColorPalette.length) {
        this.studentColorPalette = this.buildStudentColorPalette();
      }

      // Backfill missing colors using the default assignment order
      this.students = (this.students || []).map(s => {
        if (s.color) return s;
        return { ...s, color: this.nextDefaultStudentColor() };
      });

      // Restore cursor (or continue after existing students)
      if (typeof state.studentColorCursor === "number") {
        this.studentColorCursor = state.studentColorCursor;
      } else {
        this.studentColorCursor = (this.students || []).length;
      }

      if (state && typeof state.studentRailCollapsed === "object" && state.studentRailCollapsed) {
        this.studentRailCollapsed = state.studentRailCollapsed;
      }

      const coursesState = state.courses || {};
      const topicsState  = state.topics  || {};

      const makeTagObjects = (ids) => {
        if (!Array.isArray(ids)) return [];
        return ids
          .map(id => {
            const opt = this.planningTagOptions.find(o => o.id === id);
            return opt
              ? { id: opt.id, label: opt.label, img: opt.img }
              : null;
          })
          .filter(Boolean);
      };

      const subjects = Object.keys(this.allCoursesBySubject || {});
      for (const subject of subjects) {
        const courses = this.allCoursesBySubject[subject] || [];
        for (const course of courses) {
          if (!course) continue;

          const courseKey = course.courseId || course.id;
          const cState = courseKey && coursesState[courseKey];
          if (cState) {
            if (typeof cState.isBookmarked === "boolean") {
              course.isBookmarked = cState.isBookmarked;
            }
            if (typeof cState.noteText === "string") {
              course.noteText = cState.noteText;
            }
            if (Array.isArray(cState.tags)) {
              course.planningTags = makeTagObjects(cState.tags);
            }
            // Restore assigned students for this specific course card
            if (Array.isArray(cState.students)) {
              course.studentIds = this._normalizeStudentIds(
                cState.students.map(String).map(s => s.trim()).filter(Boolean)
              );
            } else {
              // Ensure a consistent shape even if nothing stored
              course.studentIds = this._normalizeStudentIds(course.studentIds);
            }
          }

          if (Array.isArray(course.topics)) {
            for (const topic of course.topics) {
              if (!topic) continue;

              const topicId = String(
                topic.Topic_ID || topic.topic_id || topic.id || ""
              ).trim();
              if (!topicId) continue;
              if (!courseKey) continue;

              const instanceKey = `${courseKey}::${topicId}`;
              const tState = topicsState[instanceKey];
              if (!tState) continue;

              if (typeof tState.isBookmarked === "boolean") {
                topic.isBookmarked = tState.isBookmarked;
              }
              if (Array.isArray(tState.tags)) {
                topic.planningTags = makeTagObjects(tState.tags);
              }
              // Restore assigned students for this specific topic *instance*
              if (Array.isArray(tState.students)) {
                topic.studentIds = this._normalizeStudentIds(
                  tState.students.map(String).map(s => s.trim()).filter(Boolean)
                );
              } else {
                topic.studentIds = this._normalizeStudentIds(topic.studentIds);
              }
              // Topic notes are global per Topic_ID (this.globalTopicNotes),
              // so we don't restore them here; topicNoteText() reads from that map.
            }
          }
        }
      }

        // ✅ Extras hook (books page, budget page later, etc.)
        // If a page defines an applier, let it restore extra planner state.
        try {
          if (typeof this.applyPlannerExtras === "function") {
            // We stored extras under state.extras in persistPlannerState()
            this.applyPlannerExtras(state.extras || {}, state);
          }
        } catch (e) {
          console.warn("Could not apply planner extras", e);
        }
    },

    persistPlannerState() {
      if (typeof window === "undefined" || !window.localStorage) return;

      const state = {
        version: APP_CACHE_VERSION,
        globalTopicTags:  this.globalTopicTags  || {},
        globalTopicNotes: this.globalTopicNotes || {},
        globalTopicStudents: this.globalTopicStudents || {},

        students: (this.students || []).slice(0, 15),
        studentColorCursor: this.studentColorCursor || 0,
        studentRailCollapsed: this.studentRailCollapsed || {},

        courses: {},
        topics: {},
      };

      const subjects = Object.keys(this.allCoursesBySubject || {});

      const tagIdsFromObjs = (tags) =>
        Array.isArray(tags) ? tags.map(t => t.id).filter(Boolean) : [];

      for (const subject of subjects) {
        const courses = this.allCoursesBySubject[subject] || [];
        for (const course of courses) {
          if (!course) continue;

          const courseKey = course.courseId || course.id;
          if (!courseKey) continue;

          const isBookmarked = !!course.isBookmarked;
          const noteText     = typeof course.noteText === "string"
            ? course.noteText
            : "";
          const tagIds       = tagIdsFromObjs(course.planningTags);
          const studentIds   = Array.isArray(course.studentIds)
            ? course.studentIds.map(String).map(s => s.trim()).filter(Boolean)
            : [];

          if (
            isBookmarked ||
            noteText.trim().length > 0 ||
            tagIds.length > 0 ||
            studentIds.length > 0
          ) {
            state.courses[courseKey] = {
              isBookmarked,
              noteText,
              tags: tagIds,
              students: studentIds,
            };
          }

          if (Array.isArray(course.topics)) {
            for (const topic of course.topics) {
              if (!topic) continue;

              const topicId = String(
                topic.Topic_ID || topic.topic_id || topic.id || ""
              ).trim();
              if (!topicId) continue;

              const instanceKey = `${courseKey}::${topicId}`;
              const tBookmarked = !!topic.isBookmarked;
              const tTagIds     = tagIdsFromObjs(topic.planningTags);
              const tStudentIds = Array.isArray(topic.studentIds)
                ? topic.studentIds.map(String).map(s => s.trim()).filter(Boolean)
                : [];

              if (tBookmarked || tTagIds.length > 0 || tStudentIds.length > 0) {
                state.topics[instanceKey] = {
                  isBookmarked: tBookmarked,
                  tags: tTagIds,
                  students: tStudentIds,
                };
              }
            }
          }
        }
      }

      // ✅ Extras hook (books page, future member state, etc.)
      // If a page defines a collector, merge its extra data into state.extras
      try {
        if (typeof this.collectPlannerExtras === "function") {
          const extras = this.collectPlannerExtras();
          if (extras && typeof extras === "object") {
            state.extras = { ...(state.extras || {}), ...extras };
          }
        }
      } catch (e) {
        console.warn("Could not collect planner extras", e);
      }

      // ✅ Preserve extras across pages that DON'T collect them (ex: Course List)
      try {
        const existingRaw = localStorage.getItem(PLANNER_STATE_KEY);
        if (existingRaw) {
          const existing = JSON.parse(existingRaw);
      
          // If this save didn't produce extras, carry forward existing extras
          if (!state.extras && existing?.extras) {
            state.extras = existing.extras;
          }
      
          // If this save DID produce extras, merge with existing so sibling extras survive
          if (state.extras && existing?.extras && typeof state.extras === "object") {
            state.extras = { ...existing.extras, ...state.extras };
          }
        }
      } catch (e) {
        console.warn("Could not merge existing planner extras", e);
      }

      try {
        localStorage.setItem(PLANNER_STATE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn("Could not persist planner state to localStorage", err);
      }
    },

    persistPlannerStateDebounced() {
      if (this.plannerPersistDebounce) {
        clearTimeout(this.plannerPersistDebounce);
      }
      this.plannerPersistDebounce = setTimeout(() => {
        this.persistPlannerState();
      }, 200);
    },

    async initAuth({ force = false } = {}) {
      try {
        const auth = await (window.AlvearyAuth?.whoami?.({ force }) || null);
        const role = (auth?.role || "public").toLowerCase();
        this.authRole = role;
        this.isAuthed = !!auth?.ok;
        this.isStaff = role === "staff";
        this.isMember = role === "member" || this.isStaff;
        return auth;
      } catch {
        this.authRole = "public";
        this.isAuthed = false;
        this.isStaff = false;
        this.isMember = false;
        return { ok: false, role: "public", reason: "auth_exception" };
      }
    },
    
    async openAuth() {
      try {
        // Open MemberStack modal (login/signup/etc.)
        await window.AlvearyAuth?.openAuth?.("LOGIN");
    
        // ✅ MemberStack session can take a moment to become readable after modal closes.
        // Poll a few times until we see a real authed role.
        const maxTries = 12;          // ~3s total
        const delayMs = 250;
    
        for (let i = 0; i < maxTries; i++) {
          await this.initAuth({ force: true });
    
          // Stop as soon as auth is recognized
          if (this.isAuthed && (this.isMember || this.isStaff)) break;
    
          await new Promise((r) => setTimeout(r, delayMs));
        }
    
        // Re-run your gate after auth updates
        this.enforceAccessGate?.();
      } catch (e) {
        console.warn("openAuth failed:", e);
      }
    },
    
    enforceAccessGate() {
      // Public users: books only. Members+staff: both pages. Staff: also sees edit toggle.
      const path = window.location.pathname || "";
      const onCourseList =
        path.endsWith("/index.html") || path.endsWith("/") || path.endsWith("/index");
    
      if (onCourseList && !this.isMember) {
        window.location.href = "books.html?auth=required";
        return false;
      }
      return true;
    },

    // ---------- INIT & COURSE DATA LOADING (with cache) ----------

    async init() {
      await this.initAuth();
      if (this.enforceAccessGate?.() === false) return;

      // 1) Restore filters/search/toggles from previous visit
      this.loadUiState();
      if (!this.isStaff) this.editMode = false;
    
      // Students: build palette (follows subject color order)
      this.studentColorPalette = this.buildStudentColorPalette();
    
      // 2) Load course data (from cache if available, then refresh from network)
      await this.loadCoursesFromJson();
    
      // 3) Automation-only: if URL requests it, auto-filter + print
      await this.autoPrintFromQuery?.();
    },

    // Load courses with a "stale-while-revalidate" strategy:
    // - First try localStorage (fast).
    // - Then fetch from network and refresh both state + cache.
    async loadCoursesFromJson() {
      this.isLoadingCourses = true;
      this.loadError = "";

      let hadCached = false;

      // Step 1: try cached JSON
      if (typeof window !== "undefined" && window.localStorage) {
        try {
          const cachedRaw = localStorage.getItem(COURSES_CACHE_KEY);
          if (cachedRaw) {
            const cachedData = JSON.parse(cachedRaw);
            if (cachedData && typeof cachedData === "object") {
              this.allCoursesBySubject = cachedData;
              this.loadPlannerStateFromStorage();
              this.applyFilters();      // respects restored filters
              hadCached = true;
            }
          }
        } catch (err) {
          console.warn("Could not read cached courses from localStorage", err);
        }
      }

      // Step 2: always try to fetch fresh data
      try {
        const res = await fetch(MA_COURSES_JSON_URL, { cache: "no-cache" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        // Normalize JSON so the app works with BOTH shapes:
        // - { "Bible": [ ... ] }
        // - { "Bible": { courses:[...], lastUpdated:"..." } }
        // - OR wrapper shapes like { coursesBySubject:{...}, lastUpdated:"..." }
        const bySubject =
          data?.coursesBySubject ||
          data?.bySubject ||
          data?.subjects ||
          data ||
          {};
        
        this.allCoursesBySubject = bySubject;

        // Helper: does this course/topic actually have any details text?
        const hasCourseDetails = (course) => {
          const d = (course.description || "").trim();
          const t = (course.tips || "").trim();
          return !!(d || t);
        };

        const hasTopicDetails = (topic) => {
          const d = (topic.description || "").trim();
          const t = (topic.tips || "").trim();
          return !!(d || t);
        };

        // Only default-open items that really have details
        for (const subject of Object.keys(this.allCoursesBySubject || {})) {
        const bucket = this.allCoursesBySubject?.[subject];
        const courses =
          Array.isArray(bucket) ? bucket :
          Array.isArray(bucket?.courses) ? bucket.courses :
          [];
      
        for (const course of courses) {
          if (!course || typeof course !== "object") continue;
      
          course.detailsOpen = hasCourseDetails(course);
      
          if (Array.isArray(course.topics)) {
            for (const topic of course.topics) {
              if (!topic || typeof topic !== "object") continue;
              topic.detailsOpen = hasTopicDetails(topic);
            }
          }
        }
      }

        this.loadPlannerStateFromStorage();
        this.applyFilters();

        // Step 3: update cache
        if (typeof window !== "undefined" && window.localStorage) {
          try {
            localStorage.setItem(COURSES_CACHE_KEY, JSON.stringify(data));
          } catch (err) {
            console.warn("Could not write courses cache to localStorage", err);
          }
        }
      } catch (err) {
        console.error("Error loading course JSON", err);

        // Only show a blocking error if we had no cached data to fall back on
        if (!hadCached) {
          this.loadError =
            "We couldn’t load the course data. Please try refreshing the page.";
        }
      } finally {
        this.isLoadingCourses = false;
      }
    }
    };
  }
