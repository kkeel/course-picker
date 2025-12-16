// Data URL for pre-built course JSON
const MA_COURSES_JSON_URL = "data/MA_Courses.json";

// Bump this version string whenever you change the JSON shape
// or the UI state we store in localStorage.
const APP_CACHE_VERSION = "2025-12-09-v1";

// Keys for localStorage
const COURSES_CACHE_KEY = `alveary_courses_${APP_CACHE_VERSION}`;
const UI_STATE_KEY      = `alveary_ui_${APP_CACHE_VERSION}`;
const PLANNER_STATE_KEY = `alveary_planner_${APP_CACHE_VERSION}`;

function coursePlanner() {
  return {
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

      // new global detail toggle
      showAllDetails: true,
      myCoursesOnly: false,
      myNotesOpen: false,
      editMode: false, // staff-only

      // debounce handle for saving UI state
      uiPersistDebounce: null,
    
      // debounce handle for saving planner state
      plannerPersistDebounce: null,

      // --- FILTER PANEL ---
      filtersOpen: true,

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

      toggleAllDetails() {
        this.showAllDetails = !this.showAllDetails;
        this.persistUiStateDebounced();
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

      toggleFiltersOpen() {
        this.filtersOpen = !this.filtersOpen;
        this.persistUiStateDebounced();
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
      
      // Topic list used by the template for each course.
      // When My Courses is on, show only bookmarked topics in that course.
      visibleTopicsForCourse(course) {
        const topics = Array.isArray(course.topics) ? course.topics : [];
        if (!this.myCoursesOnly) return topics;
        return topics.filter(t => this.isTopicBookmarked(t));
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
        this.selectedGrades = [];
        this.gradeDropdownOpen = false;

        this.selectedSubjects = [];
        this.subjectDropdownOpen = false;

        this.selectedTags = [];
        this.tagDropdownOpen = false;

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

        const search = (this.searchQuery || "").trim().toLowerCase();
        const hasSearch = !!search;

        // No filters and no search => show full dataset
        if (!hasGrade && !hasSubject && !hasTag && !hasSearch) {
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

            if (!(matchesGrade && matchesSubject && matchesTag && matchesSearch)) return;

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
      
        // Let Alpine finish any DOM updates, then print
        this.$nextTick(async () => {
          // ✅ If our print-only Paged.js helper exists, use it (gives real p.#)
          if (window.alvearyPrintWithPaged) {
            await window.alvearyPrintWithPaged();
            return;
          }
      
          // Fallback (no page numbering)
          window.print();
        });
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
        if (typeof saved.showAllDetails === "boolean") {
          this.showAllDetails = saved.showAllDetails;
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
        showAllDetails:   this.showAllDetails,
        myNotesOpen:      this.myNotesOpen,
        filtersOpen:      this.filtersOpen,
        editMode:         this.editMode,
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
              // Topic notes are global per Topic_ID (this.globalTopicNotes),
              // so we don't restore them here; topicNoteText() reads from that map.
            }
          }
        }
      }
    },

    persistPlannerState() {
      if (typeof window === "undefined" || !window.localStorage) return;

      const state = {
        version: APP_CACHE_VERSION,
        globalTopicTags:  this.globalTopicTags  || {},
        globalTopicNotes: this.globalTopicNotes || {},
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

          if (
            isBookmarked ||
            noteText.trim().length > 0 ||
            tagIds.length > 0
          ) {
            state.courses[courseKey] = {
              isBookmarked,
              noteText,
              tags: tagIds,
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

              if (tBookmarked || tTagIds.length > 0) {
                state.topics[instanceKey] = {
                  isBookmarked: tBookmarked,
                  tags: tTagIds,
                };
              }
            }
          }
        }
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

    // ---------- INIT & COURSE DATA LOADING (with cache) ----------

    async init() {
      // 1) Restore filters/search/toggles from previous visit
      this.loadUiState();
      if (!this.isStaff) this.editMode = false;

      // 2) Load course data (from cache if available, then refresh from network)
      await this.loadCoursesFromJson();
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
