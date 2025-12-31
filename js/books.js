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

          // TEMP DEBUG — remove after
          const assignmentsArr = (assignmentsJson?.assignments || []);
          const missing = assignmentsArr.filter(a => {
            const rid = String(a?.resourceId || "").trim();
            return rid && !resById[rid];
          });
          
          console.log("[Debug] assignments missing resource lookup:", missing.length);
          console.table(
            missing.slice(0, 20).map(a => ({
              assignmentId: a.assignmentId,
              resourceId: a.resourceId,
              resourceId_trim: String(a?.resourceId || "").trim(),
              targetId: a.targetId,
            }))
          );

          // Build assignments indexes
          const byTarget = {};
          const byResource = {};

          for (const a of (assignmentsJson?.assignments || [])) {
            if (!a) continue;
          
            // ✅ Normalize IDs once so lookups always match
            a.targetId   = String(a.targetId || "").trim();
            a.resourceId = String(a.resourceId || "").trim();
          
            if (!a.targetId || !a.resourceId) continue;
          
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
        const rid = a?.resourceId;
        const resourceOptional = !!(this.resourcesById?.[rid]?.flags?.optional);
        const assignmentOptional = !!(a?.optional);
        return assignmentOptional || resourceOptional;
      },

      isChooseOneAssignment(a) {
        const rid = String(a?.resourceId || "").trim();
        if (!rid) return false;
      
        return this.resourcesById?.[rid]?.flags?.chooseOne === true;
      },

      // --------------------------------------------------
      // Resource Preparation: My Books (V1 – local only)
      // --------------------------------------------------
      
      _myBooksResourceIds: new Set(),
      
      isResourceInMyBooks(resourceId) {
        if (!resourceId) return false;
        return this._myBooksResourceIds.has(String(resourceId));
      },
      
      toggleResourceMyBooks(resourceId) {
        if (!resourceId) return;
        const id = String(resourceId);
      
        if (this._myBooksResourceIds.has(id)) {
          this._myBooksResourceIds.delete(id);
        } else {
          this._myBooksResourceIds.add(id);
        }
      
        // ✅ persist (same mechanism as bookmarks/students/tags)
        this.persistPlannerStateDebounced();
      },

      // --------------------------------------------------
      // Resource Preparation: collapse state (V1 – local only)
      // Default: OPEN when the resource is in My Books
      // --------------------------------------------------
      
      _prepOpenByResourceId: {},
      
      isPrepOpen(resourceId) {
        if (!resourceId) return true; // default open for safety
        const id = String(resourceId);
      
        // If user has never toggled it, default OPEN
        if (!this._prepOpenByResourceId || this._prepOpenByResourceId[id] === undefined) return true;
      
        return (this._prepOpenByResourceId[id] !== false); // explicit false = closed
      },
      
      togglePrepOpen(resourceId) {
        if (!resourceId) return;
        const id = String(resourceId);
      
        if (!this._prepOpenByResourceId) this._prepOpenByResourceId = {};
      
        const next = !this.isPrepOpen(id);
        this._prepOpenByResourceId[id] = next;
      
        // ✅ persist
        this.persistPlannerStateDebounced();
      },

      // --------------------------------------------------
      // Resource Preparation: options (V1 – no modal yet)
      // --------------------------------------------------
      
      _optionsByResourceId: {},

      // Modal state for Resource Options
      prepOptionsModalOpen: false,
      prepOptionsModalResourceId: "",
      prepOptionsModalSubject: "",
      prepOptionsModalResourceTitle: "",
      
      getPrepOptions(resourceId) {
        const id = String(resourceId || "");
        const map = this._optionsByResourceId || {};
        const arr = map[id];
        return Array.isArray(arr) ? arr : [];
      },
      
      addPrepOption(resourceId, kind = "physical", mode = "purchase", status = "not_ready") {
        const id = String(resourceId || "");
        if (!id) return;
      
        if (!this._optionsByResourceId) this._optionsByResourceId = {};
        if (!Array.isArray(this._optionsByResourceId[id])) this._optionsByResourceId[id] = [];
      
        this._optionsByResourceId[id].push({
          kind: (kind === "digital") ? "digital" : "physical",
          mode: String(mode || "purchase"),
          status: String(status || "not_ready")
        });
      
        this.persistPlannerStateDebounced();
      },
      
      removePrepOption(resourceId, index) {
        const id = String(resourceId || "");
        if (!id) return;
      
        const arr = this.getPrepOptions(id);
        if (!arr.length) return;
      
        arr.splice(index, 1);
        this._optionsByResourceId[id] = arr;
      
        this.persistPlannerStateDebounced();
      },

      updatePrepOption(resourceId, index, patch) {
        const id = String(resourceId || "");
        if (!id) return;
      
        if (!this._optionsByResourceId) this._optionsByResourceId = {};
        const arr = this._optionsByResourceId[id];
        if (!Array.isArray(arr) || !arr[index]) return;
      
        arr[index] = { ...arr[index], ...(patch || {}) };
        this._optionsByResourceId[id] = arr;
      
        this.persistPlannerStateDebounced();
      },

      openPrepOptionsModal(resourceId, subject) {
        const id = String(resourceId || "");
        if (!id) return;
      
        // Only allow if in My Books (keeps UI logic consistent)
        if (!this.isResourceInMyBooks(id)) return;
      
        this.prepOptionsModalResourceId = id;
        this.prepOptionsModalSubject = String(subject || "");
      
        // Nice-to-have title in modal
        this.prepOptionsModalResourceTitle =
          this.resourcesById?.[id]?.title ||
          "";
      
        this.prepOptionsModalOpen = true;
      
        // Ensure the prep section is open when editing options
        this._prepOpenByResourceId[id] = true;
      
        this.persistPlannerStateDebounced();
      },
      
      closePrepOptionsModal() {
        this.prepOptionsModalOpen = false;
      },

      // --------------------------------------------------
      // Planner extras (persist inside the shared planner blob)
      // This mirrors how bookmarks/students/tags are saved,
      // and sets us up for member-account sync later.
      // --------------------------------------------------
      
      collectPlannerExtras() {
        return {
          resources: {
            myBooks: Array.from(this._myBooksResourceIds || []),
            prepOpenByResourceId: this._prepOpenByResourceId || {},
            optionsByResourceId: this._optionsByResourceId || {},
          }
        };
      },
      
      applyPlannerExtras(extras) {
        const r = extras?.resources;
        if (!r) return;
      
        // Restore My Books
        const ids = Array.isArray(r.myBooks) ? r.myBooks : [];
        this._myBooksResourceIds = new Set(ids.map(String));
      
        // Restore prep collapse state
        const po = (r.prepOpenByResourceId && typeof r.prepOpenByResourceId === "object")
          ? r.prepOpenByResourceId
          : {};
        this._prepOpenByResourceId = { ...po };

          // Restore resource options
          const ob = (r.optionsByResourceId && typeof r.optionsByResourceId === "object")
            ? r.optionsByResourceId
            : {};
          this._optionsByResourceId = { ...ob };
      },

      altFormatsForAssignment(a) {
        const rid = String(a?.resourceId || "").trim();
        if (!rid) return [];
      
        const txt = this.resourcesById?.[rid]?.resourceTagText;
        if (!txt) return [];
      
        // resourceTagText examples: "Ebook", "Ebook, Audiobook", "Video"
        const parts = String(txt)
          .split(/[,;\n]/)
          .map(s => s.trim())
          .filter(Boolean);
      
        const set = new Set(parts.map(p => p.toLowerCase()));
      
        // Always show in this order if present:
        const order = ["ebook", "audiobook", "video"];
      
        const out = [];
        for (const key of order) {
          if (set.has(key)) {
            if (key === "audiobook") {
              out.push("Audiobook");
            } else {
              out.push(key.charAt(0).toUpperCase() + key.slice(1));
            }
          }
        }
        return out;
      },

      assignmentSharedR3Text(a) {
        if (!a) return "";
      
        // Preferred: preserve explicit lines from JSON
        if (Array.isArray(a.sharedLinesR3) && a.sharedLinesR3.length) {
          return a.sharedLinesR3.map(x => String(x || "").trim()).filter(Boolean).join("\n");
        }
      
        // Fallback: plain shared text
        if (a.sharedTextR3 != null) {
          return String(a.sharedTextR3 || "").trim();
        }
      
        // Last fallback (older shapes you experimented with)
        return String(a?.fields?.["Shared_RollUp_Rotation 3"] || "").trim();
      },
      
      assignmentScopeText(a) {
        if (!a) return "";
      
        // Preferred: scopeText already includes Airtable line breaks
        if (a.scopeText != null) {
          return String(a.scopeText || "").trim();
        }
      
        // Last fallback (older shapes)
        return String(a?.fields?.["Scope"] || "").trim();
      },

      // -----------------------------
      // ✅ Book List: hide empty items in published view
      // -----------------------------

      hasStudentsAssigned(a) {
        if (!a) return false;
      
        // Adjust the field name if yours is different
        const list =
          a.studentIds ||
          a.students ||
          a.assignedStudents ||
          [];
      
        return Array.isArray(list) && list.length > 0;
      },
      
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
