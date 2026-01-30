// schedule.js
// Schedule page UI state (Student View / "track") + persistence
// + Phase 2.5: Card templates + instances + ordered placements + rail + grade-band choice (Picture Study)
(function () {
  // -----------------------------
  // Storage keys
  // -----------------------------
  const UI_STORAGE_KEY = "alveary_schedule_ui_v1";
  const CARDS_STORAGE_KEY = "alveary_schedule_cards_v1";

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function loadKey(key) {
    const raw = localStorage.getItem(key);
    return raw ? safeParse(raw) : null;
  }

  function saveKey(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }

  // -----------------------------
  // UI state (existing)
  // -----------------------------
  function defaultUiState() {
    return {
      view: "track",
      visibleDays: [0, 1, 2, 3, 4],
      panels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" },
      ],
    };
  }

  function normalizeUiState(state, allStudentIds) {
    const d = defaultUiState();

    const view = typeof state?.view === "string" ? state.view : d.view;

    let visibleDays = Array.isArray(state?.visibleDays)
      ? state.visibleDays.slice()
      : d.visibleDays.slice();

    visibleDays = visibleDays
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 4);

    if (!visibleDays.length) visibleDays = d.visibleDays.slice();
    visibleDays = Array.from(new Set(visibleDays)).sort((a, b) => a - b);

    let panels = Array.isArray(state?.panels) ? state.panels.slice() : d.panels.slice();

    panels = panels
      .map((p, idx) => {
        const slot = p?.slot || (idx === 1 ? "P2" : "P1");
        let studentId = p?.studentId || (slot === "P2" ? "S2" : "S1");

        if (Array.isArray(allStudentIds) && allStudentIds.length) {
          if (!allStudentIds.includes(studentId)) {
            studentId = slot === "P2"
              ? (allStudentIds[1] || allStudentIds[0])
              : allStudentIds[0];
          }
        }

        return { slot, studentId };
      })
      .slice(0, 2);

    if (panels.length < 2) panels = d.panels.slice();

    if (panels[0].studentId === panels[1].studentId) {
      const fallback = panels[0].studentId === "S1" ? "S2" : "S1";
      panels[1].studentId = fallback;
    }

    return { view, visibleDays, panels };
  }

  // -----------------------------
  // Cards state (Phase 2.5)
  // -----------------------------
  function defaultCardsState() {
    return {
      // template catalog (official sample + user custom templates)
      templatesById: {},
      // ordered placement per student/day: placements[studentId][dayIndex] = [instanceId...]
      placements: {},
      // all instances by id: instanceId -> { instanceId, templateId, createdAt }
      instancesById: {},
      // preferences/choices that affect which templates are active
      choices: {
        // per-course option selections (scales to multiple “banded” courses)
        courseOptions: {
          "picture-study": "g1-3",
        },
      },
    };
  }

  function uid(prefix = "i") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function ensureStudentPlacements(cardsState, studentId) {
    if (!cardsState.placements[studentId]) {
      cardsState.placements[studentId] = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    } else {
      // ensure all days exist
      for (let d = 0; d <= 4; d++) {
        if (!Array.isArray(cardsState.placements[studentId][d])) cardsState.placements[studentId][d] = [];
      }
    }
  }

  // Sample catalog that demonstrates complexity:
  // - multi-rule course (Grammar has two rules)
  // - shared topic duplicates (Church History for Bible G1 vs Bible G2)
  // - grade-band choice (Picture Study)
  function buildSampleTemplates() {
    const t = {};

    // Sort keys: mimic your Course List order keys (string compare works if zero-padded)
    // (These are placeholders; later we’ll pull real sort keys from course JSON.)
    t["a:grammar:ruleA"] = {
      id: "a:grammar:ruleA",
      sortKey: "004.001.010.000::10", // placeholder
      courseKey: "grammar",
      courseLabel: "Grammar",
      variantKey: "20m",
      variantSort: 10,
      title: "Grammar: Grade 5",
      minutes: 20,
      symbols: "* 🅃",
      trackingCount: 12,
      weeklyTarget: 2,
    };

    t["a:grammar:ruleB"] = {
      id: "a:grammar:ruleB",
      sortKey: "004.001.010.000::20",
      courseKey: "grammar",
      courseLabel: "Grammar",
      variantKey: "15m",
      variantSort: 20,
      title: "Grammar: Grade 5",
      minutes: 15,
      symbols: "* 🅃",
      trackingCount: 12,
      weeklyTarget: 3,
    };

    // Shared topic duplicates (two separate instances / contexts)
    t["a:church-history:bible-g1"] = {
      id: "a:church-history:bible-g1",
      sortKey: "004.001.020.000::10",
      courseKey: "bible-g1",
      courseLabel: "Bible: Grade 1",
      variantKey: "church-history",
      variantSort: 10,
      title: "Church History: Grade 1",
      minutes: 20,
      symbols: "↔ * 🅃",
      trackingCount: 12,
      weeklyTarget: 1,
    };

    t["a:church-history:bible-g2"] = {
      id: "a:church-history:bible-g2",
      sortKey: "004.001.021.000::10",
      courseKey: "bible-g2",
      courseLabel: "Bible: Grade 2",
      variantKey: "church-history",
      variantSort: 10,
      title: "Church History: Grade 2",
      minutes: 20,
      symbols: "↔ * 🅃",
      trackingCount: 12,
      weeklyTarget: 1,
    };

    // Break / buffer card (no course source)
    t["a:break:lunch"] = {
      id: "a:break:lunch",
      sortKey: "ZZZ::01",
      courseKey: "break",
      courseLabel: "Breaks",
      variantKey: "lunch",
      variantSort: 1,
      title: "Lunch",
      minutes: 30,
      symbols: "☼",
      trackingCount: 0,
      weeklyTarget: 5,
    };

    // Picture Study grade-band options (choice controls which one is shown as “active”)
    t["a:picture-study:g1-3"] = {
      id: "a:picture-study:g1-3",
      sortKey: "004.001.030.000::10",
      courseKey: "picture-study",
      courseLabel: "Picture Study",
      variantKey: "g1-3",
      variantSort: 10,
      title: "Picture Study: Grades 1–3",
      minutes: 10,
      symbols: "↔ * 🅃",
      trackingCount: 12,
      weeklyTarget: 1,
      meta: {
        choiceGroup: "gradeBand",
        option: "g1-3",
        optionLabel: "1–3",
      },
    };

    t["a:picture-study:g4-6"] = {
      id: "a:picture-study:g4-6",
      sortKey: "004.001.030.000::20",
      courseKey: "picture-study",
      courseLabel: "Picture Study",
      variantKey: "g4-6",
      variantSort: 20,
      title: "Picture Study: Grades 4–6",
      minutes: 15,
      symbols: "↔ * 🅃-",
      trackingCount: 12,
      weeklyTarget: 1,
      meta: {
        choiceGroup: "gradeBand",
        option: "g4-6",
        optionLabel: "4–6",
      },
    };

    t["a:picture-study:g7-8"] = {
      id: "a:picture-study:g7-8",
      sortKey: "004.001.030.000::30",
      courseKey: "picture-study",
      courseLabel: "Picture Study",
      variantKey: "g7-8",
      variantSort: 30,
      title: "Picture Study: Grades 7–8",
      minutes: 20,
      symbols: "↔ * 🅃--",
      trackingCount: 12,
      weeklyTarget: 1,
      meta: {
        choiceGroup: "gradeBand",
        option: "g7-8",
        optionLabel: "7–8",
      },
    };

    t["a:picture-study:g9-12"] = {
      id: "a:picture-study:g9-12",
      sortKey: "004.001.030.000::40",
      courseKey: "picture-study",
      courseLabel: "Picture Study",
      variantKey: "g9-12",
      variantSort: 40,
      title: "Picture Study: Grades 9–12",
      minutes: 20,
      symbols: "↔ * 🅃---",
      trackingCount: 12,
      weeklyTarget: 1,
      meta: {
        choiceGroup: "gradeBand",
        option: "g9-12",
        optionLabel: "9–12",
      },
    };

    return t;
  }

  function normalizeCardsState(raw, allStudentIds) {
    const d = defaultCardsState();
    const state = raw && typeof raw === "object" ? raw : {};

    const templatesById = (state.templatesById && typeof state.templatesById === "object")
      ? state.templatesById
      : {};

    const placements = (state.placements && typeof state.placements === "object")
      ? state.placements
      : {};

    const instancesById = (state.instancesById && typeof state.instancesById === "object")
      ? state.instancesById
      : {};

    const choices = (state.choices && typeof state.choices === "object")
      ? { ...d.choices, ...state.choices }
      : { ...d.choices };

    const next = { templatesById, placements, instancesById, choices };

    // ensure placement buckets for existing students
    (allStudentIds || []).forEach((sid) => ensureStudentPlacements(next, sid));

    return next;
  }

  // -----------------------------
  // Alpine builder
  // -----------------------------
  window.scheduleBuilder = function scheduleBuilder() {
    return {
      // -----------------------------
      // UI state used by schedule.html
      // -----------------------------
      view: "track",
      visibleDays: [0, 1, 2, 3, 4],
      dayLabels: ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"],

      visibleStudentPanels: [
        { slot: "P1", studentId: "S1" },
        { slot: "P2", studentId: "S2" },
      ],

      // placeholder students (until wired)
      students: Array.from({ length: 15 }, (_, i) => {
        const n = i + 1;
        return { id: `S${n}`, name: `Student ${n}` };
      }),

      openStudentMenu: null,
      // -----------------------------
      // Custom Card Modal (Create / Edit / Delete)
      // -----------------------------
      customModalOpen: false,
      customModalMode: "create", // "create" | "edit" | "delete"
      customModalTemplateId: null,
      customForm: { title: "", minutes: 15 },
      customModalError: "",

      // -----------------------------
      // Phase 2.5 cards state
      // -----------------------------
      templatesById: {},      // catalog
      instancesById: {},      // instanceId -> instance
      placements: {},         // studentId -> dayIndex -> [instanceId...]
      choices: {
        courseOptions: {
          "picture-study": "g1-3",
        },
      },

      // where “Add” goes (click a column to set target)
      activeTarget: {
        studentId: "S1",
        dayIndex: 0,
      },

      // -----------------------------
      // init + persistence
      // -----------------------------
      init() {
        // load UI
        const savedUi = loadKey(UI_STORAGE_KEY);
        const allIds = (this.students || []).map((s) => s.id);
        const normalizedUi = normalizeUiState(savedUi || defaultUiState(), allIds);

        this.view = normalizedUi.view;
        this.visibleDays = normalizedUi.visibleDays;
        this.visibleStudentPanels = normalizedUi.panels;
        this.openStudentMenu = null;

        // load cards
        const savedCards = loadKey(CARDS_STORAGE_KEY);
        const normalizedCards = normalizeCardsState(savedCards || defaultCardsState(), allIds);

        // ensure sample templates exist (merge + PATCH missing fields from sample)
        const sample = buildSampleTemplates();
        
        // Start with whatever was saved, then add any missing sample templates.
        this.templatesById = { ...(normalizedCards.templatesById || {}) };
        for (const [id, sampleTpl] of Object.entries(sample)) {
          const existing = this.templatesById[id];
        
          // If template doesn't exist yet, add it.
          if (!existing) {
            this.templatesById[id] = { ...sampleTpl };
            continue;
          }
        
          // If template exists (cached older version), patch only missing fields
          // so we don't blow away any future edits.
          this.templatesById[id] = {
            ...existing,
            weeklyTarget:
              existing.weeklyTarget == null ? sampleTpl.weeklyTarget : existing.weeklyTarget,
            trackingCount:
              existing.trackingCount == null ? sampleTpl.trackingCount : existing.trackingCount,
            symbols:
              (existing.symbols == null || existing.symbols === "") ? sampleTpl.symbols : existing.symbols,
            minutes:
              existing.minutes == null ? sampleTpl.minutes : existing.minutes,
            sortKey:
              (existing.sortKey == null || existing.sortKey === "") ? sampleTpl.sortKey : existing.sortKey,
          };
        }

        // --- MIGRATION: ensure “choiceGroup” metadata exists for older cached templates ---
        for (const [id, tpl] of Object.entries(this.templatesById || {})) {
          if (!tpl || tpl.courseKey !== "picture-study") continue;
        
          // If old saved template lacks choiceGroup metadata, reconstruct it from variantKey
          if (!tpl.meta || !tpl.meta.choiceGroup) {
            const option = tpl.variantKey || (id.split(":").pop() || "g1-3");
            const labelMap = { "g1-3": "1–3", "g4-6": "4–6", "g7-8": "7–8", "g9-12": "9–12" };
            tpl.meta = {
              ...(tpl.meta || {}),
              choiceGroup: "gradeBand",
              option,
              optionLabel: labelMap[option] || option,
            };
            this.templatesById[id] = tpl;
          }
        }
        
        // ensure default selection exists
        if (!this.choices.courseOptions["picture-study"]) {
          this.choices.courseOptions["picture-study"] = "g1-3";
        }

        this.instancesById = normalizedCards.instancesById || {};
        this.placements = normalizedCards.placements || {};
        this.choices = normalizedCards.choices || {
          courseOptions: { "picture-study": "g1-3" },
        };
        if (!this.choices.courseOptions) this.choices.courseOptions = { "picture-study": "g1-3" };

        // ensure placements buckets for currently visible panel students
        this.visibleStudentPanels.forEach((p) => this.ensureStudent(p.studentId));

        // set a sane active target
        this.activeTarget = {
          studentId: this.visibleStudentPanels?.[0]?.studentId || "S1",
          dayIndex: this.visibleDays?.[0] ?? 0,
        };

        // persist normalized
        this.persistUi();
        this.persistCards();
      },

      persistUi() {
        saveKey(UI_STORAGE_KEY, {
          view: this.view,
          visibleDays: this.visibleDays,
          panels: this.visibleStudentPanels.map((p) => ({ slot: p.slot, studentId: p.studentId })),
        });
      },

      persistCards() {
        saveKey(CARDS_STORAGE_KEY, {
          templatesById: this.templatesById,
          placements: this.placements,
          instancesById: this.instancesById,
          choices: this.choices,
        });
      },

      // -----------------------------
      // UI controls
      // -----------------------------
      setView(next) {
        this.view = next;
        this.persistUi();
      },

      isDayVisible(i) {
        return this.visibleDays.includes(i);
      },

      toggleDay(i) {
        if (this.isDayVisible(i)) {
          this.visibleDays = this.visibleDays.filter((d) => d !== i);
        } else {
          this.visibleDays = [...this.visibleDays, i].sort((a, b) => a - b);
        }
        if (!this.visibleDays.length) this.visibleDays = [0, 1, 2, 3, 4];

        // keep active day valid
        if (!this.visibleDays.includes(this.activeTarget.dayIndex)) {
          this.activeTarget.dayIndex = this.visibleDays[0];
        }

        this.persistUi();
      },

      showAllDays() {
        this.visibleDays = [0, 1, 2, 3, 4];
        this.persistUi();
      },

      openCustomCardModal(mode = "create", templateId = null) {
        this.customModalMode = mode;
        this.customModalTemplateId = templateId;
        this.customModalError = "";
      
        if (mode === "create") {
          this.customForm = { title: "", minutes: 15 };
        } else {
          const tpl = this.templatesById?.[templateId];
          if (!tpl) return;
          this.customForm = {
            title: String(tpl.title || ""),
            minutes: Number(tpl.minutes || 15),
          };
        }
      
        this.customModalOpen = true;
      },
      
      closeCustomCardModal() {
        this.customModalOpen = false;
        this.customModalError = "";
      },
      
      saveCustomCardModal() {
        const title = String(this.customForm?.title || "").trim();
        const minutes = Number(this.customForm?.minutes);
      
        if (!title) {
          this.customModalError = "Please enter a title.";
          return;
        }
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 600) {
          this.customModalError = "Minutes must be a number between 0 and 600.";
          return;
        }
      
        if (this.customModalMode === "create") {
          const id = `u:${uid("card")}`;
          this.templatesById[id] = {
            id,
            sortKey: "ZZZ::99",
            courseKey: "custom",
            courseLabel: "Custom",
            variantKey: "custom",
            variantSort: 99,
            title,
            minutes,
            symbols: "",
            trackingCount: 0,
          };
        }
      
        if (this.customModalMode === "edit") {
          const id = this.customModalTemplateId;
          if (!id || !String(id).startsWith("u:")) return;
          const tpl = this.templatesById?.[id];
          if (!tpl) return;
      
          this.templatesById[id] = {
            ...tpl,
            title,
            minutes,
          };
        }
      
        this.persistCards();
        this.closeCustomCardModal();
      },
      
      confirmDeleteCustomCard() {
        const templateId = this.customModalTemplateId;
        if (!templateId || !String(templateId).startsWith("u:")) return;
      
        // remove template
        delete this.templatesById[templateId];
      
        // remove instances referencing it
        const doomedInstanceIds = [];
        for (const [instId, inst] of Object.entries(this.instancesById || {})) {
          if (inst?.templateId === templateId) doomedInstanceIds.push(instId);
        }
        for (const instId of doomedInstanceIds) delete this.instancesById[instId];
      
        // remove placements
        for (const [studentId, daysObj] of Object.entries(this.placements || {})) {
          for (let d = 0; d <= 4; d++) {
            const arr = daysObj?.[d];
            if (!Array.isArray(arr)) continue;
            this.placements[studentId][d] = arr.filter((id) => !doomedInstanceIds.includes(id));
          }
        }
      
        this.persistCards();
        this.closeCustomCardModal();
      },

      // -----------------------------
      // Student dropdown
      // -----------------------------
      toggleStudentMenu(idx) {
        this.openStudentMenu = this.openStudentMenu === idx ? null : idx;
      },

      closeStudentMenu() {
        this.openStudentMenu = null;
      },

      getStudentName(studentId) {
        const s = (this.students || []).find((x) => x.id === studentId);
        return s ? s.name : "Student";
      },

      setPanelStudent(idx, studentId) {
        if (!Array.isArray(this.visibleStudentPanels)) return;
        if (!this.visibleStudentPanels[idx]) return;

        const next = this.visibleStudentPanels.map((p, i) =>
          i === idx ? { ...p, studentId } : { ...p }
        );

        if (next[0].studentId === next[1].studentId) {
          const allIds = (this.students || []).map((s) => s.id);
          const fallback = allIds.find((id) => id !== next[0].studentId) || "S1";
          next[1].studentId = fallback;
        }

        this.visibleStudentPanels = next;

        // ensure placements exist for new student
        this.ensureStudent(studentId);

        // if active target was on the swapped panel, keep it aligned
        if (this.activeTarget.studentId !== next[0].studentId && this.activeTarget.studentId !== next[1].studentId) {
          this.activeTarget.studentId = next[0].studentId;
        }

        this.persistUi();
        this.persistCards();
      },

      // -----------------------------
      // Display helpers
      // -----------------------------
      dayLabel(i) {
        const n = Number(i);
        return this.dayLabels[n] || `Day ${n + 1}`;
      },

      setCourseOption(courseKey, option) {
        if (!this.choices.courseOptions) this.choices.courseOptions = {};
        this.choices.courseOptions[courseKey] = option;
        this.persistCards();
      },
      
      addRailEntryToActive(entry) {
        if (!entry) return;
      
        let templateId = null;
      
        if (entry.type === "single") {
          templateId = entry.templateId;
        } else if (entry.type === "group") {
          const selectedOpt = this.choices?.courseOptions?.[entry.courseKey];
          const match = (entry.options || []).find(o => o.option === selectedOpt);
          templateId = (match && match.templateId) || entry.activeTemplateId;
        }
      
        if (!templateId) return;
        this.addTemplateToActive(templateId);
      },

      railEntryDisplay(entry) {
        if (!entry) return { title: "", sub: "", minutes: 0, symbols: "" };
      
        // SINGLE template
        if (entry.type === "single") {
          const tpl = this.templatesById?.[entry.templateId] || {};
          return {
            title: tpl.title || "",
            sub: "", // no extra line
            minutes: Number(tpl.minutes || 0),
            symbols: tpl.symbols || "",
          };
        }
      
        // GROUP template (choice-based, e.g. Picture Study)
        const active = this.templatesById?.[entry.activeTemplateId] || {};
        const selectedOpt = this.choices?.courseOptions?.[entry.courseKey];
        const selectedMeta =
          (entry.options || []).find((o) => o.option === selectedOpt) || (entry.options || [])[0];
      
        // Rail should feel like ONE card:
        // Title stays “Picture Study” (course label), and the band is a secondary line.
        const baseTitle = active.courseLabel || active.title || "";
        const bandLabel = selectedMeta?.label || active?.meta?.optionLabel || "";
      
        return {
          title: baseTitle,                // "Picture Study"
          sub: bandLabel ? `Grades ${bandLabel}` : "", // "Grades 1–3"
          minutes: Number(active.minutes || 0),
          symbols: active.symbols || "",
        };
      },

      // -----------------------------
      // Phase 2.5: Catalog + placements
      // -----------------------------
      ensureStudent(studentId) {
        if (!this.placements[studentId]) {
          this.placements[studentId] = { 0: [], 1: [], 2: [], 3: [], 4: [] };
        } else {
          for (let d = 0; d <= 4; d++) {
            if (!Array.isArray(this.placements[studentId][d])) this.placements[studentId][d] = [];
          }
        }
      },

      // rail sorting: match course list order via sortKey
      railEntries() {
        const templates = Object.values(this.templatesById || {}).filter(Boolean);
      
        // group templates by courseKey when they have meta.choiceGroup
        const byCourse = new Map();
        for (const t of templates) {
          const courseKey = t.courseKey || "";
          const cg = t?.meta?.choiceGroup;
          if (cg) {
            if (!byCourse.has(courseKey)) byCourse.set(courseKey, []);
            byCourse.get(courseKey).push(t);
          }
        }
      
        // helper: sort templates the same way you were sorting before
        const sortTpl = (a, b) => {
          const ak = String(a.sortKey || "");
          const bk = String(b.sortKey || "");
          if (ak < bk) return -1;
          if (ak > bk) return 1;
      
          const ac = String(a.courseLabel || "");
          const bc = String(b.courseLabel || "");
          if (ac < bc) return -1;
          if (ac > bc) return 1;
      
          const av = Number(a.variantSort || 0);
          const bv = Number(b.variantSort || 0);
          if (av !== bv) return av - bv;
      
          return String(a.title || "").localeCompare(String(b.title || ""));
        };
      
        templates.sort(sortTpl);
      
        const entries = [];
        const seenGroupedCourse = new Set();
      
        for (const t of templates) {
          const courseKey = t.courseKey || "";
          const cg = t?.meta?.choiceGroup;
      
          if (cg) {
            if (seenGroupedCourse.has(courseKey)) continue;
            seenGroupedCourse.add(courseKey);
      
            const options = (byCourse.get(courseKey) || []).slice().sort(sortTpl);
            const selected = this.choices?.courseOptions?.[courseKey] || options?.[0]?.meta?.option;
      
            // pick the selected template for display
            const activeTpl =
              options.find(x => x?.meta?.option === selected) || options[0];
      
            entries.push({
              type: "group",
              courseKey,
              choiceGroup: cg,
              courseLabel: activeTpl?.courseLabel || "",
              sortKey: activeTpl?.sortKey || "",
              options: options.map(x => ({
                option: x?.meta?.option,
                label: x?.meta?.optionLabel || x?.meta?.option,
                templateId: x.id,
              })),
              activeTemplateId: activeTpl?.id,
            });
          } else {
            entries.push({
              type: "single",
              templateId: t.id,
              sortKey: t.sortKey || "",
            });
          }
        }

        // Move completed items to the bottom for the currently selected rail student
        const sid = this.activeTarget?.studentId;
        if (sid) {
          entries.sort((a, b) => {
            const ta = this.trackingForEntry(a);
            const tb = this.trackingForEntry(b);
            const da = ta.show && ta.done ? 1 : 0;
            const db = tb.show && tb.done ? 1 : 0;
        
            // incomplete first, complete last
            if (da !== db) return da - db;
        
            // keep existing order otherwise (already sorted above)
            return 0;
          });
        }
      
        return entries;
      },

      weeklyTargetForEntry(entry) {
        if (!entry) return 0;
      
        // SINGLE: target from template
        if (entry.type === "single") {
          const tpl = this.templatesById?.[entry.templateId];
          return Number(tpl?.weeklyTarget || 0);
        }
      
        // GROUP: target from active template (they should all match)
        if (entry.type === "group") {
          const tpl = this.templatesById?.[entry.activeTemplateId];
          return Number(tpl?.weeklyTarget || 0);
        }
      
        return 0;
      },
      
      weeklyUsedForEntry(studentId, entry) {
        if (!studentId || !entry) return 0;
        const daysObj = this.placements?.[studentId];
        if (!daysObj) return 0;
      
        let used = 0;
      
        for (let d = 0; d <= 4; d++) {
          const ids = daysObj?.[d];
          if (!Array.isArray(ids)) continue;
      
          for (const instId of ids) {
            const inst = this.instancesById?.[instId];
            if (!inst) continue;
      
            const tpl = this.templatesById?.[inst.templateId];
            if (!tpl) continue;
      
            if (entry.type === "single") {
              if (inst.templateId === entry.templateId) used++;
            } else if (entry.type === "group") {
              // Count by courseKey so any grade-band satisfies Picture Study
              if (tpl.courseKey === entry.courseKey) used++;
            }
          }
        }
      
        return used;
      },
      
      trackingForEntry(entry) {
        const studentId = this.activeTarget?.studentId; // ties to rail student picker
        const target = this.weeklyTargetForEntry(entry);
        if (!target) return { show: false, done: false, label: "" };
      
        const used = this.weeklyUsedForEntry(studentId, entry);
        const done = used >= target;
      
        return {
          show: true,
          done,
          label: done ? "" : `${used}/${target}`,
        };
      },
      
      sortedTemplates() {
        // Backwards-compatible helper for anywhere else that expects templates.
        // We’ll render from railEntries() in the HTML now.
        return Object.values(this.templatesById || {}).filter(Boolean);
      },

      // active target (click a column to set)
      setActiveTarget(studentId, dayIndex) {
        this.activeTarget = { studentId, dayIndex: Number(dayIndex) };
      },

      activeTargetLabel() {
        const s = this.getStudentName(this.activeTarget.studentId);
        const d = this.dayLabel(this.activeTarget.dayIndex);
        return `${s} • ${d}`;
      },

      // Create a new instance and append to active day
      addTemplateToActive(templateId) {
        const tpl = this.templatesById?.[templateId];
        if (!tpl) return;

        const studentId = this.activeTarget.studentId;
        const dayIndex = this.activeTarget.dayIndex;

        this.ensureStudent(studentId);

        const instanceId = uid("inst");
        this.instancesById[instanceId] = {
          instanceId,
          templateId,
          createdAt: Date.now(),
        };

        this.placements[studentId][dayIndex].push(instanceId);
        this.persistCards();
      },

      // Remove instance from a day (Phase 2.5 helper)
      removeInstance(studentId, dayIndex, instanceId) {
        this.ensureStudent(studentId);
        const arr = this.placements[studentId][dayIndex] || [];
        this.placements[studentId][dayIndex] = arr.filter((id) => id !== instanceId);
        // keep instance in instancesById for now (safe); can GC later
        this.persistCards();
      },

      // Render helpers
      instancesFor(studentId, dayIndex) {
        this.ensureStudent(studentId);
        const ids = this.placements[studentId][dayIndex] || [];
        return ids
          .map((id) => this.instancesById[id])
          .filter(Boolean);
      },

      templateForInstance(inst) {
        return inst ? this.templatesById?.[inst.templateId] : null;
      },

      dayTotalMinutes(studentId, dayIndex) {
        const list = this.instancesFor(studentId, dayIndex);
        let total = 0;
        for (const inst of list) {
          const tpl = this.templateForInstance(inst);
          const m = Number(tpl?.minutes || 0);
          if (Number.isFinite(m)) total += m;
        }
        return total;
      },

      trackingBlocks(tpl) {
        const n = Number(tpl?.trackingCount || 0);
        if (!Number.isFinite(n) || n <= 0) return "";
        return "⬚".repeat(Math.min(n, 20)); // cap display; real rendering later
      },

      // Picture Study choice
      setPictureStudyBand(band) {
        this.choices.pictureStudyBand = band;
        this.persistCards();
      },

      // Custom card (minimal v2.5)
      addCustomCard() {
        this.openCustomCardModal("create");
      },

      removeCustomTemplate(templateId) {
        if (!templateId || !String(templateId).startsWith("u:")) return;
      
        const tpl = this.templatesById?.[templateId];
        if (!tpl) return;
      
        const ok = confirm(`Remove custom card "${tpl.title}"?\n\nThis will also remove it from any days it was added to.`);
        if (!ok) return;
      
        // 1) remove the template
        delete this.templatesById[templateId];
      
        // 2) remove any instances that reference this template
        const doomedInstanceIds = [];
        for (const [instId, inst] of Object.entries(this.instancesById || {})) {
          if (inst?.templateId === templateId) doomedInstanceIds.push(instId);
        }
        for (const instId of doomedInstanceIds) delete this.instancesById[instId];
      
        // 3) remove those instances from placements
        for (const [studentId, daysObj] of Object.entries(this.placements || {})) {
          for (let d = 0; d <= 4; d++) {
            const arr = daysObj?.[d];
            if (!Array.isArray(arr)) continue;
            this.placements[studentId][d] = arr.filter((id) => !doomedInstanceIds.includes(id));
          }
        }
      
        this.persistCards();
      },
      
    };
  };
})();
