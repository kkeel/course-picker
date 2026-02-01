/**
 * Build MA_Scheduling.json from Airtable
 * Location: tools/build-scheduling-from-airtable.mjs
 *
 * Uses native fetch (Node 18+/20)
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==============================
// ENV
// ==============================
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  throw new Error("Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID");
}

// ==============================
// CONFIG
// ==============================
const TABLE_NAME = "MA_Scheduling";
const VIEW_NAME = "R3 – Scheduling JSON";

// where the JSON will live (match your other builders)
const OUTPUT_PATH = path.resolve(
  __dirname,
  "../data/MA_Scheduling.json"
);

// ==============================
// FETCH HELPERS
// ==============================
async function fetchAllRecords() {
  let records = [];
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
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable error ${res.status}: ${text}`);
    }

    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

// ==============================
// TRANSFORM
// ==============================
function transformRecord(record) {
  const f = record.fields;

  return {
    // stable IDs
    schedulingRecordId: record.id,
    courseOrTopicId:
      f.Course_RecordID ||
      f.Topic_RecordID ||
      null,

    type: f.Type || null, // "C" | "T"

    // display
    title: f.Schedule_CARD || f.Course_Topic_Title || "",
    subject: f.Subject || null,

    // schedule logic
    timesPerWeek: f["WK.+"]
      ? Number(f["WK.+"])
      : f["WK"]
      ? Number(f["WK"])
      : null,

    minutes: f["MIN.+"]
      ? Number(f["MIN.+"])
      : f["MIN"]
      ? Number(f["MIN"])
      : null,

    termTracking: f.Term_Tracking ?? 12,

    // variant handling
    isVariant: Boolean(f.isVariant),
    variantKey: f.variantKey || record.id,
    variantSort:
      f.variantSort !== undefined
        ? Number(f.variantSort)
        : f["MIN"]
        ? Number(f["MIN"])
        : 0,

    // grade-band (choice cards only)
    gradeBandKey: f.gradeBandKey || null,
    gradeBandSort:
      f.gradeBandSort !== undefined
        ? Number(f.gradeBandSort)
        : null,
    gradeMin:
      f.grade_min !== undefined ? Number(f.grade_min) : null,
    gradeMax:
      f.grade_max !== undefined ? Number(f.grade_max) : null,

    gradeNote: f["(Opt.) +Grade Note"] || null,

    // metadata / UI text
    schedulingInfoText: f.Scheduling_Info_TextONLY || null,
    cardText: f.Card_Text || null,

    // rotation
    rotation: "R3",
  };
}

// ==============================
// BUILD
// ==============================
async function build() {
  console.log("Fetching MA_Scheduling records…");
  const records = await fetchAllRecords();

  console.log(`Fetched ${records.length} records`);

  const data = records.map(transformRecord);

  // stable ordering for git diffs
  data.sort((a, b) => {
    if (a.courseOrTopicId !== b.courseOrTopicId) {
      return (a.courseOrTopicId || "").localeCompare(
        b.courseOrTopicId || ""
      );
    }
    return (a.variantSort || 0) - (b.variantSort || 0);
  });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  console.log(`Wrote ${OUTPUT_PATH}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
