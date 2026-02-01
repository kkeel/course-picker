// tools/build-scheduling-from-airtable.mjs
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

// Update these two to match your Airtable
const TABLE_NAME = "MA_Scheduling";
const VIEW_NAME = "R3 – Scheduling JSON";

if (!AIRTABLE_API_KEY) throw new Error("Missing AIRTABLE_API_KEY");
if (!AIRTABLE_BASE_ID) throw new Error("Missing AIRTABLE_BASE_ID");

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;

async function fetchAllFromView(viewName) {
  let records = [];
  let offset = undefined;

  while (true) {
    const url = new URL(AIRTABLE_URL);
    url.searchParams.set("view", viewName);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable fetch failed: ${res.status} ${text}`);
    }

    const json = await res.json();
    records.push(...(json.records || []));
    if (!json.offset) break;
    offset = json.offset;
  }

  return records;
}

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asString(v, fallback = "") {
  return (v === null || v === undefined) ? fallback : String(v);
}

function buildTitle(fields) {
  // Prefer explicit fields if you have them; fall back gracefully.
  const base = asString(fields["Course/Topic_Title"] || fields["CourseTopic_Title"] || fields["Title"]);
  const gradeNote = asString(fields["Grade_Note"] || fields["(Opt.) +Grade Note"] || fields["Grade Note"]);
  if (base && gradeNote) return `${base}: ${gradeNote}`;
  return base || "Schedule Card";
}

function buildCourseKey(fields) {
  // You should feed this from your MA_Scheduling formula/lookup field:
  // e.g. CourseTopic_RecordID that points to the linked Course or Topic record id.
  return asString(fields["CourseTopic_RecordID"] || fields["Course/Topic_RecordID"] || fields["CourseTopicID"] || "");
}

function isTrue(v) {
  return v === true || v === "true" || v === "TRUE" || v === 1 || v === "1";
}

async function build() {
  console.log("Fetching MA_Scheduling…");
  const records = await fetchAllFromView(VIEW_NAME);

  const cards = records.map((r) => {
    const f = r.fields || {};

    const recId = r.id; // Airtable record id of MA_Scheduling
    const courseKey = buildCourseKey(f);

    const gradeBandKey = asString(f["gradeBandKey"] || "");
    const gradeBandSort = asNumber(f["gradeBandSort"], 0);

    const minutes = asNumber(f["MIN"] ?? f["Min"] ?? f["Minutes"], 0);
    const weeklyTarget = asNumber(f["WK"] ?? f["Wk"] ?? f["Times/Week"], 0);

    const trackingCount = asNumber(f["Term_Tracking"] ?? f["Tracking"] ?? f["trackingCount"], 12);

    const isVariant = isTrue(f["isVarient"] || f["isVariant"]); // spelling as in your screenshot

    const obj = {
      id: recId,
      // sortKey controls rail ordering; use whatever you already use for ordering in Airtable
      sortKey: asString(f["Sort"] || f["sortKey"] || f["Schedule_CARD"] || f["Schedule_CARD_byCourse"] || recId),

      // used to attach schedule rules to the right course/topic later:
      courseKey,
      courseLabel: asString(f["Subject"] || f["courseLabel"] || ""), // optional
      title: buildTitle(f),

      minutes,
      symbols: asString(f["Card_Text"] || f["symbols"] || ""),
      trackingCount,
      weeklyTarget,

      // Variant fields (only meaningful for “true variants”)
      variantKey: "",
      variantSort: 0,

      meta: {},
    };

    // Choice / grade-band option
    if (gradeBandKey) {
      obj.meta = {
        choiceGroup: "gradeBand",
        choiceOption: gradeBandKey,
        choiceOptionLabel: asString(f["Grade_Note"] || f["(Opt.) +Grade Note"] || ""),
      };
      obj.gradeMin = asNumber(f["grade_min"], 0);
      obj.gradeMax = asNumber(f["grade_max"], 0);
      obj.gradeBandSort = gradeBandSort;
    }
    // True variant (multiple schedule cards per same course/topic)
    else if (isVariant) {
      obj.variantKey = recId;
      obj.variantSort = asNumber(f["varientSort"] || f["variantSort"] || minutes, minutes);
    }

    return obj;
  });

  // Deterministic ordering in the JSON (helps diffs + stability)
  cards.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));

  const outPath = path.join(__dirname, "..", "data", "MA_Scheduling.json");
  await fs.writeFile(outPath, JSON.stringify(cards, null, 2), "utf8");

  console.log("✓ Done!");
  console.log("Written:", outPath);
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
