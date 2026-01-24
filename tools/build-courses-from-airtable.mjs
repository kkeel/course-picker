// tools/build-courses-from-airtable.mjs
//
// Build MA_Courses.json directly from Airtable.
// Uses Option C: topics sorted according to Topic_ID_App order.
//
// Usage:
// AIRTABLE_PAT=xxx AIRTABLE_BASE_ID=xxx ROTATION=3 node tools/build-courses-from-airtable.mjs

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const AIRTABLE_PAT     = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ROTATION         = process.env.ROTATION || "3";

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.error("ERROR: Missing AIRTABLE_PAT or AIRTABLE_BASE_ID.");
  process.exit(1);
}

const API = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const TABLE = `Rotation_${ROTATION}`;
const VIEW_COURSES = `R${ROTATION} – Courses JSON`;
const VIEW_TOPICS  = `R${ROTATION} – Topics JSON`;

// ─────────────────────────────────────────────
// Fetch helper
// ─────────────────────────────────────────────

async function fetchAll(table, view) {
  const out = [];
  let offset;

  do {
    const params = new URLSearchParams();
    if (view) params.set("view", view);
    if (offset) params.set("offset", offset);

    const res = await fetch(`${API}/${table}?${params}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
    });

    if (!res.ok) {
      throw new Error(`Airtable error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json();
    out.push(...json.records);
    offset = json.offset;

  } while (offset);

  return out;
}

// Simple text normalizer
function txt(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

// ─────────────────────────────────────────────
// Record normalizers
// ─────────────────────────────────────────────

function normalizeCourse(rec) {
  const f = rec.fields ?? {};

  const courseId = txt(f["C/T_ID"]) || rec.id;
  const subject  = txt(f["Subject"]) || "Unsorted";

  const gradeFilter = txt(f["Grade_Filter"]).trim();
  const gradeTags = gradeFilter
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  return {
    id: courseId,
    courseId,
    recordID: f["recordID"] || rec.id,

    title: txt(f["ProgramLIST"]) || "(Untitled)",
    shared: txt(f["Shared"]).trim(),   // expect "↔" or ""
    subject,

    gradeTags,
    gradeText: txt(f["Grade_Text"]).trim(),
    schedText: txt(f["Scheduling_Info_Text"]).trim(),

    description: txt(f["Course/Topic Description"]),
    tips: txt(f["Combining & Placement Tips"]),

    metaLine: [
      txt(f["Grade_Text"]).trim(),
      txt(f["Scheduling_Info_Text"]).trim()
    ].filter(Boolean).join(" | "),

    topics: [],

    Topic_List_App:   txt(f["Topic_List_App"]),
    Topic_ID_App:     txt(f["Topic_ID_App"]),
    Resource_Assignments: txt(f["Resource_Assignments"]),
    Edit_CourseListURL: txt(f["Edit_CourseListURL"]),
    Edit_ResourceAssignmentsURL: txt(f["Edit_ResourceAssignmentsURL"]),
  };
}

function normalizeTopic(rec) {
  const f = rec.fields ?? {};

  const topicId = txt(f["C/T_ID"]) || rec.id;
  const courseId = txt(f["Course_ID_App"]).trim();

  const gradeFilter = txt(f["Grade_Filter"]).trim();
  const gradeTags = gradeFilter
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  return {
    recordID: f["recordID"] || rec.id,

    Topic: txt(f["ProgramLIST"]) || "(Untitled topic)",
    shared: txt(f["Shared"]).trim(),   // expect "↔" or ""
    Topic_ID: topicId,
    courseId,

    description: txt(f["Course/Topic Description"]),
    tips: txt(f["Combining & Placement Tips"]),

    gradeText: txt(f["Grade_Text"]).trim(),
    schedText: txt(f["Scheduling_Info_Text"]).trim(),
    gradeTags,

    Subject: txt(f["Subject"]),
    Resource_Assignments: txt(f["Resource_Assignments"]),
    Edit_CourseListURL: txt(f["Edit_CourseListURL"]),
    Edit_ResourceAssignmentsURL: txt(f["Edit_ResourceAssignmentsURL"]),
  };
}

// ─────────────────────────────────────────────
// MAIN BUILDER
// ─────────────────────────────────────────────

async function build() {
  console.log(`Building MA_Courses.json (Rotation ${ROTATION})…`);

  console.log("Fetching courses…");
  const courseRecs = await fetchAll(TABLE, VIEW_COURSES);

  console.log("Fetching topics…");
  const topicRecs = await fetchAll(TABLE, VIEW_TOPICS);

  const courses = courseRecs.map(normalizeCourse);
  const topics  = topicRecs.map(normalizeTopic);
  
  // Index topics by Topic_ID for lookup from Topic_ID_App
  const topicsById = new Map();
  for (const t of topics) {
    if (!t.Topic_ID) continue;
    topicsById.set(t.Topic_ID, t);
  }

  // Index topics by courseId
  const byCourse = new Map();
  for (const t of topics) {
    if (!t.courseId) continue;
    if (!byCourse.has(t.courseId)) byCourse.set(t.courseId, []);
    byCourse.get(t.courseId).push(t);
  }

  // Attach topics to each course using Topic_ID_App order
  for (const c of courses) {
    const idList = (c.Topic_ID_App || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const topicsForCourse = [];

    // 1) If Topic_ID_App is filled, use that order exactly
    for (const topicId of idList) {
      const baseTopic = topicsById.get(topicId);
      if (!baseTopic) continue;

      // Clone so we can safely override courseId if needed
      const cloned = { ...baseTopic, courseId: c.courseId };
      topicsForCourse.push(cloned);
    }

    // 2) Fallback: if no Topic_ID_App, attach any topics whose courseId matches
    if (idList.length === 0) {
      const direct = byCourse.get(c.courseId) ?? [];
      for (const t of direct) {
        topicsForCourse.push(t);
      }
    }

    // No extra sort: Topic_ID_App already defines the order
    c.topics = topicsForCourse;
  }

  // Group by subject
  const grouped = {};
  for (const c of courses) {
    const s = c.subject || "Unsorted";
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(c);
  }

  // Sort courses inside each subject
  for (const s of Object.keys(grouped)) {
    grouped[s].sort((a, b) => a.courseId.localeCompare(b.courseId));
  }

  // Write file
  const outPath = path.join(__dirname, "..", "data", "MA_Courses.json");
  await fs.writeFile(outPath, JSON.stringify(grouped, null, 2), "utf8");

  console.log("✓ Done!");
  console.log("Written:", outPath);
}

build().catch(err => {
  console.error("Build failed:", err);
  process.exit(1);
});
