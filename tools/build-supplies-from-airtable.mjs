// ✅ Build Supplies JSON from Airtable
// - data/MA_Supplies.json
// - data/MA_Supplies_Courses.json (Supplies-page-only course tree fragment)

import Airtable from "airtable";
import fs from "fs/promises";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ROTATION = process.env.ROTATION || "3";

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.error("ERROR: Missing AIRTABLE_PAT or AIRTABLE_BASE_ID.");
  process.exit(1);
}

const base = new Airtable({
  apiKey: AIRTABLE_PAT,
}).base(AIRTABLE_BASE_ID);

// Source tables / views
const SUPPLIES_TABLE = "MA_Supplies";
const ROTATION_TABLE = `Rotation_${ROTATION}`;
const SUPPLIES_VIEW = "Grid view";
const SUPPLIES_PAGE_VIEW = `R${ROTATION} – Supplies Page JSON`;

// Output files
const OUTPUT_SUPPLIES = "data/MA_Supplies.json";
const OUTPUT_SUPPLIES_COURSES = "data/MA_Supplies_Courses.json";

// -------------------------
// Helpers
// -------------------------
function get(field, rec) {
  return rec.get(field) ?? null;
}

function arr(field, rec) {
  const val = rec.get(field);
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function txt(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function list(v) {
  const clean = (s) => {
    const x = String(s ?? "").trim();
    if (!x) return "";
    if (x.toLowerCase() === "null") return "";
    return x;
  };

  if (v == null) return [];

  if (Array.isArray(v)) {
    return v
      .flatMap((x) => String(x).split(","))
      .map(clean)
      .filter(Boolean);
  }

  return String(v)
    .split(",")
    .map(clean)
    .filter(Boolean);
}

function bool01(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "1" || s === "true") return true;
  if (s === "0" || s === "false" || s === "") return false;
  return true;
}

async function fetchAllRecords(tableName, viewName) {
  const out = [];

  await base(tableName)
    .select({ view: viewName })
    .eachPage((records, next) => {
      out.push(...records);
      next();
    });

  return out;
}

function normalizeSuppliesPageCourse(rec) {
  const f = rec.fields ?? {};

  const courseId = txt(f["C/T_ID"]).trim() || rec.id;
  const subject = txt(f["Subject"]).trim() || "Basic Supplies";

  const gradeFilter = txt(f["Grade_Filter"]).trim();
  const gradeTags = gradeFilter
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    id: courseId,
    courseId,
    recordID: f["recordID"] || rec.id,

    title: txt(f["ProgramLIST"]).trim() || "(Untitled)",
    shared: txt(f["Shared"]).trim(),
    subject,

    gradeTags,
    gradeText: txt(f["Grade_Text"]).trim(),
    schedText: txt(f["Scheduling_Info_Text"]).trim(),

    description: txt(f["Course/Topic Description"]),
    tips: txt(f["Combining & Placement Tips"]),

    metaLine: [
      txt(f["Grade_Text"]).trim(),
      txt(f["Scheduling_Info_Text"]).trim(),
    ]
      .filter(Boolean)
      .join(" | "),

    topics: [],

    Topic_List_App: txt(f["Topic_List_App"]),
    Topic_ID_App: txt(f["Topic_ID_App"]),
    Resource_Assignments: txt(f["Resource_Assignments"]),
    Edit_CourseListURL: txt(f["Edit_CourseListURL"]),
    Edit_ResourceAssignmentsURL: txt(f["Edit_ResourceAssignmentsURL"]),
    Edit_SuppliesURL: txt(f["Edit_SuppliesURL"]),
    term1: txt(f["Term 1"]).trim(),
    term2: txt(f["Term 2"]).trim(),
    term3: txt(f["Term 3"]).trim(),

    scheduleID: list(f["scheduleID"]),
    hasVariant: bool01(f["hasVariant"]),
    hasGradeband: bool01(f["hasGradeband"]),
    gradeBandKey: list(f["gradeBandKey"]),
  };
}

// -------------------------
// Builders
// -------------------------
async function buildSuppliesJson() {
  const records = [];
  const supplyRecs = await fetchAllRecords(SUPPLIES_TABLE, SUPPLIES_VIEW);

  for (const rec of supplyRecs) {
    records.push({
      id: rec.id,

      // --- Core ---
      title: get("Supply", rec),

      image: get("Image_ViewLink", rec),
      imageFile: get("Image", rec),

      location: get("Location to Find (Optional)", rec),
      isbn: get("ISBN/ASIN", rec),

      // --- Flags ---
      optional: !!get("Optional", rec),
      groupSupply: !!get("Group Supply", rec),
      household: !!get("Household Supply", rec),

      // --- Content ---
      rationale: get("➜ RATIONALE:", rec),
      note: get("➜ NOTE:", rec),
      maySub: get("➜ MAY SUB", rec),

      qty: get("QTY", rec),

      // --- Links ---
      linkText1: get("Link Text 1", rec),
      link1: get("URL 1", rec),
      linkText2: get("Link Text 2", rec),
      link2: get("URL 2", rec),

      // --- Discount ---
      discount: !!get("Discount", rec),
      discountCode: get("with code", rec),
      discountLink: get("using link", rec),

      // --- Scope / Cross-course text ---
      scope: get("Scope", rec),
      usedInText: get("Shared_Supply(R3)", rec),

      // --- Subject ---
      subjects: arr("Subject(s)", rec),

      // --- Course Connections ---
      courses: arr("Course/Topic(R2)", rec),
      programList: get("ProgramLIST (from Rotation_3)", rec),

      // --- Sorting ---
      sortId: get("Sort_ID (from Rotation_3)", rec),
      supplySort: get("Supply_Sort", rec),
      supplyTermSortR3: get("Supply/Term_Sort(R3)", rec),

      // --- IDs / Edit ---
      supplyId: get("Supply ID", rec),
      termSort: get("Term_Sort", rec),
      recordEditLink: get("Record Edit Link", rec),
    });
  }

  console.log(`[Supplies] Loaded ${records.length} supply records`);

  await fs.writeFile(OUTPUT_SUPPLIES, JSON.stringify(records, null, 2));
  console.log(`[Supplies] Saved → ${OUTPUT_SUPPLIES}`);
}

async function buildSuppliesCoursesJson() {
  const specialCourseRecs = await fetchAllRecords(ROTATION_TABLE, SUPPLIES_PAGE_VIEW);

  const grouped = {};

  for (const rec of specialCourseRecs) {
    const course = normalizeSuppliesPageCourse(rec);
    const subject = course.subject || "Basic Supplies";

    if (!grouped[subject]) grouped[subject] = [];
    grouped[subject].push(course);
  }

  console.log(
    `[SuppliesCourses] Loaded ${specialCourseRecs.length} supplies-page course record(s)`
  );

  await fs.writeFile(OUTPUT_SUPPLIES_COURSES, JSON.stringify(grouped, null, 2));
  console.log(`[SuppliesCourses] Saved → ${OUTPUT_SUPPLIES_COURSES}`);
}

async function run() {
  await fs.mkdir("data", { recursive: true });

  await buildSuppliesJson();
  await buildSuppliesCoursesJson();
}

run().catch((err) => {
  console.error("[Supplies] Build failed", err);
  process.exit(1);
});
