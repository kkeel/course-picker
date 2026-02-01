/**
 * Build data/MA_Scheduling.json from Airtable (MA_Scheduling table)
 * Location: tools/build-scheduling-from-airtable.mjs
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==============================
// ENV
// ==============================
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ROTATION_RAW = process.env.ROTATION || "R3";

// normalize ROTATION to "R#"
const ROTATION = /^R\d+$/i.test(ROTATION_RAW)
  ? ROTATION_RAW.toUpperCase()
  : `R${String(ROTATION_RAW).replace(/\D/g, "") || "3"}`;

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  throw new Error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID");
}

// ==============================
// CONFIG
// ==============================
const TABLE_NAME = "MA_Scheduling";
const VIEW_NAME = `${ROTATION} – Scheduling JSON`;
const OUTPUT_PATH = path.resolve(__dirname, "../data/MA_Scheduling.json");

// ==============================
// FETCH HELPERS
// ==============================
async function fetchAllRecords() {
  const records = [];
  let offset;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
        TABLE_NAME
      )}`
    );
    url.searchParams.set("view", VIEW_NAME);
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable error ${res.status}: ${text}`);
    }

    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

// ==============================
// TRANSFORM
// ==============================
function numOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function transformRecord(record) {
  const f = record.fields || {};

  // These field names match what you showed in Airtable screenshots.
  // If any are slightly different, change ONLY the key strings here.
  const courseOrTopicId = f.Course_RecordID || f.Topic_RecordID || null;

  return {
    // record IDs
    schedulingRecordId: record.id,
    courseOrTopicId,
    type: f.Type || null, // "C" or "T"

    // display
    title: f.Schedule_CARD || f.Course_Topic_Title || "",
    subject: f.Subject || null,

    // schedule logic
    timesPerWeek: numOrNull(f["WK.+"] ?? f["WK"]),
    minutes: numOrNull(f["MIN.+"] ?? f["MIN"]),
    termTracking: numOrNull(f.Term_Tracking) ?? 12,

    // variant grouping (only meaningful when there are multiple rows per course/topic)
    isVariant: Boolean(f.isVariant),
    variantKey: f.variantKey || null,
    variantSort: numOrNull(f.variantSort) ?? numOrNull(f["MIN"]) ?? 0,

    // grade-band (choice cards)
    gradeBandKey: f.gradeBandKey || null,
    gradeBandSort: numOrNull(f.gradeBandSort),
    gradeMin: numOrNull(f.grade_min),
    gradeMax: numOrNull(f.grade_max),
    gradeNote: f["(Opt.) +Grade Note"] || null,

    // text helpers
    schedulingInfoText: f.Scheduling_Info_TextONLY || null,
    cardText: f.Card_Text || null,

    rotation: ROTATION,
  };
}

// ==============================
// BUILD
// ==============================
async function build() {
  console.log(`Fetching ${TABLE_NAME} (${VIEW_NAME})…`);
  const records = await fetchAllRecords();
  console.log(`Fetched ${records.length} records`);

  const data = records.map(transformRecord);

  // stable ordering for diffs
  data.sort((a, b) => {
    const aid = a.courseOrTopicId || "";
    const bid = b.courseOrTopicId || "";
    if (aid !== bid) return aid.localeCompare(bid);

    // If variantSort ties, fall back to record id
    const vs = (a.variantSort || 0) - (b.variantSort || 0);
    if (vs !== 0) return vs;

    return (a.schedulingRecordId || "").localeCompare(b.schedulingRecordId || "");
  });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
