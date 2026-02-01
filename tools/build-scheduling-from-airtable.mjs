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
// ENV (match other builders)
// ==============================
// Prefer AIRTABLE_PAT (newer Airtable Personal Access Token), but support legacy AIRTABLE_API_KEY too.
const AIRTABLE_TOKEN = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
  throw new Error("Missing AIRTABLE_PAT (or AIRTABLE_API_KEY) or AIRTABLE_BASE_ID");
}

// ==============================
// CONFIG
// ==============================
const TABLE_NAME = "MA_Scheduling";
const VIEW_NAME = "R3 – Scheduling JSON";

// where the JSON will live (match your other builders)
const OUTPUT_PATH = path.resolve(__dirname, "../data/MA_Scheduling.json");

// ==============================
// FETCH HELPERS
// ==============================
async function fetchAllRecords() {
  let records = [];
  let offset;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}`
    );

    url.searchParams.set("view", VIEW_NAME);
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
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
function toNum(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function transformRecord(record) {
  const f = record.fields || {};

  const minutes =
    f["MIN.+"] !== undefined ? toNum(f["MIN.+"]) :
    f["MIN"] !== undefined ? toNum(f["MIN"]) :
    null;

  return {
    // stable IDs
    schedulingRecordId: record.id,

    courseOrTopicId: f.Course_RecordID || f.Topic_RecordID || null,

    type: f.Type || null, // "C" | "T"

    // display
    title: f.Schedule_CARD || f.Course_Topic_Title || "",
    subject: f.Subject || null,

    // schedule logic
    timesPerWeek:
      f["WK.+"] !== undefined ? toNum(f["WK.+"]) :
      f["WK"] !== undefined ? toNum(f["WK"]) :
      null,

    minutes,

    // tracking (you set this to always be 12, but we still default safely)
    termTracking: f.Term_Tracking ?? 12,

    // variant handling
    isVariant: Boolean(f.isVariant),
    // key: use Airtable field if you set it, else fall back to record.id
    variantKey: f.variantKey || record.id,
    // sort: use Airtable field if you set it, else fall back to minutes, else 0
    variantSort: f.variantSort !== undefined ? toNum(f.variantSort) : (minutes ?? 0),

    // grade-band (choice cards only)
    gradeBandKey: f.gradeBandKey || null,
    gradeBandSort: f.gradeBandSort !== undefined ? toNum(f.gradeBandSort) : null,
    gradeMin: f.grade_min !== undefined ? toNum(f.grade_min) : null,
    gradeMax: f.grade_max !== undefined ? toNum(f.grade_max) : null,
    gradeNote: f["(Opt.) +Grade Note"] || null,
  };
}

// ==============================
// MAIN
// ==============================
async function main() {
  const records = await fetchAllRecords();

  const out = records.map(transformRecord);

  // Optional: stable sort to keep diffs clean
  out.sort((a, b) => {
    // group by course/topic
    const idA = a.courseOrTopicId || "";
    const idB = b.courseOrTopicId || "";
    if (idA !== idB) return idA.localeCompare(idB);

    // then by gradeBandSort (choices)
    const gA = a.gradeBandSort ?? 9999;
    const gB = b.gradeBandSort ?? 9999;
    if (gA !== gB) return gA - gB;

    // then by variantSort
    const vA = a.variantSort ?? 0;
    const vB = b.variantSort ?? 0;
    if (vA !== vB) return vA - vB;

    // then stable by record id
    return (a.schedulingRecordId || "").localeCompare(b.schedulingRecordId || "");
  });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(`✅ Wrote ${out.length} records to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("❌ build-scheduling failed:", err);
  process.exit(1);
});
