// tools/build-courses-from-airtable.mjs
//
// Build data/MA_Courses.json directly from Airtable for a given rotation.
// Usage (Rotation 3):
//   AIRTABLE_PAT=xxx AIRTABLE_BASE_ID=xxx ROTATION=3 node tools/build-courses-from-airtable.mjs
//
// Requires Node 18+ (for global fetch).

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// 1) CONFIG – set env vars when you run it
// ─────────────────────────────────────────────

const AIRTABLE_PAT     = process.env.AIRTABLE_PAT;      // Personal Access Token
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;  // Your base ID
const ROTATION         = process.env.ROTATION || "3";   // "3" this year, "4" next, etc.

// Single rotation table that contains both courses + topics
const ROTATION_TABLE = `Rotation_${ROTATION}`;

// Views you’ll create in Airtable:
const VIEW_COURSES = `R${ROTATION} – Courses JSON`;
const VIEW_TOPICS  = `R${ROTATION} – Topics JSON`;

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.error("ERROR: You must set AIRTABLE_PAT and AIRTABLE_BASE_ID env vars.");
  process.exit(1);
}

const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

// ─────────────────────────────────────────────
// 2) Fetch ALL records from a table + view
// ─────────────────────────────────────────────

async function fetchAllRecords(tableName, viewName) {
  const records = [];
  let offset = undefined;

  do {
    const params = new URLSearchParams();
    if (viewName) params.set("view", viewName);
    if (offset)   params.set("offset", offset);

    const url = `${AIRTABLE_API_URL}/${encodeURIComponent(tableName)}?${params}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable error for ${tableName}/${viewName}: ${res.status} ${text}`);
    }

    const json = await res.json();
    records.push(...json.records);
    offset = json.offset;
  } while (offset);

  return records;
}

// ─────────────────────────────────────────────
// 3) Helper: normalize Airtable field values
// ─────────────────────────────────────────────

function toText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

// ─────────────────────────────────────────────
// 4) Normalizers – map Airtable fields → planner fields
// ─────────────────────────────────────────────

function normalizeCourseRecord(rec) {
  const f = rec.fields || {};

  // Field names here are Airtable column names from your mapping
  const courseId    = toText(f["C/T_ID"]) || rec.id;
  const subject     = toText(f["Subject"]) || "Unsorted";
  const gradeText   = toText(f["Grade_Text"]).trim();
  const schedText   = toText(f["Scheduling_Info_Text"]).trim();
  const title       = toText(f["ProgramLIST"]) || "(Untitled course)";
  const desc        = toText(f["Course/Topic Description"]);
  const tips        = toText(f["Combining & Placement Tips"]);
  const gradeFilter = toText(f["Grade_Filter"]).trim();

  const gradeTags =
    gradeFilter
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);   // ["G3", "G4", ...]

  return {
    // core planner fields
    id:       courseId,
    courseId: courseId,
    recordID: f["recordID"] || rec.id,

    title,
    subject,

    gradeTags,
    gradeText,
    schedText,

    description: desc,
    tips,

    metaLine: [gradeText, schedText].filter(Boolean).join(" | "),

    topics: [],                 // filled in later

    // extra fields for staff view / future use
    Topic_List_App:   toText(f["Topic_List_App"]),
    Topic_ID_App:     toText(f["Topic_ID_App"]),
    Resource_Assignments: toText(f["Resource_Assignments"]),
    Edit_CourseListURL:        toText(f["Edit_CourseListURL"]),
    Edit_ResourceAssignmentsURL: toText(f["Edit_ResourceAssignmentsURL"]),
  };
}

function normalizeTopicRecord(rec) {
  const f = rec.fields || {};

  const topicId    = toText(f["C/T_ID"]) || rec.id;
  const courseId   = toText(f["Course_ID_App"]);
  const gradeText  = toText(f["Grade_Text"]).trim();
  const schedText  = toText(f["Scheduling_Info_Text"]).trim();
  const desc       = toText(f["Course/Topic Description"]);
  const tips       = toText(f["Combining & Placement Tips"]);
  const gradeFilter = toText(f["Grade_Filter"]).trim();

  const gradeTags =
    gradeFilter
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

  return {
    recordID: f["recordID"] || rec.id,

    Topic: toText(f["ProgramLIST"]) || "(Untitled topic)",

    Topic_ID: topicId,
    courseId,

    gradeText,
    schedText,

    description: desc,
    tips,

    gradeTags,

    // book/course linkage + staff URLs
    Course_List_R3:  toText(f["Course_List_App"]),
    Subject:         toText(f["Subject"]),
    Resource_Assignments: toText(f["Resource_Assignments"]),
    Edit_CourseListURL:        toText(f["Edit_CourseListURL"]),
    Edit_ResourceAssignmentsURL: toText(f["Edit_ResourceAssignmentsURL"]),
  };
}

// ─────────────────────────────────────────────
// 5) Main builder
// ─────────────────────────────────────────────

async function buildCoursesJson() {
  console.log(`Building MA_Courses.json for Rotation ${ROTATION}…`);

  console.log("Fetching course rows…");
  const courseRecords = await fetchAllRecords(ROTATION_TABLE, VIEW_COURSES);

  console.log("Fetching topic rows…");
  const topicRecords  = await fetchAllRecords(ROTATION_TABLE, VIEW_TOPICS);

  const courses = courseRecords.map(normalizeCourseRecord);
  const topics  = topicRecords.map(normalizeTopicRecord);

  // --- 1) Index topics by courseId AND by Topic_ID ---

  const topicsByCourseId = new Map();  // courseId -> [topics]
  const topicsById       = new Map();  // Topic_ID -> topic

  for (const t of topics) {
    // a) lookup by courseId (direct connection)
    if (t.courseId) {
      if (!topicsByCourseId.has(t.courseId)) {
        topicsByCourseId.set(t.courseId, []);
      }
      topicsByCourseId.get(t.courseId).push(t);
    }

    // b) lookup by Topic_ID (for shared topics)
    if (t.Topic_ID) {
      topicsById.set(t.Topic_ID, t);
    }
  }

  // --- 2) Attach topics to courses ----------------------------------------

  // Index topics by Course_ID_R3 so we can attach them to the right course
  const topicsByCourseId = {};
  for (const t of topicsRaw) {
    const courseId = (t.Course_ID_R3 || "").trim();
    if (!courseId) continue;
    if (!topicsByCourseId[courseId]) topicsByCourseId[courseId] = [];
    topicsByCourseId[courseId].push(t);
  }

  // Build normalized course objects, each with a sorted topics[] array
  const coursesWithTopics = coursesRaw.map((c) => {
    const courseId = (c.Course_ID || "").trim();

    // 1) Build the raw topics for this course
    const rawTopics = topicsByCourseId[courseId] || [];
    const topics = rawTopics.map((t) => normalizeTopicRecord(t, c));

    // 2) OPTION C: sort topics to match Topic_ID_App order first
    const topicIdList = (c.Topic_ID_App || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (topicIdList.length) {
      const orderMap = new Map();
      topicIdList.forEach((id, index) => {
        if (!orderMap.has(id)) orderMap.set(id, index);
      });

      topics.sort((a, b) => {
        const aPos = orderMap.has(a.topicId)
          ? orderMap.get(a.topicId)
          : Number.POSITIVE_INFINITY;
        const bPos = orderMap.has(b.topicId)
          ? orderMap.get(b.topicId)
          : Number.POSITIVE_INFINITY;

        if (aPos !== bPos) return aPos - bPos;

        // tie-breaker: alphabetical by title so “extra” topics still have
        // a stable order
        return (a.title || "").localeCompare(b.title || "");
      });
    }

    // 3) Normalize the full course record (this keeps Topic_List_App,
    //    Topic_ID_App, Edit URLs, etc., exactly as before)
    return normalizeCourseRecord(c, topics);
  });

  // --- 3) Group courses by subject for the planner ---

  const bySubject = {};
  for (const c of courses) {
    const subject = c.subject || "Unsorted";
    if (!bySubject[subject]) bySubject[subject] = [];
    bySubject[subject].push(c);
  }

  for (const subject of Object.keys(bySubject)) {
    bySubject[subject].sort((a, b) => {
      const aId = a.courseId || "";
      const bId = b.courseId || "";
      if (aId < bId) return -1;
      if (aId > bId) return 1;
      return (a.title || "").localeCompare(b.title || "");
    });
  }

  const outPath = path.join(__dirname, "..", "data", "MA_Courses.json");
  await fs.writeFile(outPath, JSON.stringify(bySubject, null, 2), "utf8");
  console.log(`✓ Wrote ${outPath}`);
}

// ─────────────────────────────────────────────

buildCoursesJson().catch(err => {
  console.error("Build failed:", err);
  process.exit(1);
});
