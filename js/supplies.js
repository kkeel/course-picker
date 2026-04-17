// ✅ Supply List data bootstrapping (temporary duplicated Book List logic)
(() => {
  const originalCoursePlanner = window.coursePlanner;

  // If app.js didn't load for some reason, don't crash.
  if (typeof originalCoursePlanner !== "function") return;

  const SUPPLIES_URL = "data/MA_Supplies.json";
  const SUPPLIES_COURSES_URL = "data/MA_Supplies_Courses.json";

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }

  function mergeCoursesBySubject(baseGroups, extraGroups) {
    const merged = { ...(baseGroups || {}) };

    Object.entries(extraGroups || {}).forEach(([subject, extraCourses]) => {
      const existing = Array.isArray(merged[subject]) ? merged[subject] : [];
      const extras = Array.isArray(extraCourses) ? extraCourses : [];

      const existingIds = new Set(
        existing.map(c => String(c?.id || c?.courseId || c?.recordID || "").trim()).filter(Boolean)
      );

      const dedupedExtras = extras.filter(c => {
        const id = String(c?.id || c?.courseId || c?.recordID || "").trim();
        if (!id) return true;
        if (existingIds.has(id)) return false;
        existingIds.add(id);
        return true;
      });

      merged[subject] = [...existing, ...dedupedExtras];
    });

    return merged;
  }

  function buildSubjectOptions(baseOptions, allCoursesBySubject) {
    const preferredFirst = ["Basic Supplies"];
    const ordered = [];
    const seen = new Set();

    preferredFirst.forEach(subject => {
      const name = String(subject || "").trim();
      if (!name || seen.has(name)) return;
      if (!(name in (allCoursesBySubject || {}))) return;
      seen.add(name);
      ordered.push(name);
    });

    (Array.isArray(baseOptions) ? baseOptions : []).forEach(subject => {
      const name = String(subject || "").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      ordered.push(name);
    });

    Object.keys(allCoursesBySubject || {}).forEach(subject => {
      const name = String(subject || "").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      ordered.push(name);
    });

    return ordered;
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

    function normalizeSupplyTargetName(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)
      .join(" ");
  }

  function expandSupplyTargets(value) {
    const input = Array.isArray(value) ? value : [value];
    const out = [];

    for (const item of input) {
      String(item || "")
        .replace(/\r/g, "")
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(v => out.push(v));
    }

    return [...new Set(out)];
  }

  function plannerTargetName(item) {
    if (!item) return "";

    const candidates = [
      item.Topic,
      item.topic,
      item.title,
      item.name,
      item.label,
      item.courseTitle,
      item.courseName,
      item.displayTitle,
      item.recordTitle,
      item.text,
      item.recordID,
      item.id,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeSupplyTargetName(candidate);
      if (normalized) return normalized;
    }

    return "";
  }

  function supplyUsedInText(s) {
    const values = Array.isArray(s?.programList) && s.programList.length
      ? s.programList
      : (Array.isArray(s?.courses) ? s.courses : []);

    const lines = values
      .flatMap(v => String(v || "").replace(/\r/g, "").split("\n"))
      .map(v => v.trim())
      .filter(Boolean);

    return [...new Set(lines)].join("\n");
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

      // ---- Supply List view controls (UI only for now) ----
      mySuppliesOnly: false,
      _hasSetMySuppliesOnly: false,
      
      listViewMode: "full",
      _hasSetListViewMode: false,

      // ---- Supply Priority Tags ----
      supplyPriorityMenuOpen: false,
      supplyPriorityMenuX: 0,
      supplyPriorityMenuY: 0,
      supplyPriorityMenuResourceId: "",
      supplyPriorityMenuInstanceKey: "",

      priorityTagOptions: [
        { id: "upgrade", label: "Upgrade", img: "img/Upgrade.png" },
        { id: "gift",    label: "Gift", img: "img/Gift.png" },
        { id: "low",     label: "Low Priority", img: "img/Low.png" },
        { id: "medium",  label: "Medium Priority", img: "img/Medium.png" },
        { id: "high",    label: "High Priority", img: "img/High.png" },
      ],

      // Global memory by resourceId
      // Example: { "SUP123": ["gift", "high"] }
      _globalSupplyPriorityTagsByResourceId: {},

      // Local applied tags by instance key
      // Example: { "C:Technology:R:SUP123": ["gift"] }
      _supplyPriorityTagsByInstance: {},
      
      toggleMySuppliesOnly() {
        this.mySuppliesOnly = !this.mySuppliesOnly;
        this._hasSetMySuppliesOnly = true;
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

      openSupplyPriorityMenu(evt, resourceId, instanceKey) {
        const rect = evt.currentTarget.getBoundingClientRect();
        const menuWidth = 260;
        const margin = 16;

        let x = rect.right - menuWidth;
        if (x < margin) x = margin;
        if (x + menuWidth > window.innerWidth - margin) {
          x = window.innerWidth - margin - menuWidth;
        }

        let y = rect.bottom + 8;
        const maxY = window.innerHeight - margin - 260;
        if (y > maxY) y = maxY;
        if (y < margin) y = margin;

        this.supplyPriorityMenuX = x;
        this.supplyPriorityMenuY = y;
        this.supplyPriorityMenuResourceId = String(resourceId || "").trim();
        this.supplyPriorityMenuInstanceKey = String(instanceKey || "").trim();
        this.supplyPriorityMenuOpen = true;
      },

      closeSupplyPriorityMenu() {
        this.supplyPriorityMenuOpen = false;
        this.supplyPriorityMenuResourceId = "";
        this.supplyPriorityMenuInstanceKey = "";
      },

      priorityTagLabel(id) {
        const found = (this.priorityTagOptions || []).find(o => o.id === id);
        return found ? found.label : id;
      },

      priorityTagImage(id) {
        const found = (this.priorityTagOptions || []).find(o => o.id === id);
        return found ? found.img : "";
      },

      supplyPriorityTagsForInstance(instanceKey) {
        const key = String(instanceKey || "").trim();
        if (!key) return [];

        const ids = Array.isArray(this._supplyPriorityTagsByInstance?.[key])
          ? this._supplyPriorityTagsByInstance[key]
          : [];

        return ids
          .map(id => {
            const opt = (this.priorityTagOptions || []).find(o => o.id === id);
            return opt ? { id: opt.id, label: opt.label, img: opt.img } : null;
          })
          .filter(Boolean);
      },

      missingGlobalPriorityTagsForSupply(resourceId, instanceKey) {
        const rid = String(resourceId || "").trim();
        const key = String(instanceKey || "").trim();
        if (!rid || !key) return [];

        const globalIds = Array.isArray(this._globalSupplyPriorityTagsByResourceId?.[rid])
          ? this._globalSupplyPriorityTagsByResourceId[rid].map(String)
          : [];

        const localIds = Array.isArray(this._supplyPriorityTagsByInstance?.[key])
          ? this._supplyPriorityTagsByInstance[key].map(String)
          : [];

        const localSet = new Set(localIds);
        return globalIds.filter(id => !localSet.has(id));
      },

      toggleSupplyPriorityTag(resourceId, instanceKey, opt) {
        const rid = String(resourceId || "").trim();
        const key = String(instanceKey || "").trim();
        if (!rid || !key || !opt?.id) return;

        if (!this._supplyPriorityTagsByInstance) this._supplyPriorityTagsByInstance = {};
        if (!this._globalSupplyPriorityTagsByResourceId) this._globalSupplyPriorityTagsByResourceId = {};

        const local = Array.isArray(this._supplyPriorityTagsByInstance[key])
          ? [...this._supplyPriorityTagsByInstance[key]]
          : [];

        const idx = local.indexOf(opt.id);

        if (idx === -1) {
          local.push(opt.id);
        } else {
          local.splice(idx, 1);
        }

        if (local.length) this._supplyPriorityTagsByInstance[key] = local;
        else delete this._supplyPriorityTagsByInstance[key];

        this.recomputeGlobalSupplyPriorityTags(rid);
        this.closeSupplyPriorityMenu();
        this.persistPlannerStateDebounced();
      },

      removeSupplyPriorityTag(resourceId, instanceKey, tagId) {
        const rid = String(resourceId || "").trim();
        const key = String(instanceKey || "").trim();
        const tid = String(tagId || "").trim();
        if (!rid || !key || !tid) return;

        const local = Array.isArray(this._supplyPriorityTagsByInstance?.[key])
          ? this._supplyPriorityTagsByInstance[key].filter(id => String(id) !== tid)
          : [];

        if (local.length) this._supplyPriorityTagsByInstance[key] = local;
        else delete this._supplyPriorityTagsByInstance[key];

        this.recomputeGlobalSupplyPriorityTags(rid);
        this.persistPlannerStateDebounced();
      },

      applyGlobalPriorityTagToSupply(resourceId, instanceKey, tagId) {
        const rid = String(resourceId || "").trim();
        const key = String(instanceKey || "").trim();
        const tid = String(tagId || "").trim();
        if (!rid || !key || !tid) return;

        if (!this._supplyPriorityTagsByInstance) this._supplyPriorityTagsByInstance = {};

        const local = Array.isArray(this._supplyPriorityTagsByInstance[key])
          ? [...this._supplyPriorityTagsByInstance[key]]
          : [];

        if (!local.includes(tid)) local.push(tid);

        this._supplyPriorityTagsByInstance[key] = local;
        this.recomputeGlobalSupplyPriorityTags(rid);
        this.persistPlannerStateDebounced();
      },

      recomputeGlobalSupplyPriorityTags(resourceId) {
        const rid = String(resourceId || "").trim();
        if (!rid) return;

        const union = new Set();
        const all = this._supplyPriorityTagsByInstance || {};

        Object.keys(all).forEach(instanceKey => {
          if (!instanceKey.includes(`R:${rid}`)) return;

          const ids = Array.isArray(all[instanceKey]) ? all[instanceKey] : [];
          ids.map(String).forEach(id => union.add(id));
        });

        if (!this._globalSupplyPriorityTagsByResourceId) {
          this._globalSupplyPriorityTagsByResourceId = {};
        }

        const arr = Array.from(union);
        if (arr.length) this._globalSupplyPriorityTagsByResourceId[rid] = arr;
        else delete this._globalSupplyPriorityTagsByResourceId[rid];
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
        if (!this.mySuppliesOnly) {
          return list.filter(a => String(a?.resourceId || "").trim());
        }
      
        // My Supplies mode:
        // - must be in My Supplies
        // - must be owned here if the supply has owners
        return list.filter(a => {
          const rid = String(a?.resourceId || "").trim();
          if (!rid) return false;
      
          if (!this.isSupplyInMySupplies(rid)) return false;
      
          const owners = (this._mySuppliesOwnersByResourceId?.[String(rid)] || []);
          if (!owners.length) return true; // legacy/unscoped => treat as visible everywhere
      
          const instanceKey = typeof instanceKeyFn === "function" ? instanceKeyFn(rid) : "";
          return !!instanceKey && this.isSupplyOwnedHere(instanceKey);
        });
      },
      
      visibleAssignmentsForCourse(course) {
        const tid = plannerTargetName(course);
        const arr = this.assignmentsByTargetId?.[tid] || [];
        return this._visibleAssignmentsFilter(arr, (rid) =>
          this.mySuppliesInstanceKeyForCourse(tid, rid)
        );
      },
      
      visibleAssignmentsForTopic(course, topic) {
        const cid = plannerTargetName(course);
        const tid = plannerTargetName(topic);

        const arr = this.assignmentsByTargetId?.[tid] || [];
        return this._visibleAssignmentsFilter(arr, (rid) =>
          this.mySuppliesInstanceKeyForTopic(cid, tid, rid)
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
      
        // Merge Supplies-page-only course data into the already-loaded shared tree
        await this.loadSuppliesPageCourseData();
      
        // Then load Supply List data
        await this.loadSuppliesData();
      
        // TEMP TEST: after Alpine has rendered the dynamic links,
        // reload Memberstack once so it can process data-ms-secure-link elements
        setTimeout(() => {
          const existing = document.querySelector('script[data-memberstack-app]');
          if (!existing) return;
      
          const clone = document.createElement("script");
          clone.setAttribute("data-memberstack-app", existing.getAttribute("data-memberstack-app") || "");
          clone.src = existing.src;
          clone.type = "text/javascript";
      
          existing.parentNode.insertBefore(clone, existing.nextSibling);
        }, 1200);
      },

      async loadSuppliesPageCourseData() {
        try {
          const extraJson = await fetchJson(SUPPLIES_COURSES_URL);
          const extraGroups =
            extraJson && typeof extraJson === "object" && !Array.isArray(extraJson)
              ? extraJson
              : {};

          if (!Object.keys(extraGroups).length) return;

          this.allCoursesBySubject = mergeCoursesBySubject(
            this.allCoursesBySubject || {},
            extraGroups
          );

          if (this.allCoursesBySubject["Basic Supplies"]) {
            const reordered = {
              "Basic Supplies": this.allCoursesBySubject["Basic Supplies"],
            };

            Object.keys(this.allCoursesBySubject).forEach(subject => {
              if (subject === "Basic Supplies") return;
              reordered[subject] = this.allCoursesBySubject[subject];
            });

            this.allCoursesBySubject = reordered;
          }

          this.subjectOptions = buildSubjectOptions(
            this.subjectOptions || [],
            this.allCoursesBySubject || {}
          );

          this.applyFilters();
        } catch (e) {
          console.warn("[SuppliesCourses] Failed to load supplies-page course data", e);
        }
      },

      async loadSuppliesData() {
        this.isLoadingBookData = true;
        this.bookDataError = "";

        try {
          const suppliesJson = await fetchJson(SUPPLIES_URL);
          const supplies = Array.isArray(suppliesJson)
            ? suppliesJson
            : (Array.isArray(suppliesJson?.supplies) ? suppliesJson.supplies : []);

          this.suppliesData = supplies;

          const resById = {};
          const pseudoAssignments = [];

          for (const s of supplies) {
            if (!s || s.household) continue;
            if (!s) continue;

            const rid = String(s.supplyId || s.id || "").trim();
            if (!rid) continue;

            const imageUrl =
              normalizeDriveImageUrl(
                s.image ||
                s.imageFile?.[0]?.url ||
                ""
              );

            resById[rid] = {
              resourceId: rid,
              title: String(s.title || "").trim(),
              author: String(s.location || "").trim(),
              authorText: String(s.location || "").trim(),
              locationText: String(s.location || "").trim(),
              isbnAsin: String(s.isbn || "").trim(),
              isbn: String(s.isbn || "").trim(),
              imageViewLink: imageUrl,
              rationale: String(s.rationale || ""),
              rationaleText: String(s.rationale || ""),
              note: String(s.note || "").trim(),
              noteText: String(s.note || "").trim(),
              maySub: String(s.maySub || "").trim(),
              maySubText: String(s.maySub || "").trim(),
              qty: String(s.qty || ""),
              qtyText: String(s.qty || ""),
                            discount: (
                String(s.discount || "").trim() ||
                String(s.discountCode || "").trim() ||
                String(s.discountLink || "").trim()
              ) ? {
                text: String(s.discount || "").trim(),
                code: String(s.discountCode || "").trim(),
                link: String(s.discountLink || "").trim(),
              } : null,
              scopeText: String(s.scope || "").trim(),
              sharedTextR3: String(s.usedInText || "").trim(),
              resourceTagText: "",
              flags: {
                optional: !!s.optional,
                groupSupply: !!s.groupSupply,
                chooseOne: false,
              },
              url1: s.link1 || "",
              url2: s.link2 || "",
              purchaseUrl1: s.link1 || "",
              purchaseUrl2: s.link2 || "",
              links: [
                ...((s.link1 || s.link1MemberstackId) ? [{
                  text: String(s.linkText1 || "Option 1").trim(),
                  url: String(s.link1 || "").trim(),
                  memberOnly: !!s.link1MemberOnly,
                  memberstackId: String(s.link1MemberstackId || "").trim()
                }] : []),
              
                ...((s.link2 || s.link2MemberstackId) ? [{
                  text: String(s.linkText2 || "Option 2").trim(),
                  url: String(s.link2 || "").trim(),
                  memberOnly: !!s.link2MemberOnly,
                  memberstackId: String(s.link2MemberstackId || "").trim()
                }] : []),
              ],
              recordEditLink: String(s.recordEditLink || "").trim(),
              rawSupply: s,
            };

            const targets = expandSupplyTargets(
              Array.isArray(s.programList) && s.programList.length
                ? s.programList
                : s.courses
            );

            const sortKeys = Array.isArray(s.sortId) ? s.sortId : [];

                        targets.forEach((targetName, idx) => {
              const tid = normalizeSupplyTargetName(targetName);

              pseudoAssignments.push({
                assignmentId: `${rid}__${tid}__${idx}`,
              
                targetId: tid,
                resourceId: rid,
              
                resourceKey: String(s.supplyTermSortR3 || idx || ""),
              
                // ✅ needed for sorting
                optional: !!s.optional,
                groupSupply: !!s.groupSupply,
              
                scopeText: String(s.scope || "").trim(),
                sharedTextR3: String(s.usedInText || "").trim(),
                editUrl: "",
              });
            });
          }

          const byTarget = {};
          const byResource = {};

          for (const a of pseudoAssignments) {
            if (!a) continue;

            a.targetId = String(a.targetId || "").trim();
            a.resourceId = String(a.resourceId || "").trim();

            if (!a.targetId || !a.resourceId) continue;

            (byTarget[a.targetId] ||= []).push(a);
            (byResource[a.resourceId] ||= []).push(a);
          }

          for (const tid of Object.keys(byTarget)) {
            byTarget[tid].sort((x, y) => {
          
              // 1️⃣ Optional → bottom
              const xo = !!x.optional;
              const yo = !!y.optional;
              if (xo !== yo) return xo ? 1 : -1;
          
              // 2️⃣ Group Supply → top
              const xg = !!x.groupSupply;
              const yg = !!y.groupSupply;
              if (xg !== yg) return xg ? -1 : 1;
          
              // 3️⃣ Main sort (Supply/Term_Sort(R3))
              const ak = (x.resourceKey || "").toString();
              const bk = (y.resourceKey || "").toString();
              if (ak !== bk) return ak.localeCompare(bk);
          
              // 4️⃣ Stable fallback
              const at = (resById[x.resourceId]?.title || "").toString();
              const bt = (resById[y.resourceId]?.title || "").toString();
              if (at !== bt) return at.localeCompare(bt);
          
              return (x.resourceId || "").localeCompare(y.resourceId || "");
            });
          }

          this.assignmentsData = {
            assignments: pseudoAssignments,
            source: "MA_Supplies.json",
          };

          this.resourcesData = {
            resources: Object.values(resById),
            source: "MA_Supplies.json",
          };

          this.resourcesById = resById;
          this.assignmentsByTargetId = byTarget;
          this.assignmentsByResourceId = byResource;

          console.log(
            "[SuppliesData] Loaded",
            supplies.length,
            "supplies,",
            pseudoAssignments.length,
            "target links"
          );
        } catch (e) {
          console.warn(e);
          this.bookDataError = e?.message || "Failed to load supplies data JSON.";
        } finally {
          this.isLoadingBookData = false;
        }
      },
        
      localCoverPath(resourceId) {
        if (!resourceId) return "img/placeholders/book.svg";
      
        const v = this.resourcesData?.lastUpdated
          ? `?v=${encodeURIComponent(this.resourcesData.lastUpdated)}`
          : "";
      
        return `img/supplies/${resourceId}.webp${v}`;
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

      isGroupSupplyAssignment(a) {
        const rid = a?.resourceId;
        const resourceGroupSupply = !!(this.resourcesById?.[rid]?.flags?.groupSupply);
        const assignmentGroupSupply = !!(a?.groupSupply);
        return assignmentGroupSupply || resourceGroupSupply;
      },

      isChooseOneAssignment(a) {
        const rid = String(a?.resourceId || "").trim();
        if (!rid) return false;
      
        return this.resourcesById?.[rid]?.flags?.chooseOne === true;
      },

      // --------------------------------------------------
      // Supply Preparation: My Supplies (V2 – instance-aware + ghost support)
      // --------------------------------------------------
      
      _mySuppliesResourceIds: new Set(),
      _mySuppliesOwnersByResourceId: {}, // { [resourceId]: string[] instanceKeys }
      _mySuppliesOwnedInstanceKeys: new Set(), // derived cache (owners flattened)

      mySuppliesInstanceKeyForCourse(courseId, resourceId) {
        const c = String(courseId || "").trim();
        const r = String(resourceId || "").trim();
        if (!c || !r) return "";
        return `C:${c}:R:${r}`;
      },

      mySuppliesInstanceKeyForTopic(courseId, topicId, resourceId) {
        const c = String(courseId || "").trim();
        const t = String(topicId || "").trim();
        const r = String(resourceId || "").trim();
        if (!c || !t || !r) return "";
        return `C:${c}:T:${t}:R:${r}`;
      },

      _rebuildMySuppliesOwnedInstanceCache() {
        const map = this._mySuppliesOwnersByResourceId || {};
        const flat = new Set();
        Object.keys(map).forEach(rid => {
          const owners = Array.isArray(map[rid]) ? map[rid] : [];
          owners.forEach(k => { if (k) flat.add(String(k)); });
        });
        this._mySuppliesOwnedInstanceKeys = flat;
      },

      isSupplyInMySupplies(resourceId) {
        if (!resourceId) return false;
        return this._mySuppliesResourceIds.has(String(resourceId));
      },

      isSupplyOwnedHere(instanceKey) {
        if (!instanceKey) return false;
        return this._mySuppliesOwnedInstanceKeys.has(String(instanceKey));
      },

      isSupplyGhostMySupplies(resourceId, instanceKey) {
        if (!resourceId || !instanceKey) return false;
        const rid = String(resourceId);
        if (!this.isSupplyInMySupplies(rid)) return false;

        const owners = (this._mySuppliesOwnersByResourceId && Array.isArray(this._mySuppliesOwnersByResourceId[rid]))
          ? this._mySuppliesOwnersByResourceId[rid]
          : [];

        if (!owners.length) return false;

        return !owners.includes(String(instanceKey));
      },

      applySupplyMySuppliesHere(resourceId, instanceKey) {
        if (!resourceId || !instanceKey) return;

        const rid = String(resourceId);
        const key = String(instanceKey);

        if (!this._mySuppliesResourceIds) this._mySuppliesResourceIds = new Set();
        this._mySuppliesResourceIds.add(rid);

        if (!this._mySuppliesOwnersByResourceId) this._mySuppliesOwnersByResourceId = {};
        const owners = Array.isArray(this._mySuppliesOwnersByResourceId[rid]) ? this._mySuppliesOwnersByResourceId[rid] : [];
        if (!owners.includes(key)) owners.push(key);
        this._mySuppliesOwnersByResourceId[rid] = owners;

        this._rebuildMySuppliesOwnedInstanceCache();
        this.persistPlannerStateDebounced();
      },

      ensureMySuppliesOwnedForPrep(resourceId, instanceKey) {
        if (!resourceId) return;

        const rid = String(resourceId);
        const key = String(instanceKey || "");

        if (key) {
          if (this.isSupplyGhostMySupplies(rid, key)) {
            this.applySupplyMySuppliesHere(rid, key);
          } else if (!this.isSupplyInMySupplies(rid)) {
            this.toggleSupplyMySupplies(rid, key);
          } else if (!this.isSupplyOwnedHere(key) && ((this._mySuppliesOwnersByResourceId?.[rid] || []).length)) {
            this.applySupplyMySuppliesHere(rid, key);
          }
        } else {
          if (!this.isSupplyInMySupplies(rid)) this.toggleSupplyMySupplies(rid);
        }

        if (!this._prepOpenByResourceId) this._prepOpenByResourceId = {};
        this._prepOpenByResourceId[rid] = true;

        const existing = this.getPrepOptions(rid);
        if (!existing.length) {
          this.addPrepOption(rid);
        } else {
          this.persistPlannerStateDebounced();
        }
      },

      toggleSupplyMySupplies(resourceId, instanceKey = "") {
        if (!resourceId) return;
        const rid = String(resourceId);
        const key = String(instanceKey || "");

        if (!key) {
          if (this._mySuppliesResourceIds.has(rid)) {
            this._mySuppliesResourceIds.delete(rid);
            if (this._mySuppliesOwnersByResourceId) delete this._mySuppliesOwnersByResourceId[rid];
            this._rebuildMySuppliesOwnedInstanceCache();
          } else {
            this._mySuppliesResourceIds.add(rid);
          }
          this.persistPlannerStateDebounced();
          return;
        }

        if (!this._mySuppliesOwnersByResourceId) this._mySuppliesOwnersByResourceId = {};
        const owners = Array.isArray(this._mySuppliesOwnersByResourceId[rid]) ? this._mySuppliesOwnersByResourceId[rid] : [];

        if (!this._mySuppliesResourceIds.has(rid)) {
          this._mySuppliesResourceIds.add(rid);
          this._mySuppliesOwnersByResourceId[rid] = [key];
          this._rebuildMySuppliesOwnedInstanceCache();
          this.persistPlannerStateDebounced();
          return;
        }

        if (!owners.length) {
          this._mySuppliesOwnersByResourceId[rid] = [key];
          this._rebuildMySuppliesOwnedInstanceCache();
          this.persistPlannerStateDebounced();
          return;
        }

        const nextOwners = owners.filter(k => String(k) !== key);
        if (nextOwners.length === owners.length) {
          nextOwners.push(key);
        }

        if (!nextOwners.length) {
          delete this._mySuppliesOwnersByResourceId[rid];
          this._mySuppliesResourceIds.delete(rid);
        } else {
          this._mySuppliesOwnersByResourceId[rid] = nextOwners;
        }

        this._rebuildMySuppliesOwnedInstanceCache();
        this.persistPlannerStateDebounced();
      },

      collectPlannerExtras() {
        const extras = {
          supplies: {
            mySupplies: Array.from(this._mySuppliesResourceIds || []),
            mySuppliesOwnersByResourceId: this._mySuppliesOwnersByResourceId || {},
            prepOpenByResourceId: this._prepOpenByResourceId || {},
            optionsByResourceId: this._optionsByResourceId || {},

            globalSupplyPriorityTagsByResourceId: this._globalSupplyPriorityTagsByResourceId || {},
            supplyPriorityTagsByInstance: this._supplyPriorityTagsByInstance || {},
          }
        };

        if (this._hasSetMySuppliesOnly || this._hasSetListViewMode) {
          extras.supplies.view = {};

          if (this._hasSetMySuppliesOnly) extras.supplies.view.mySuppliesOnly = !!this.mySuppliesOnly;
          if (this._hasSetListViewMode) extras.supplies.view.listViewMode = this.listViewMode;
        }

        return extras;
      },
      
      applyPlannerExtras(extras) {
        const r = extras?.supplies;
        if (!r) return;

        const ids = Array.isArray(r.mySupplies) ? r.mySupplies : [];
        this._mySuppliesResourceIds = new Set(ids.map(String));

        const owners = (r.mySuppliesOwnersByResourceId && typeof r.mySuppliesOwnersByResourceId === "object")
          ? r.mySuppliesOwnersByResourceId
          : {};
        this._mySuppliesOwnersByResourceId = { ...owners };

        const prepOpen = (r.prepOpenByResourceId && typeof r.prepOpenByResourceId === "object")
          ? r.prepOpenByResourceId
          : {};
        this._prepOpenByResourceId = { ...prepOpen };

        const opts = (r.optionsByResourceId && typeof r.optionsByResourceId === "object")
          ? r.optionsByResourceId
          : {};
        this._optionsByResourceId = { ...opts };

        const globalPriority = (r.globalSupplyPriorityTagsByResourceId && typeof r.globalSupplyPriorityTagsByResourceId === "object")
          ? r.globalSupplyPriorityTagsByResourceId
          : {};
        this._globalSupplyPriorityTagsByResourceId = { ...globalPriority };

        const localPriority = (r.supplyPriorityTagsByInstance && typeof r.supplyPriorityTagsByInstance === "object")
          ? r.supplyPriorityTagsByInstance
          : {};
        this._supplyPriorityTagsByInstance = { ...localPriority };

        if (typeof this._rebuildMySuppliesOwnedInstanceCache === "function") {
          this._rebuildMySuppliesOwnedInstanceCache();
        }

        const view = (r.view && typeof r.view === "object") ? r.view : null;
        if (view) {
          if (typeof view.mySuppliesOnly === "boolean") {
            this.mySuppliesOnly = view.mySuppliesOnly;
            this._hasSetMySuppliesOnly = true;
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

      normalizeSupplyPrepKind(kind, mode = "") {
        const k = String(kind || "").toLowerCase().trim();
        const m = String(mode || "").toLowerCase().trim();

        if (k === "supply" || k === "digital" || k === "printable") return k;

        if (k === "physical") {
          if (m === "print") return "printable";
          return "supply";
        }

        return "supply";
      },

      normalizeSupplyPrepMode(mode, kind = "supply") {
        const m = String(mode || "").toLowerCase().trim();
        const k = this.normalizeSupplyPrepKind(kind, mode);

        const allowed = new Set([
          "save",
          "print",
          "purchase",
          "own",
          "gather",
          "prepare"
        ]);
        if (allowed.has(m)) return m;

        if (m === "library") return "own";
        if (m === "ebook" || m === "audiobook" || m === "video") return "save";

        return k === "digital" ? "save" : "purchase";
      },

      normalizeSupplyPrepStatus(status) {
        const s = String(status || "").toLowerCase().trim();

        if (s === "not_ready") return "not_ready";
        if (s === "ordered") return "ordered";
        if (s === "in_progress") return "in_progress";
        if (s === "received") return "received";
        if (s === "ready") return "ready";

        if (s === "requested") return "in_progress";

        return "not_ready";
      },
      
      getPrepOptions(resourceId) {
        const id = String(resourceId || "");
        const map = this._optionsByResourceId || {};
        const arr = map[id];

        if (!Array.isArray(arr)) return [];

        return arr.map(opt => {
          const kind = this.normalizeSupplyPrepKind(opt?.kind, opt?.mode);
          return {
            ...opt,
            kind,
            mode: this.normalizeSupplyPrepMode(opt?.mode, kind),
            status: this.normalizeSupplyPrepStatus(opt?.status),
          };
        });
      },
      
      addPrepOption(resourceId, kind = "supply", mode = "purchase", status = "not_ready") {
        const id = String(resourceId || "").trim();
        if (!id) return;
      
        // ✅ If user adds a prep option, automatically add the resource to My Books
        if (!this._mySuppliesResourceIds) this._mySuppliesResourceIds = new Set();
        if (!this._mySuppliesResourceIds.has(id)) {
          this._mySuppliesResourceIds.add(id);
        }
      
        // Keep the prep section open when adding
        if (!this._prepOpenByResourceId) this._prepOpenByResourceId = {};
        this._prepOpenByResourceId[id] = true;
      
        if (!this._optionsByResourceId) this._optionsByResourceId = {};
        if (!Array.isArray(this._optionsByResourceId[id])) this._optionsByResourceId[id] = [];
      
        const normalizedKind = this.normalizeSupplyPrepKind(kind, mode);

        this._optionsByResourceId[id].push({
          kind: normalizedKind,
          mode: this.normalizeSupplyPrepMode(mode, normalizedKind),
          status: this.normalizeSupplyPrepStatus(status)
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
      
        const next = { ...arr[index], ...(patch || {}) };
        const normalizedKind = this.normalizeSupplyPrepKind(next.kind, next.mode);

        arr[index] = {
          ...next,
          kind: normalizedKind,
          mode: this.normalizeSupplyPrepMode(next.mode, normalizedKind),
          status: this.normalizeSupplyPrepStatus(next.status),
        };
        this._optionsByResourceId[id] = arr;
      
        this.persistPlannerStateDebounced();
      },

// Prep status -> color for the small leading dot
prepStatusColor(status) {
  const s = this.normalizeSupplyPrepStatus(status);

  const map = {
    not_ready:  "#a0a6be",
    ordered:    "#d1b358",
    in_progress:"#c07669",
    received:   "#7F3A82",
    ready:      "#6db4b2"
  };

  return map[s] || map.not_ready;
},


      openPrepOptionsModal(resourceId, subject) {
        const id = String(resourceId || "");
        if (!id) return;
      
        // Only allow if in My Books (keeps UI logic consistent)
        if (!this.isSupplyInMySupplies(id)) return;
      
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

      qtyStartsOnNewLine(resourceId) {
        const rid = String(resourceId || "").trim();
        if (!rid) return false;

        const raw = String(
          this.resourcesById?.[rid]?.qty ??
          this.resourcesById?.[rid]?.qtyText ??
          ""
        ).replace(/\r/g, "");

        return /^[\t ]*\n/.test(raw);
      },

      formattedQtyText(resourceId) {
        const rid = String(resourceId || "").trim();
        if (!rid) return "";

        let raw = String(
          this.resourcesById?.[rid]?.qty ??
          this.resourcesById?.[rid]?.qtyText ??
          ""
        ).replace(/\r/g, "");

        // If Airtable starts the field with a blank line, use that
        // to switch to stacked layout, but remove the leading blank
        // line itself so it does not create an oversized gap.
        if (/^[\t ]*\n/.test(raw)) {
          raw = raw.replace(/^[\t ]*\n+/, "");
        }

        // Remove only trailing blank lines/spaces.
        raw = raw.replace(/\n+[\t ]*$/, "").trimEnd();

        return raw;
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
      // ✅ Supply List: hide empty items in published view
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
        return plannerTargetName(item);
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
          return this.mySuppliesOnly
            ? this._hasVisibleAssignmentsForTopic(course, t)
            : this._bookHasAssignments(t);
        });
      },

      // Override: subject -> courses map used by the Supply List template
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
            const courseHas = this.mySuppliesOnly
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
