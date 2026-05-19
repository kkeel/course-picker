// tools/build-supply-views.js
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(DATA_DIR, "supply-views");

const COURSES_PATH = path.join(DATA_DIR, "MA_Supplies_Courses.json");
const SUPPLIES_PATH = path.join(DATA_DIR, "MA_Supplies.json");

const SUBJECT_ORDER = [
  "Basic Supplies",
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
];

const GRADE_CODES = Array.from({ length: 12 }, (_, i) => `G${i + 1}`);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeGroups(raw) {
  return raw?.coursesBySubject || raw?.bySubject || raw?.subjects || raw || {};
}

function safeText(value) {
  return String(value || "").trim();
}

function normalizeSortId(value) {
  return safeText(value).replace(/\.000$/, "");
}

function subjectSlug(subject) {
  return String(subject || "Other")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "other";
}

function itemGradeTags(item) {
  return Array.isArray(item?.gradeTags) ? item.gradeTags.map(String) : [];
}

function gradeMatches(item, gradeCode) {
  const tags = itemGradeTags(item);
  if (tags.includes(gradeCode)) return true;

  const n = Number(String(gradeCode).replace(/^G/i, ""));
  const text = String(item?.gradeText || "").toUpperCase();
  const ranges = text.match(/\d+\s*-\s*\d+|\d+/g) || [];

  return ranges.some((part) => {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => Number(x.trim()));
      return n >= a && n <= b;
    }
    return Number(part) === n;
  });
}

function supplyImage(supply) {
  const first = Array.isArray(supply.imageFile) ? supply.imageFile[0] : null;
  return (
    first?.thumbnails?.large?.url ||
    first?.thumbnails?.full?.url ||
    first?.url ||
    supply.image ||
    ""
  );
}

function publicSupply(supply) {
  return {
    id: supply.id || supply.supplyId,
    supplyId: supply.supplyId || supply.id,
    title: supply.title || "Untitled supply",
    image: supplyImage(supply),
    isbn: supply.isbn || "",
    optional: Boolean(supply.optional),
    groupSupply: Boolean(supply.groupSupply),
    household: Boolean(supply.household),
    rationale: supply.rationale || "",
    note: supply.note || "",
    maySub: supply.maySub || "",
    qty: supply.qty || "",
    linkText1: supply.linkText1 || "",
    link1: supply.link1 || "",
    linkText2: supply.linkText2 || "",
    link2: supply.link2 || "",
    discount: Boolean(supply.discount),
    discountCode: supply.discountCode || "",
    discountLink: supply.discountLink || "",
    scope: supply.scope || "",
    usedInText: supply.usedInText || "",
    subjects: Array.isArray(supply.subjects) ? supply.subjects : [],
    programList: Array.isArray(supply.programList) ? supply.programList : [],
    sortId: Array.isArray(supply.sortId) ? supply.sortId : [],
    supplySort: supply.supplySort ?? null,
    supplyTermSortR3: supply.supplyTermSortR3 || "",
    termSort: supply.termSort ?? null,
    recordEditLink: supply.recordEditLink || "",
  };
}

function buildSuppliesByTarget(supplies) {
  const out = {};

  for (const supply of supplies || []) {
    const sortIds = Array.isArray(supply.sortId) ? supply.sortId : [];

    for (const rawSortId of sortIds) {
      const targetId = normalizeSortId(rawSortId);
      if (!targetId) continue;

      if (!out[targetId]) out[targetId] = [];
      out[targetId].push(publicSupply(supply));
    }
  }

  for (const targetId of Object.keys(out)) {
    out[targetId].sort((a, b) => {
      const aKey = String(a.supplyTermSortR3 || a.supplySort || "");
      const bKey = String(b.supplyTermSortR3 || b.supplySort || "");
      if (aKey !== bKey) return aKey.localeCompare(bKey);
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  return out;
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function flattenCourses(groups) {
  const rows = [];

  for (const [subject, courses] of Object.entries(groups || {})) {
    for (const course of courses || []) {
      rows.push({
        ...course,
        subject: course.subject || subject,
        id: normalizeSortId(course.id || course.courseId),
        courseId: normalizeSortId(course.courseId || course.id),
      });
    }
  }

  return rows;
}

function makeSection(row, supplies) {
  return {
    title: row.title || "Untitled",
    type: "course",
    supplies,
    books: supplies, // temporary compatibility with cloned book-details.js
  };
}

function buildView(row, rowsById, suppliesByTarget) {
  const sections = [];

  const ownSupplies = suppliesByTarget[row.id] || [];
  if (ownSupplies.length) {
    sections.push(makeSection(row, ownSupplies));
  }

  const topicIds = splitCsv(row.Topic_ID_App).map(normalizeSortId);

  for (const topicId of topicIds) {
    const topic = rowsById.get(topicId);
    if (!topic) continue;

    const topicSupplies = suppliesByTarget[topicId] || [];
    if (!topicSupplies.length) continue;

    sections.push({
      title: topic.title || "Untitled topic",
      type: "topic",
      supplies: topicSupplies,
      books: topicSupplies, // temporary compatibility with cloned book-details.js
    });
  }

  const supplyCount = sections.reduce(
    (sum, section) => sum + (section.supplies?.length || 0),
    0
  );

  return {
    view: "course",
    id: row.id,
    recordID: row.recordID || "",
    title: row.title || "Untitled",
    subject: row.subject || "",
    gradeText: row.gradeText || "",
    gradeTags: itemGradeTags(row),
    schedText: row.schedText || "",
    shared: row.shared || "",
    sortId: row.id,
    supplyCount,
    bookCount: supplyCount, // temporary compatibility with cloned book-details.js
    sections,
  };
}

function combineViews(view, id, title, rows) {
  const items = rows.filter((row) => row.supplyCount > 0);

  const supplyCount = items.reduce((sum, item) => sum + item.supplyCount, 0);

  return {
    view,
    id,
    title,
    supplyCount,
    bookCount: supplyCount, // temporary compatibility with cloned book-details.js
    items,
  };
}

function combineGroupedViews(view, id, title, groups) {
  const normalizedGroups = groups
    .map((group) => {
      const viewData = combineViews(view, group.id, group.label, group.rows);
      return {
        id: group.id,
        label: group.label,
        supplyCount: viewData.supplyCount,
        bookCount: viewData.supplyCount,
        items: viewData.items,
      };
    })
    .filter((group) => group.supplyCount > 0);

  const supplyCount = normalizedGroups.reduce(
    (sum, group) => sum + group.supplyCount,
    0
  );

  return {
    view,
    id,
    title,
    supplyCount,
    bookCount: supplyCount,
    groups: normalizedGroups,
  };
}

async function main() {
  const coursesJson = await readJson(COURSES_PATH);
  const suppliesJson = await readJson(SUPPLIES_PATH);

  const groups = normalizeGroups(coursesJson);
  const rows = flattenCourses(groups);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const supplies = Array.isArray(suppliesJson)
    ? suppliesJson
    : suppliesJson?.supplies || [];

  const suppliesByTarget = buildSuppliesByTarget(supplies);

  const courseViews = rows
    .map((row) => buildView(row, rowsById, suppliesByTarget))
    .filter((view) => view.supplyCount > 0);

  await fs.rm(OUT_DIR, { recursive: true, force: true });

  for (const view of courseViews) {
    await writeJson(path.join(OUT_DIR, "course", `${view.id}.json`), view);
  }

  await writeJson(
    path.join(OUT_DIR, "master.json"),
    combineViews("master", "master", "All Supplies", courseViews)
  );

  await writeJson(
    path.join(OUT_DIR, "by-grade.json"),
    combineGroupedViews(
      "by-grade",
      "by-grade",
      "Supplies by Grade",
      GRADE_CODES.map((grade) => ({
        id: grade,
        label: `Grade ${grade.replace("G", "")}`,
        rows: courseViews.filter((view) => gradeMatches(view, grade)),
      }))
    )
  );

  await writeJson(
    path.join(OUT_DIR, "by-subject.json"),
    combineGroupedViews(
      "by-subject",
      "by-subject",
      "Supplies by Subject",
      SUBJECT_ORDER.map((subject) => ({
        id: subjectSlug(subject),
        label: subject,
        rows: courseViews.filter((view) => view.subject === subject),
      }))
    )
  );

  for (const grade of GRADE_CODES) {
    const rowsForGrade = courseViews.filter((view) => gradeMatches(view, grade));
    await writeJson(
      path.join(OUT_DIR, "grade", `${grade}.json`),
      combineViews("grade", grade, `Grade ${grade.replace("G", "")} Supplies`, rowsForGrade)
    );
  }

  const subjects = new Set(courseViews.map((view) => view.subject).filter(Boolean));

  for (const subject of subjects) {
    const rowsForSubject = courseViews.filter((view) => view.subject === subject);
    await writeJson(
      path.join(OUT_DIR, "subject", `${subjectSlug(subject)}.json`),
      combineViews("subject", subject, `${subject} Supplies`, rowsForSubject)
    );
  }

  console.log("[supply views] courses:", courseViews.length);
  console.log("[supply views] supplies:", supplies.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
