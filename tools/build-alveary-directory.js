// tools/build-alveary-directory.js
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const DATA_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(DATA_DIR, "book-views");

const COURSES_PATH = path.join(DATA_DIR, "MA_Courses.json");
const BOOKLIST_COURSES_PATH = path.join(DATA_DIR, "MA_BookList_Courses.json");
const ASSIGNMENTS_PATH = path.join(DATA_DIR, "MA_Assignments.json");
const RESOURCES_PATH = path.join(DATA_DIR, "MA_Resources.json");

const INCLUDE_PURCHASE_LINKS =
  String(process.env.INCLUDE_PURCHASE_LINKS || "").toLowerCase() === "true";

const SUBJECT_ORDER = [
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
  "Suggested Resources",
];

const GRADE_CODES = Array.from({ length: 12 }, (_, i) => `G${i + 1}`);

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeGroups(raw) {
  return raw?.coursesBySubject || raw?.bySubject || raw?.subjects || raw || {};
}

function safeId(value) {
  return String(value || "").trim();
}

function subjectSlug(subject) {
  return String(subject || "Other")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "other";
}

function sortBySortId(a, b) {
  return String(a.sortId || "").localeCompare(String(b.sortId || ""));
}

function courseTitle(course) {
  return (
    course?.lessonSetName ||
    course?.course_title ||
    course?.title ||
    course?.Course ||
    "Untitled course"
  );
}

function topicTitle(topic) {
  return (
    topic?.lessonSetName ||
    topic?.Topic ||
    topic?.title ||
    "Untitled topic"
  );
}

function itemGradeTags(item) {
  const tags =
    item?.gradeTags ||
    item?.Grade_Tags ||
    item?.grades ||
    item?.gradeCodes ||
    [];

  return Array.isArray(tags) ? tags.map(String) : [];
}

function gradeMatches(item, gradeCode) {
  const tags = itemGradeTags(item);
  if (tags.includes(gradeCode)) return true;

  // fallback for text like "GRADE(S): 3" or "GRADE(S): 4-6"
  const n = Number(String(gradeCode).replace(/^G/i, ""));
  const text = String(item?.gradeText || item?.Grade_Text || "").toUpperCase();

  if (!text) return false;

  const ranges = text.match(/\d+\s*-\s*\d+|\d+/g) || [];
  return ranges.some((part) => {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => Number(x.trim()));
      return n >= a && n <= b;
    }
    return Number(part) === n;
  });
}

function mergeCourseGroups(baseGroups, extraGroups) {
  const merged = {};

  for (const [subject, courses] of Object.entries(baseGroups || {})) {
    merged[subject] = Array.isArray(courses) ? [...courses] : [];
  }

  for (const [subject, courses] of Object.entries(extraGroups || {})) {
    if (!merged[subject]) merged[subject] = [];
    merged[subject].push(...(Array.isArray(courses) ? courses : []));
  }

  const ordered = {};
  const seen = new Set();

  for (const subject of SUBJECT_ORDER) {
    if (Object.prototype.hasOwnProperty.call(merged, subject)) {
      ordered[subject] = merged[subject];
      seen.add(subject);
    }
  }

  for (const subject of Object.keys(merged)) {
    if (!seen.has(subject)) ordered[subject] = merged[subject];
  }

  return ordered;
}

function buildResourcesById(resourcesJson) {
  const out = {};
  for (const resource of resourcesJson?.resources || []) {
    const id = safeId(resource?.resourceId || resource?.id || resource?.recordID);
    if (!id) continue;
    out[id] = resource;
  }
  return out;
}

function buildAssignmentsByTarget(assignmentsJson) {
  const out = {};

  for (const assignment of assignmentsJson?.assignments || []) {
    const targetId = safeId(assignment?.targetId);
    const resourceId = safeId(assignment?.resourceId);

    if (!targetId || !resourceId) continue;

    const clean = {
      ...assignment,
      targetId,
      resourceId,
    };

    if (!out[targetId]) out[targetId] = [];
    out[targetId].push(clean);
  }

  for (const targetId of Object.keys(out)) {
    out[targetId].sort((a, b) => {
      const ak = String(a.resourceKey || "");
      const bk = String(b.resourceKey || "");
      if (ak !== bk) return ak.localeCompare(bk);
      return String(a.resourceId).localeCompare(String(b.resourceId));
    });
  }

  return out;
}

function parseIsbnAsin(value) {
  const text = String(value || "").trim();
  if (!text) return { isbn: "", asin: "" };

  if (/asin/i.test(text)) return { isbn: "", asin: text.replace(/asin\s*[:#-]?\s*/i, "").trim() };
  return { isbn: text.replace(/isbn\s*[:#-]?\s*/i, "").trim(), asin: "" };
}

function formatOptionsFromTagText(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  return raw
    .split(/[,;/|]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((label) => {
      const key = label.toLowerCase();
      let type = "other";
      if (key.includes("audio")) type = "audiobook";
      else if (key.includes("ebook") || key.includes("e-book")) type = "ebook";
      else if (key.includes("video")) type = "video";

      return { type, label };
    });
}

function publicPurchaseOptions(resource) {
  return (resource?.links || []).map((link, index) => ({
    label: link.text || `Option ${index + 1}`,
    url: INCLUDE_PURCHASE_LINKS ? link.url || "" : "",
    memberOnly: Boolean(link.memberOnly),
    memberstackId: link.memberstackId || "",
  }));
}

function discountText(resource) {
  const discount = resource?.discount || {};
  const pieces = [];

  if (discount.text) pieces.push(`Discount: ${discount.text}`);
  if (discount.code) pieces.push(`With code: ${discount.code}`);

  return pieces.join("\n");
}

function publicResource(resource, assignment, context) {
  const resourceId = safeId(assignment?.resourceId);
  const title = resource?.title || resource?.Resource_Title || "Untitled book";
  const isbnAsin = parseIsbnAsin(resource?.isbnAsin || resource?.isbn || resource?.ISBN || "");

  return {
    resourceId,
    instanceKey: context.topicId
      ? `course:${context.courseId}:topic:${context.topicId}:resource:${resourceId}`
      : `course:${context.courseId}:resource:${resourceId}`,

    title,
    author: resource?.author || resource?.Author || "",

    isbn: resource?.isbn || resource?.ISBN || isbnAsin.isbn || "",
    asin: resource?.asin || resource?.ASIN || isbnAsin.asin || "",
    isbnAsin: resource?.isbnAsin || "",

    imagePath: `img/resources/${resourceId}.webp`,
    placeholderPath: "img/placeholders/book.svg",

    optional: Boolean(assignment?.optional || resource?.flags?.optional),
    chooseOne: Boolean(resource?.flags?.chooseOne),
    gradeLevelTag: assignment?.gradeLevelTag || "",

    formatTags: resource?.resourceTagText || "",
    formatOptions: formatOptionsFromTagText(resource?.resourceTagText),

    rationale: resource?.rationale || "",
    noteText: resource?.note || "",
    maySubText: resource?.maySub || "",
    discountText: discountText(resource),

    scopeText: assignment?.scopeText || "",
    sharedText: Array.isArray(assignment?.sharedLinesR3)
      ? assignment.sharedLinesR3.join("\n")
      : assignment?.sharedTextR3 || "",

    purchaseOptions: publicPurchaseOptions(resource),
  };
}

function booksForTarget(targetId, assignmentsByTarget, resourcesById, context) {
  const assignments = assignmentsByTarget[targetId] || [];

  return assignments
    .map((assignment) => {
      const resource = resourcesById[assignment.resourceId];
      if (!resource) return null;
      return publicResource(resource, assignment, context);
    })
    .filter(Boolean);
}

function directoryCourseRow(course, subject) {
  const id = safeId(course?.recordID || course?.id);
  if (!id) return null;

  return {
    id,
    rowType: "course",
    title: courseTitle(course),
    lessonSetName: courseTitle(course),
    subtitle: course?.subtitle || "",
    gradeText: course?.gradeText || course?.Grade_Text || "",
    gradeTags: itemGradeTags(course),
    subject: subject || course?.subject || "",
    sortId: course?.Sort_ID || course?.sortId || "",
    hasTopics: Array.isArray(course?.topics) && course.topics.length > 0,
    topicIds: (course?.topics || [])
      .map((topic) => safeId(topic?.recordID || topic?.id || topic?.Topic_ID))
      .filter(Boolean),
    bookDetailsUrl: `book-details.html?view=course&id=${encodeURIComponent(id)}`,
  };
}

function directoryTopicRow(topic, course, subject) {
  const id = safeId(topic?.recordID || topic?.id || topic?.Topic_ID);
  if (!id) return null;

  const courseId = safeId(course?.recordID || course?.id);

  return {
    id,
    rowType: "topic",
    title: topicTitle(topic),
    lessonSetName: topicTitle(topic),
    subtitle: topic?.subtitle || "",
    gradeText: topic?.gradeText || topic?.Grade_Text || "",
    gradeTags: itemGradeTags(topic),
    subject: subject || course?.subject || "",
    sortId: topic?.Sort_ID || topic?.sortId || "",
    courseId,
    courseTitle: courseTitle(course),
    courseConnectionNames: [courseTitle(course)],
    bookDetailsUrl: `book-details.html?view=topic&id=${encodeURIComponent(id)}`,
  };
}

function buildBookViewForCourse(course, subject, assignmentsByTarget, resourcesById) {
  const courseId = safeId(course?.recordID || course?.id);
  const courseBooks = booksForTarget(courseId, assignmentsByTarget, resourcesById, {
    courseId,
  });

  const topics = (course?.topics || [])
    .map((topic) => {
      const topicId = safeId(topic?.recordID || topic?.id || topic?.Topic_ID);
      if (!topicId) return null;

      const books = booksForTarget(topicId, assignmentsByTarget, resourcesById, {
        courseId,
        topicId,
      });

      return {
        id: topicId,
        rowType: "topic",
        title: topicTitle(topic),
        gradeText: topic?.gradeText || topic?.Grade_Text || "",
        sortId: topic?.Sort_ID || topic?.sortId || "",
        books,
      };
    })
    .filter(Boolean)
    .filter((topic) => topic.books.length > 0);

  return {
    view: "course",
    id: courseId,
    rowType: "course",
    title: courseTitle(course),
    subject,
    gradeText: course?.gradeText || course?.Grade_Text || "",
    sortId: course?.Sort_ID || course?.sortId || "",
    bookCount:
      courseBooks.length + topics.reduce((sum, topic) => sum + topic.books.length, 0),
    sections: [
      ...(courseBooks.length
        ? [
            {
              type: "course",
              id: courseId,
              title: courseTitle(course),
              books: courseBooks,
            },
          ]
        : []),
      ...topics.map((topic) => ({
        type: "topic",
        id: topic.id,
        title: topic.title,
        books: topic.books,
      })),
    ],
  };
}

function buildBookViewForTopic(topic, course, subject, assignmentsByTarget, resourcesById) {
  const courseId = safeId(course?.recordID || course?.id);
  const topicId = safeId(topic?.recordID || topic?.id || topic?.Topic_ID);

  const books = booksForTarget(topicId, assignmentsByTarget, resourcesById, {
    courseId,
    topicId,
  });

  return {
    view: "topic",
    id: topicId,
    rowType: "topic",
    title: topicTitle(topic),
    subject,
    gradeText: topic?.gradeText || topic?.Grade_Text || "",
    sortId: topic?.Sort_ID || topic?.sortId || "",
    courseId,
    courseTitle: courseTitle(course),
    bookCount: books.length,
    sections: [
      {
        type: "topic",
        id: topicId,
        title: topicTitle(topic),
        books,
      },
    ],
  };
}

function collectCourseViews(groups, assignmentsByTarget, resourcesById) {
  const directoryRows = [];
  const courseViews = [];
  const topicViewsById = new Map();

  for (const [subject, courses] of Object.entries(groups)) {
    for (const course of courses || []) {
      const courseRow = directoryCourseRow(course, subject);
      if (courseRow) directoryRows.push(courseRow);

      const courseView = buildBookViewForCourse(
        course,
        subject,
        assignmentsByTarget,
        resourcesById
      );

      if (courseView.bookCount > 0) courseViews.push(courseView);

      for (const topic of course?.topics || []) {
        const topicRow = directoryTopicRow(topic, course, subject);
        if (topicRow) directoryRows.push(topicRow);

        const topicId = safeId(topic?.recordID || topic?.id || topic?.Topic_ID);
        if (!topicId || topicViewsById.has(topicId)) continue;

        const topicView = buildBookViewForTopic(
          topic,
          course,
          subject,
          assignmentsByTarget,
          resourcesById
        );

        if (topicView.bookCount > 0) topicViewsById.set(topicId, topicView);
      }
    }
  }

  directoryRows.sort(sortBySortId);
  courseViews.sort(sortBySortId);

  return {
    directoryRows,
    courseViews,
    topicViews: Array.from(topicViewsById.values()).sort(sortBySortId),
  };
}

function combineViews(view, id, title, rows) {
  const sections = [];

  for (const row of rows) {
    if (!row?.sections?.length) continue;
    sections.push({
      type: row.rowType,
      id: row.id,
      title: row.title,
      subject: row.subject,
      gradeText: row.gradeText,
      sections: row.sections,
    });
  }

  const bookCount = sections.reduce((sum, item) => {
    return (
      sum +
      item.sections.reduce((inner, section) => inner + (section.books?.length || 0), 0)
    );
  }, 0);

  return {
    view,
    id,
    title,
    bookCount,
    items: sections,
  };
}

async function main() {
  const coursesJson = await readJson(COURSES_PATH);
  const bookListCoursesJson = await readJson(BOOKLIST_COURSES_PATH, {});
  const assignmentsJson = await readJson(ASSIGNMENTS_PATH);
  const resourcesJson = await readJson(RESOURCES_PATH);

  const baseGroups = normalizeGroups(coursesJson);
  const extraGroups = normalizeGroups(bookListCoursesJson);
  const groups = mergeCourseGroups(baseGroups, extraGroups);

  const resourcesById = buildResourcesById(resourcesJson);
  const assignmentsByTarget = buildAssignmentsByTarget(assignmentsJson);

  const { directoryRows, courseViews, topicViews } = collectCourseViews(
    groups,
    assignmentsByTarget,
    resourcesById
  );

  await fs.rm(OUT_DIR, { recursive: true, force: true });

  await writeJson(path.join(DATA_DIR, "alveary-directory-index.json"), {
    title: "Alveary Directory",
    generatedAt: new Date().toISOString(),
    rows: directoryRows,
    views: {
      master: "data/book-views/master.json",
      grades: Object.fromEntries(
        GRADE_CODES.map((grade) => [grade, `data/book-views/grade/${grade}.json`])
      ),
      subjects: Object.fromEntries(
        SUBJECT_ORDER.map((subject) => [
          subject,
          `data/book-views/subject/${subjectSlug(subject)}.json`,
        ])
      ),
    },
  });

  for (const view of courseViews) {
    await writeJson(path.join(OUT_DIR, "course", `${view.id}.json`), view);
  }

  for (const view of topicViews) {
    await writeJson(path.join(OUT_DIR, "topic", `${view.id}.json`), view);
  }

  const allViews = [...courseViews, ...topicViews];

  await writeJson(
    path.join(OUT_DIR, "master.json"),
    combineViews("master", "master", "All Books", courseViews)
  );

  for (const grade of GRADE_CODES) {
    const rows = courseViews.filter((view) => gradeMatches(view, grade));
    await writeJson(
      path.join(OUT_DIR, "grade", `${grade}.json`),
      combineViews("grade", grade, `Grade ${grade.replace("G", "")} Books`, rows)
    );
  }

  const subjects = new Set(allViews.map((view) => view.subject).filter(Boolean));

  for (const subject of subjects) {
    const rows = courseViews.filter((view) => view.subject === subject);
    await writeJson(
      path.join(OUT_DIR, "subject", `${subjectSlug(subject)}.json`),
      combineViews("subject", subject, `${subject} Books`, rows)
    );
  }

  console.log("[directory] rows:", directoryRows.length);
  console.log("[book views] courses:", courseViews.length);
  console.log("[book views] topics:", topicViews.length);
  console.log("[book views] purchase links included:", INCLUDE_PURCHASE_LINKS);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
