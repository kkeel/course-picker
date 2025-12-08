const MA_COURSES_JSON_URL = "data/MA_Courses.json";

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

      toggleAllDetails() {
        this.showAllDetails = !this.showAllDetails;
      },

      toggleMyCoursesOnly() {
        this.myCoursesOnly = !this.myCoursesOnly;
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
      },

      // ==== COURSE NOTES (only for courses with NO topics) =======

      courseNoteText(course) {
        if (!course) return "";
        return course.noteText || "";
      },

      updateCourseNoteText(course, text) {
        if (!course) return;
        course.noteText = text;
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

        // No filters => show full dataset
        if (!hasGrade && !hasSubject && !hasTag) {
          this.coursesBySubject = this.allCoursesBySubject;
          return;
        }

        const filtered = {};
        const subjects = Object.keys(this.allCoursesBySubject);

        subjects.forEach(subject => {
          const courses = this.allCoursesBySubject[subject];
          const subjectCourses = [];

          courses.forEach(course => {
            const matchesGrade =
              !hasGrade || this.gradeMatches(course.gradeTags);

            const matchesSubject =
              !hasSubject || this.subjectMatches(course.subject);

            const matchesTag =
              !hasTag || this.tagMatchesCourse(course);

            if (!(matchesGrade && matchesSubject && matchesTag)) return;

            // IMPORTANT: we now keep the original course object
            // so planning tags and other state persist.
            subjectCourses.push(course);
          });

          if (subjectCourses.length) {
            filtered[subject] = subjectCourses;
          }
        });

        this.coursesBySubject = filtered;
      },

      // new state for courses
      isLoadingCourses: true,
      loadError: "",
      allCoursesBySubject: {}, // full dataset
      coursesBySubject: {},    // filtered view

      subjectColors: {
      'Architecture': '#a0a6be',
      'Art': '#907061',
      'Bible': '#964945',
      'Citizenship': '#62765c',
      'English': '#9b5b7b',
      'Geography': '#4d8da2',
      'History': '#6b6bbf',
      'Latin': '#5a5373',
      'Life Skills': '#d1b358',
      'Literature': '#c07669',
      'Math': '#6d7eaa',
      'Modern Language': '#6db4b2',
      'Music': '#9e6bac',
      'Physical Education': '#bd855e',
      'Science': '#96a767',
      'Alt. Science Options': '#96a767'
    },
    
    subjectColor(name) {
      if (!name) return '#dde2d5';
      const key = Object.keys(this.subjectColors).find(k =>
        k.toLowerCase() === name.toLowerCase()
      );
      return key ? this.subjectColors[key] : '#dde2d5';
    },

      async init() {
        await this.loadCoursesFromJson();
      },

      // Future loader: use pre-built JSON instead of CSV
      async loadCoursesFromJson() {
        this.isLoadingCourses = true;
        this.loadError = "";
        try {
          const res = await fetch(MA_COURSES_JSON_URL);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          const data = await res.json();

          // We expect data to already be in the shape:
          // { "Art": [courses...], "Bible": [courses...], ... }
          this.allCoursesBySubject = data;
          this.applyFilters();
        } catch (err) {
          console.error("Error loading course JSON", err);
          this.loadError =
            "We couldn’t load the course data. Please try refreshing the page.";
        } finally {
          this.isLoadingCourses = false;
        }
      },
    };
  }
