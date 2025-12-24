// ✅ Book List data bootstrapping (Assignments + Resources JSON)
(() => {
  const originalCoursePlanner = window.coursePlanner;

  // If app.js didn't load for some reason, don't crash.
  if (typeof originalCoursePlanner !== "function") return;

  const ASSIGNMENTS_URL = "data/MA_Assignments.json";
  const RESOURCES_URL   = "data/MA_Resources.json";

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }

    function normalizeDriveImageUrl(url) {
    if (!url) return "";

    const s = String(url);

    // Common Drive patterns:
    // 1) https://drive.google.com/uc?id=FILEID
    // 2) https://drive.google.com/open?id=FILEID
    // 3) https://drive.google.com/file/d/FILEID/view?...
    let id = "";

    // uc?id= or open?id=
    const m1 = s.match(/[?&]id=([^&]+)/);
    if (m1 && m1[1]) id = m1[1];

    // /file/d/FILEID/
    if (!id) {
      const m2 = s.match(/\/file\/d\/([^/]+)/);
      if (m2 && m2[1]) id = m2[1];
    }

    if (!id) return s; // not a drive link we recognize—leave it alone

    // Thumbnail URL returns actual image bytes (best for <img>)
    return `https://drive.google.com/thumbnail?id=${id}&sz=w400`;
  }

  window.coursePlanner = function () {
    const original = originalCoursePlanner();
    const originalInit = original.init;

    return {
      ...original,

      // ---- Read-only data holders (no UI changes yet) ----
      isLoadingBookData: false,
      bookDataError: "",

      assignmentsData: null,
      resourcesData: null,

      // Indexes for fast lookup later
      assignmentsByTargetId: {},   // { [targetId]: assignment[] }
      assignmentsByResourceId: {}, // { [resourceId]: assignment[] }
      resourcesById: {},           // { [resourceId]: resource }

      async init() {
        // Run your normal init first (courses/topics load, auth wrapper, etc.)
        if (typeof originalInit === "function") {
          await originalInit.call(this);
        }

        // Then load booklist data (read-only for now)
        await this.loadBookDataR3();
      },

      async loadBookDataR3() {
        this.isLoadingBookData = true;
        this.bookDataError = "";

        try {
          const [assignmentsJson, resourcesJson] = await Promise.all([
            fetchJson(ASSIGNMENTS_URL),
            fetchJson(RESOURCES_URL),
          ]);

          this.assignmentsData = assignmentsJson;
          this.resourcesData = resourcesJson;

          // Build resourcesById
          const resById = {};
          for (const r of (resourcesJson?.resources || [])) {
            if (r && r.resourceId) {
              // normalize image URL so <img> gets real image bytes
              r.imageViewLink = normalizeDriveImageUrl(r.imageViewLink);
              resById[r.resourceId] = r;
            }
          }
          this.resourcesById = resById;

          // Build assignments indexes
          const byTarget = {};
          const byResource = {};

          for (const a of (assignmentsJson?.assignments || [])) {
            if (!a || !a.targetId || !a.resourceId) continue;

            (byTarget[a.targetId] ||= []).push(a);
            (byResource[a.resourceId] ||= []).push(a);
          }

          // Stable sort within each target by resourceKey then title
          for (const tid of Object.keys(byTarget)) {
            byTarget[tid].sort((x, y) => {
              const ak = (x.resourceKey || "").toString();
              const bk = (y.resourceKey || "").toString();
              if (ak !== bk) return ak.localeCompare(bk);

              const at = (resById[x.resourceId]?.title || "").toString();
              const bt = (resById[y.resourceId]?.title || "").toString();
              if (at !== bt) return at.localeCompare(bt);

              return (x.resourceId || "").localeCompare(y.resourceId || "");
            });
          }

          this.assignmentsByTargetId = byTarget;
          this.assignmentsByResourceId = byResource;

          console.log(
            "[BookData] Loaded",
            (assignmentsJson?.assignments || []).length,
            "assignments and",
            (resourcesJson?.resources || []).length,
            "resources"
          );
        } catch (e) {
          console.warn(e);
          this.bookDataError = e?.message || "Failed to load book data JSON.";
        } finally {
          this.isLoadingBookData = false;
        }
      },
      localCoverPath(resourceId) {
        if (!resourceId) return "img/placeholders/book.svg";
      
        const v = this.resourcesData?.lastUpdated
          ? `?v=${encodeURIComponent(this.resourcesData.lastUpdated)}`
          : "";
      
        return `img/resources/${resourceId}.webp${v}`;
      },
      
      placeholderCover() {
        return "img/placeholders/book.svg";
      },

      isOptionalAssignment(a) {
        if (!a) return false;
      
        // Common boolean flags
        if (a.isOptional === true || a.optional === true) return true;
      
        // Sometimes a Yes/No string field exists
        const yn = String(a.optionalYN || a.optionalFlag || a.optionalQ || "").trim().toLowerCase();
        if (["yes", "y", "true", "1"].includes(yn)) return true;
      
        // Common “Requirement” style fields (string)
        const s = String(
          a.requirement ??
          a.required ??
          a.requiredness ??
          a.resourceRequirement ??
          a.assignmentType ??
          ""
        ).trim().toLowerCase();
      
        // If the word optional appears anywhere, treat it as optional
        if (s.includes("optional")) return true;
      
        return false;
      },

      // -----------------------------
      // ✅ Book List: hide empty items in published view
      // -----------------------------
      _bookTargetId(item) {
        if (!item) return "";
        return String(item.recordID || item.id || "").trim();
      },

      _hasAssignmentsForTargetId(targetId) {
        if (!targetId) return false;
        const arr = this.assignmentsByTargetId?.[targetId] || [];
        if (!Array.isArray(arr) || arr.length === 0) return false;
      
        // ✅ "Has assignments" for published view means: at least one row with a resourceId
        return arr.some(a => String(a?.resourceId || "").trim());
      },

      _editUrlForTargetId(targetId) {
        if (!targetId) return "";
        const arr = this.assignmentsByTargetId?.[targetId] || [];
        const first = Array.isArray(arr) && arr.length ? arr[0] : null;
        return String(first?.editUrl || "").trim();
      },

      _bookHasAssignments(item) {
        const tid = this._bookTargetId(item);
        return this._hasAssignmentsForTargetId(tid);
      },

      // Override: topics shown under a course
      visibleTopicsForCourse(course) {
        // Start with whatever app.js would normally show (student filter, My Courses, etc.)
        let topics =
          typeof original.visibleTopicsForCourse === "function"
            ? original.visibleTopicsForCourse.call(this, course)
            : (Array.isArray(course?.topics) ? course.topics : []);

        // Edit view (staff-only) shows everything
        if (this.editMode) return topics;

        // If assignments aren't loaded yet, don't hide anything (avoid blank screen during load)
        if (this.isLoadingBookData || !this.assignmentsData) return topics;

        // Published view: keep only topics with at least one assignment
        return topics.filter(t => this._bookHasAssignments(t));
      },

      // Override: subject -> courses map used by the Book List template
      visibleCourseGroups() {
        const groups =
          typeof original.visibleCourseGroups === "function"
            ? original.visibleCourseGroups.call(this)
            : (this.coursesBySubject || {});

        // Edit view (staff-only) shows everything
        if (this.editMode) return groups;

        // If assignments aren't loaded yet, don't hide anything
        if (this.isLoadingBookData || !this.assignmentsData) return groups;

        const result = {};

        for (const [subject, courses] of Object.entries(groups || {})) {
          const kept = (courses || []).filter(course => {
            const hasTopics = Array.isArray(course?.topics) && course.topics.length > 0;

            // Course-level assignments (course itself as target)
            const courseHas = this._bookHasAssignments(course);

            // Topic-level assignments (any visible topic has an assignment)
            const topicsVisible = hasTopics ? this.visibleTopicsForCourse(course) : [];

            // Keep the course if:
            // - it has course-level assignments, OR
            // - it has at least one topic that has assignments
            return courseHas || (topicsVisible.length > 0);
          });

          if (kept.length) result[subject] = kept;
        }

        return result;
      },
      
    };
  };
})();
