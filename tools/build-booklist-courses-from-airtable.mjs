// ✅ Build Book List extra courses/topics JSON from Airtable
// - data/MA_BookList_Courses.json
// This is for booklist-only course tree additions such as Suggested Resources.

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

// Source table / view
const ROTATION_TABLE = `Rotation_${ROTATION}`;
const BOOKLIST_PAGE_VIEW = `R${ROTATION} – Courses + Topics Booklist JSON`;

// Output file
const OUTPUT_BOOKLIST_COURSES = "data/MA_BookList_Courses.json";

// -------------------------
// Helpers
// -------------------------
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

// -------------------------
// Normalizers
// -------------------------
function normalizeCourse(rec) {
  const f = rec.fields ?? {};

  const courseId = txt(f["C/T_ID"]).trim() || rec.id;
  const subject = txt(f["Subject"]).trim() || "Suggested Resources";

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

function normalizeTopic(rec) {
  const f = rec.fields ?? {};

  const topicId = txt(f["C/T_ID"]).trim() || rec.id;
  const courseId = txt(f["Course_ID_App"]).trim();

  const gradeFilter = txt(f["Grade_Filter"]).trim();
  const gradeTags = gradeFilter
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    recordID: f["recordID"] || rec.id,

    Topic: txt(f["ProgramLIST"]).trim() || "(Untitled topic)",
    shared: txt(f["Shared"]).trim(),
    Topic_ID: topicId,
    courseId,

    description: txt(f["Course/Topic Description"]),
    tips: txt(f["Combining & Placement Tips"]),

    gradeText: txt(f["Grade_Text"]).trim(),
    schedText: txt(f["Scheduling_Info_Text"]).trim(),
    gradeTags,

    Subject: txt(f["Subject"]).trim(),
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
// Builder
// -------------------------
async function buildBookListCoursesJson() {
  const recs = await fetchAllRecords(ROTATION_TABLE, BOOKLIST_PAGE_VIEW);

  const courseRecs = [];
  const topicRecs = [];

  for (const rec of recs) {
    const f = rec.fields ?? {};

    const kindRaw =
      txt(f["C/T"]).trim().toUpperCase() ||
      txt(f["Course or Topic"]).trim().toUpperCase();

    if (kindRaw === "T" || kindRaw === "TOPIC") {
      topicRecs.push(rec);
    } else {
      courseRecs.push(rec);
    }
  }

  const courses = courseRecs.map(normalizeCourse);
  const topics = topicRecs.map(normalizeTopic);

  const topicsById = new Map();
  for (const t of topics) {
    if (!t.Topic_ID) continue;
    topicsById.set(t.Topic_ID, t);
  }

  const topicsByCourse = new Map();
  for (const t of topics) {
    if (!t.courseId) continue;
    if (!topicsByCourse.has(t.courseId)) topicsByCourse.set(t.courseId, []);
    topicsByCourse.get(t.courseId).push(t);
  }

  for (const c of courses) {
    const idList = (c.Topic_ID_App || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const topicsForCourse = [];

    // Prefer Topic_ID_App order exactly
    for (const topicId of idList) {
      const baseTopic = topicsById.get(topicId);
      if (!baseTopic) continue;
      topicsForCourse.push({ ...baseTopic, courseId: c.courseId });
    }

    // Fallback if Topic_ID_App is blank
    if (idList.length === 0) {
      const direct = topicsByCourse.get(c.courseId) ?? [];
      for (const t of direct) topicsForCourse.push(t);
    }

    c.topics = topicsForCourse;
  }

  const grouped = {};
  for (const c of courses) {
    const subject = c.subject || "Suggested Resources";
    if (!grouped[subject]) grouped[subject] = [];
    grouped[subject].push(c);
  }

  for (const subject of Object.keys(grouped)) {
    grouped[subject].sort((a, b) => a.courseId.localeCompare(b.courseId));
  }

  await fs.writeFile(
    OUTPUT_BOOKLIST_COURSES,
    JSON.stringify(grouped, null, 2)
  );

  console.log(
    `[BookListCourses] Loaded ${courseRecs.length} course record(s) and ${topicRecs.length} topic record(s)`
  );
  console.log(`[BookListCourses] Saved → ${OUTPUT_BOOKLIST_COURSES}`);
}

async function run() {
  await fs.mkdir("data", { recursive: true });
  await buildBookListCoursesJson();
}

run().catch((err) => {
  console.error("[BookListCourses] Build failed", err);
  process.exit(1);
});
