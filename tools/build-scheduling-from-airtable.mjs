// tools/build-scheduling-from-airtable.mjs
// Build data/MA_Scheduling.json from Airtable (R* view)
// Robust against lookup/array field values.

import fs from "node:fs";
import path from "node:path";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ROTATION = process.env.ROTATION || "R3";

// Keep this aligned with your Airtable view name
const VIEW_NAME = `${ROTATION} – Scheduling JSON`;

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  throw new Error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID");
}

const TABLE_NAME = "MA_Scheduling";
const API_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
  TABLE_NAME
)}`;

function asFirst(v) {
  // Airtable often returns arrays for lookups/rollups/multi fields
  if (Array.isArray(v)) return v.length ? v[0] : null;
  return v ?? null;
}

function asString(v) {
  const x = asFirst(v);
  if (x === null) return "";
  return String(x);
}

function asNumber(v, fallback = 0) {
  const x = asFirst(v);
  if (x === null || x === "") return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function asBool01(v) {
  const x = asFirst(v);
  // Airtable booleans can arrive as true/false, 1/0, "TRUE"/"FALSE"
  if (x === true || x === 1 || x === "1" || x === "TRUE" || x === "true") return 1;
  return 0;
}

async function fetchAllRecords() {
  let all = [];
  let offset = null;

  do {
    const url = new URL(API_BASE);
    url.searchParams.set("view", VIEW_NAME);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    all.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);

  return all;
}

function transformRecord(record) {
  const f = record.fields || {};

  const out = {
    // identifiers
    scheduleRecordId: record.id,

    // IMPORTANT: this must be a STRING (used for grouping + sorting)
    courseOrTopicId: asString(f.Source_ID),

    // metadata
    sourceKind: asString(f.Source_Kind), // "Course" | "Topic" (your field)
    subject: asString(f.Subject),
    title: asString(f["Course/Topic_Title"]),
    scheduleCard: asString(f.Schedule_CARD),

    // scheduling stats
    min: asNumber(f.MIN, 0),
    wk: asNumber(f.WK, 0),
    termTracking: asNumber(f.Term_Tracking, 12),

    // flags
    isVarient: asBool01(f.isVarient),

    // optional helpers (strings)
    varientKey: asString(f.varientKey),
    varientSort: asNumber(f.varientSort, 0),

    gradeBandKey: asString(f.gradeBandKey),
    gradeBandSort: asNumber(f.gradeBandSort, 0),
    grade_min: asNumber(f.grade_min, 0),
    grade_max: asNumber(f.grade_max, 0),

    gradeNote: asString(f["(Opt.) +Grade Note"]),
    cardText: asString(f.Card_Text),
    teach: asString(f.TEACH),
    type: asString(f.Type),
    sort: asString(f.Sort),
  };

  return out;
}

function safeCompare(a, b) {
  // Primary: course/topic id (string)
  const aid = asString(a.courseOrTopicId);
  const bid = asString(b.courseOrTopicId);
  let cmp = aid.localeCompare(bid);
  if (cmp) return cmp;

  // Then: isVarient (variants first so they stay together if you want)
  cmp = (b.isVarient || 0) - (a.isVarient || 0);
  if (cmp) return cmp;

  // Then: grade-band order (choices)
  cmp = (a.gradeBandSort || 0) - (b.gradeBandSort || 0);
  if (cmp) return cmp;

  // Then: variant order (variants)
  cmp = (a.varientSort || 0) - (b.varientSort || 0);
  if (cmp) return cmp;

  // Finally: minutes, then title
  cmp = (a.min || 0) - (b.min || 0);
  if (cmp) return cmp;

  return asString(a.title).localeCompare(asString(b.title));
}

async function main() {
  console.log(`Fetching ${TABLE_NAME} (${VIEW_NAME})...`);
  const records = await fetchAllRecords();
  console.log(`Fetched ${records.length} records`);

  const out = records.map(transformRecord).sort(safeCompare);

  const outPath = path.join(process.cwd(), "data", "MA_Scheduling.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

  console.log(`Wrote ${out.length} records to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
