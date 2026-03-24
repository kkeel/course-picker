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

      // ---- Book List view controls (UI only for now) ----
      myBooksOnly: false,
      _hasSetMyBooksOnly: false,
      
      listViewMode: "full",
      _hasSetListViewMode: false,
      
      toggleMyBooksOnly() {
        this.myBooksOnly = !this.myBooksOnly;
        this._hasSetMyBooksOnly = true;
        if (typeof this.persistPlannerStateDebounced === "function") {
          this.persistPlannerStateDebounced();
        }
      },
      
      setListViewMode(mode) {
        const v = (mode === "full" || mode === "compact" || mode === "minimal") ? mode : "full";
        this.listViewMode = v;
        this._hasSetListViewMode = true;
        if (typeof this.persistPlannerStateDebounced === "function") {
          this.persistPlannerStateDebounced();
        }
      },

      listViewModeClass() {
        const v = (this.listViewMode === "compact" || this.listViewMode === "minimal" || this.listViewMode === "full")
          ? this.listViewMode
          : "full";
        return `listview-${v}`;
      },
      
      _visibleAssignmentsFilter(arr, instanceKeyFn) {
        const list = Array.isArray(arr) ? arr : [];
      
        // Normal mode = show all assignments (current behavior)
        if (!this.myBooksOnly) {
          return list.filter(a => String(a?.resourceId || "").trim());
        }
      
        // My Books mode:
        // - must be in My Books
        // - must be owned here if the resource has owners
        return list.filter(a => {
          const rid = String(a?.resourceId || "").trim();
          if (!rid) return false;
      
          if (!this.isResourceInMyBooks(rid)) return false;
      
          const owners = (this._myBooksOwnersByResourceId?.[String(rid)] || []);
          if (!owners.length) return true; // legacy/unscoped => treat as visible everywhere
      
          const instanceKey = typeof instanceKeyFn === "function" ? instanceKeyFn(rid) : "";
          return !!instanceKey && this.isResourceOwnedHere(instanceKey);
        });
      },
      
      visibleAssignmentsForCourse(course) {
        const courseId = (course?.recordID || course?.id);
        const tid = String(courseId || "");
        const arr = this.assignmentsByTargetId?.[tid] || [];
        return this._visibleAssignmentsFilter(arr, (rid) =>
          this.myBooksInstanceKeyForCourse(tid, rid)
        );
      },
      
      visibleAssignmentsForTopic(course, topic) {
        const courseId = (course?.recordID || course?.id);
        const topicId  = (topic?.recordID || topic?.id);
      
        const cid = String(courseId || "");
        const tid = String(topicId  || "");
      
        const arr = this.assignmentsByTargetId?.[tid] || [];
        return this._visibleAssignmentsFilter(arr, (rid) =>
          this.myBooksInstanceKeyForTopic(cid, tid, rid)
        );
      },
      
      _hasVisibleAssignmentsForCourse(course) {
        return this.visibleAssignmentsForCourse(course).length > 0;
      },
      
      _hasVisibleAssignmentsForTopic(course, topic) {
        return this.visibleAssignmentsForTopic(course, topic).length > 0;
      },

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
      // Resource Preparation: My Books (V2 – instance-aware + ghost support)
      //
      // Global: resourceId is "in My Books somewhere"
      // Instance:
      //   - Course-level: C:<courseId>:R:<resourceId>
      //   - Topic-level : C:<courseId>:T:<topicId>:R:<resourceId>
      //
      // Notes:
      // - We keep _myBooksResourceIds for fast global checks.
      // - We store instance owners in _myBooksOwnersByResourceId.
      // - Legacy saves that only have myBooks[] will behave like "unscoped" (solid everywhere)
      //   until the user interacts, at which point we begin tracking per-instance owners.
      // --------------------------------------------------
      
      _myBooksResourceIds: new Set(),
      _myBooksOwnersByResourceId: {}, // { [resourceId]: string[] instanceKeys }
      _myBooksOwnedInstanceKeys: new Set(), // derived cache (owners flattened)

      myBooksInstanceKeyForCourse(courseId, resourceId) {
        const c = String(courseId || "").trim();
        const r = String(resourceId || "").trim();
        if (!c || !r) return "";
        return `C:${c}:R:${r}`;
      },

      myBooksInstanceKeyForTopic(courseId, topicId, resourceId) {
        const c = String(courseId || "").trim();
        const t = String(topicId || "").trim();
        const r = String(resourceId || "").trim();
        if (!c || !t || !r) return "";
        return `C:${c}:T:${t}:R:${r}`;
      },

      _rebuildMyBooksOwnedInstanceCache() {
        const map = this._myBooksOwnersByResourceId || {};
        const flat = new Set();
        Object.keys(map).forEach(rid => {
          const owners = Array.isArray(map[rid]) ? map[rid] : [];
          owners.forEach(k => { if (k) flat.add(String(k)); });
        });
        this._myBooksOwnedInstanceKeys = flat;
      },

      isResourceInMyBooks(resourceId) {
        if (!resourceId) return false;
        return this._myBooksResourceIds.has(String(resourceId));
      },

      isResourceOwnedHere(instanceKey) {
        if (!instanceKey) return false;
        return this._myBooksOwnedInstanceKeys.has(String(instanceKey));
      },

      // "Ghost" means: globally in My Books, AND we have scoped owners for this resource,
      // but this specific instanceKey is NOT one of them.
      isResourceGhostMyBooks(resourceId, instanceKey) {
        if (!resourceId || !instanceKey) return false;
        const rid = String(resourceId);
        if (!this.isResourceInMyBooks(rid)) return false;

        const owners = (this._myBooksOwnersByResourceId && Array.isArray(this._myBooksOwnersByResourceId[rid]))
          ? this._myBooksOwnersByResourceId[rid]
          : [];

        // Legacy/unscoped: treat as not-ghost anywhere
        if (!owners.length) return false;

        return !owners.includes(String(instanceKey));
      },

      // Apply a global ("ghost") resource to THIS specific instance (adds an owner)
      applyResourceMyBooksHere(resourceId, instanceKey) {
        if (!resourceId || !instanceKey) return;

        const rid = String(resourceId);
        const key = String(instanceKey);

        // Ensure global
        if (!this._myBooksResourceIds) this._myBooksResourceIds = new Set();
        this._myBooksResourceIds.add(rid);

        // Ensure owners map
        if (!this._myBooksOwnersByResourceId) this._myBooksOwnersByResourceId = {};
        const owners = Array.isArray(this._myBooksOwnersByResourceId[rid]) ? this._myBooksOwnersByResourceId[rid] : [];
        if (!owners.includes(key)) owners.push(key);
        this._myBooksOwnersByResourceId[rid] = owners;

        // Update flattened cache
        this._rebuildMyBooksOwnedInstanceCache();

        // ✅ persist (same mechanism as bookmarks/students/tags)
        this.persistPlannerStateDebounced();
      },

      // For ghost/empty prep "+ Add": ensure this instance becomes OWNED,
      // force the prep section open, and only add the first prep line if none exist yet.
      ensureMyBooksOwnedForPrep(resourceId, instanceKey) {
        if (!resourceId) return;

        const rid = String(resourceId);
        const key = String(instanceKey || "");

        // 1) Ensure OWNERSHIP for this instance
        if (key) {
          // Ghost -> owned
          if (this.isResourceGhostMyBooks(rid, key)) {
            this.applyResourceMyBooksHere(rid, key);
          }
          // Empty -> owned (instance-aware add)
          else if (!this.isResourceInMyBooks(rid)) {
            this.toggleResourceMyBooks(rid, key);
          }
          // Global exists but not owned here (extra safety)
          else if (!this.isResourceOwnedHere(key) && ((this._myBooksOwnersByResourceId?.[rid] || []).length)) {
            this.applyResourceMyBooksHere(rid, key);
          }
          // Legacy/unscoped (owners empty): do nothing here; it behaves "owned everywhere"
        } else {
          // Fallback: legacy global add
          if (!this.isResourceInMyBooks(rid)) this.toggleResourceMyBooks(rid);
        }

        // 2) Force prep open
        if (!this._prepOpenByResourceId) this._prepOpenByResourceId = {};
        this._prepOpenByResourceId[rid] = true;

        // 3) If there are no prep lines yet, create the first line (old behavior)
        const existing = this.getPrepOptions(rid);
        if (!existing.length) {
          this.addPrepOption(rid); // adds one default row
        } else {
          // Still persist the "open" state + ownership change
          this.persistPlannerStateDebounced();
        }
      },

      // Toggle "My Books" for THIS instance.
      // If instanceKey isn't provided, this behaves like the legacy global toggle.
      toggleResourceMyBooks(resourceId, instanceKey = "") {
        if (!resourceId) return;
        const rid = String(resourceId);
        const key = String(instanceKey || "");

        // Legacy/global toggle (no instance info)
        if (!key) {
          if (this._myBooksResourceIds.has(rid)) {
            this._myBooksResourceIds.delete(rid);
            if (this._myBooksOwnersByResourceId) delete this._myBooksOwnersByResourceId[rid];
            this._rebuildMyBooksOwnedInstanceCache();
          } else {
            this._myBooksResourceIds.add(rid);
          }
          this.persistPlannerStateDebounced();
          return;
        }

        // Instance-aware toggle
        if (!this._myBooksOwnersByResourceId) this._myBooksOwnersByResourceId = {};
        const owners = Array.isArray(this._myBooksOwnersByResourceId[rid]) ? this._myBooksOwnersByResourceId[rid] : [];

        // If resource isn't in My Books yet, add and scope ownership to THIS instance immediately
        if (!this._myBooksResourceIds.has(rid)) {
          this._myBooksResourceIds.add(rid);
          this._myBooksOwnersByResourceId[rid] = [key];
          this._rebuildMyBooksOwnedInstanceCache();
          this.persistPlannerStateDebounced();
          return;
        }

        // If unscoped legacy (no owners), start scoping by making THIS instance the first owner
        if (!owners.length) {
          this._myBooksOwnersByResourceId[rid] = [key];
          this._rebuildMyBooksOwnedInstanceCache();
          this.persistPlannerStateDebounced();
          return;
        }

        // Scoped: toggle this key within owners
        const nextOwners = owners.filter(k => String(k) !== key);
        if (nextOwners.length === owners.length) {
          nextOwners.push(key); // wasn't present → add
        }

        if (!nextOwners.length) {
          // No owners left → remove global membership too
          delete this._myBooksOwnersByResourceId[rid];
          this._myBooksResourceIds.delete(rid);
        } else {
          this._myBooksOwnersByResourceId[rid] = nextOwners;
        }

        this._rebuildMyBooksOwnedInstanceCache();

        // ✅ persist
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
        const id = String(resourceId || "").trim();
        if (!id) return;
      
        // ✅ If user adds a prep option, automatically add the resource to My Books
        if (!this._myBooksResourceIds) this._myBooksResourceIds = new Set();
        if (!this._myBooksResourceIds.has(id)) {
          this._myBooksResourceIds.add(id);
        }
      
        // Keep the prep section open when adding
        if (!this._prepOpenByResourceId) this._prepOpenByResourceId = {};
        this._prepOpenByResourceId[id] = true;
      
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

// Prep status -> color for the small leading dot
prepStatusColor(status) {
  const s = String(status || "").toLowerCase().trim();

  // Subtle, brand-safe colors (avoid fighting subject chips)
  const map = {
    not_ready: "#b7bdb8",  // neutral soft grey
    ordered:   "#c2a84a",  // warm muted gold
    requested: "#7A5CCB",  // purple
    received:  "#2F78C4",  // distinct blue
    ready:     "#4f8f6f"   // confident green
  };

  return map[s] || map.not_ready;
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

      collectPlannerExtras() {
        const extras = {
          resources: {
            myBooks: Array.from(this._myBooksResourceIds || []),

            // ✅ NEW: instance owners for ghost behavior
            myBooksOwnersByResourceId: this._myBooksOwnersByResourceId || {},

            prepOpenByResourceId: this._prepOpenByResourceId || {},
            optionsByResourceId: this._optionsByResourceId || {},
          }
        };

        // Persist view settings ONLY after the user explicitly changes them
        if (this._hasSetMyBooksOnly || this._hasSetListViewMode) {
          extras.resources.view = {};

          if (this._hasSetMyBooksOnly) extras.resources.view.myBooksOnly = !!this.myBooksOnly;
          if (this._hasSetListViewMode) extras.resources.view.listViewMode = this.listViewMode;
        }

        return extras;
      },
      
      applyPlannerExtras(extras) {
        const r = extras?.resources;
        if (!r) return;
      
        // Restore My Books (global)
        const ids = Array.isArray(r.myBooks) ? r.myBooks : [];
        this._myBooksResourceIds = new Set(ids.map(String));
      
        // ✅ Restore instance owners (if present; otherwise legacy/unscoped)
        const owners = (r.myBooksOwnersByResourceId && typeof r.myBooksOwnersByResourceId === "object")
          ? r.myBooksOwnersByResourceId
          : {};
        this._myBooksOwnersByResourceId = { ...owners };
      
        // ✅ Restore prep tracking open/closed state
        const prepOpen = (r.prepOpenByResourceId && typeof r.prepOpenByResourceId === "object")
          ? r.prepOpenByResourceId
          : {};
        this._prepOpenByResourceId = { ...prepOpen };
      
        // ✅ Restore prep tracking option rows (physical/digital, acquisition, status, etc.)
        const opts = (r.optionsByResourceId && typeof r.optionsByResourceId === "object")
          ? r.optionsByResourceId
          : {};
        this._optionsByResourceId = { ...opts };
      
        // Rebuild flattened cache used by ghost checks
        if (typeof this._rebuildMyBooksOwnedInstanceCache === "function") {
          this._rebuildMyBooksOwnedInstanceCache();
        }
      
        // Restore view settings (only if they were ever saved)
        const view = (r.view && typeof r.view === "object") ? r.view : null;
        if (view) {
          if (typeof view.myBooksOnly === "boolean") {
            this.myBooksOnly = view.myBooksOnly;
            this._hasSetMyBooksOnly = true;
          }
          if (typeof view.listViewMode === "string") {
            const v = (view.listViewMode === "full" || view.listViewMode === "compact" || view.listViewMode === "minimal")
              ? view.listViewMode
              : "full";
            this.listViewMode = v;
            this._hasSetListViewMode = true;
          }
        }
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
        return topics.filter(t => {
          return this.myBooksOnly
            ? this._hasVisibleAssignmentsForTopic(course, t)
            : this._bookHasAssignments(t);
        });
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
            const courseHas = this.myBooksOnly
              ? this._hasVisibleAssignmentsForCourse(course)
              : this._bookHasAssignments(course);

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
