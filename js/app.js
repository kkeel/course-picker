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

      // --- PLANNING TAG OPTIONS ---
      // Adjust image filenames/paths as needed so they match your repo
      planningTagOptions: [
        {
          id: "core",
          label: "Core",
          img: "Core%20Subjects.png",
        },
        {
          id: "family",
          label: "Family",
          img: "Family%20Subjects.png",
        },
        {
          id: "combine",
          label: "Combine",
          img: "Combine%20Subjects.png",
        },
        {
          id: "high-interest",
          label: "High interest",
          img: "High%20Interest%20Subjects.png",
        },
        {
          id: "additional",
          label: "Additional",
          img: "Additional%20Subjects.png",
        },
      ],

      toggleAllDetails() {
        this.showAllDetails = !this.showAllDetails;
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

      subjectMatches(courseSubject) {
        if (!this.selectedSubjects.length) return true; // no subject filter
        if (!courseSubject) return false;
        const subj = courseSubject.trim();
        return this.selectedSubjects.includes(subj);
      },

      // --- PLANNING TAG HELPERS ---
      togglePlanningTag(item, opt) {
        if (!item.planningTags) item.planningTags = [];
      
        const existingIndex = item.planningTags.findIndex(t => t.id === opt.id);
        if (existingIndex === -1) {
          item.planningTags.push({ id: opt.id, label: opt.label, img: opt.img });
        } else {
          item.planningTags.splice(existingIndex, 1);
        }
      
        // close after click
        this.closePlanningMenu();
      },

      removePlanningTag(item, tagId) {
        if (!item.planningTags) return;
        item.planningTags = item.planningTags.filter(t => t.id !== tagId);
      },

      // clear everything (used by Clear selected button)
      clearAllFilters() {
        this.selectedGrades = [];
        this.gradeDropdownOpen = false;

        this.selectedSubjects = [];
        this.subjectDropdownOpen = false;

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

        // No filters => show full dataset
        if (!hasGrade && !hasSubject) {
          this.coursesBySubject = this.allCoursesBySubject;
          return;
        }

        const filtered = {};
        const subjects = Object.keys(this.allCoursesBySubject);

        subjects.forEach(subject => {
          const courses = this.allCoursesBySubject[subject];
          const subjectCourses = [];

          courses.forEach(course => {
            // grade check (course-level only)
            const matchesGrade =
              !hasGrade || this.gradeMatches(course.gradeTags);

            // subject check (course.subject must match one of selectedSubjects)
            const matchesSubject =
              !hasSubject || this.subjectMatches(course.subject);

            if (!(matchesGrade && matchesSubject)) return;

            // If course passes filters, include it with all its topics
            const courseCopy = {
              ...course,
              topics: course.topics || [],
            };

            subjectCourses.push(courseCopy);
          });

          // Only include subject if it has at least one visible course
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
