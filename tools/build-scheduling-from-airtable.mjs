// tools/build-scheduling-from-airtable.mjs
// Build data/MA_Scheduling.json from Airtable
// Robust against lookup/array field values + view name differences.

import fs from "node:fs";
import path from "node:path";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ROTATION = process.env.ROTATION || "R3";

// If provided, we use this exact view name.
// If not provided, we try common variants automatically.
const AIRTABLE_VIEW = (process.env.AIRTABLE_VIEW || "").trim();

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  throw new Error("Missing AIRTABLE_PAT (or AIRTABLE_API_KEY) or AIRTABLE_BASE_ID");
}

const TABLE_NAME = "MA_Scheduling";
const API_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
  TABLE_NAME
)}`;

// ---------- helpers ----------
function asFirst(v) {
  if (Array.isArray(v)) return v.length ? v[0] : null;
  return v ?? null;
}

function asString(v) {
  const x = asFirst(v);
  if (x === null || x === undefined) return "";
  return String(x);
}

function asNumber(v, fallback = 0) {
  const x = asFirst(v);
  if (x === null || x === undefined || x === "") return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function asBool01(v) {
  const x = asFirst(v);
  if (x === true || x === 1 || x === "1" || x === "TRUE" || x === "true") return 1;
  return 0;
}

function asList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  // sometimes rollups come back as comma-separated text depending on Airtable config
  return String(v).split(",").map(s => s.trim()).filter(Boolean);
}

function isViewNotFoundError(text) {
  // Airtable returns JSON like:
  // {"error":{"type":"VIEW_NAME_NOT_FOUND","message":"View ... not found"}}
  return /VIEW_NAME_NOT_FOUND/.test(text);
}

function candidateViews() {
  // EN DASH: –  | EM DASH: — | HYPHEN: -
  const en = "–";
  const em = "—";
  const hy = "-";

  const base = "Scheduling JSON";

  // Most likely: `${ROTATION} – Scheduling JSON` (your intended)
  const mostLikely = `${ROTATION} ${en} ${base}`;

  const candidates = [
    AIRTABLE_VIEW, // if set, try it first
    mostLikely,
    `${ROTATION} ${hy} ${base}`,
    `${ROTATION} ${em} ${base}`,
    `${ROTATION}–${base}`,
    `${ROTATION}-${base}`,
    `${ROTATION}—${base}`,
  ].filter(Boolean);

  // de-dupe while preserving order
  return [...new Set(candidates)];
}

// ---------- Airtable fetch ----------
async function fetchAllRecordsForView(viewName) {
  let all = [];
  let offset = null;

  do {
    const url = new URL(API_BASE);
    url.searchParams.set("view", viewName);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    });

    if (!res.ok) {
      const text = await res.text();
      // bubble this up; caller may choose to retry with a different view
      const err = new Error(`Airtable API error ${res.status}: ${text}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }

    const data = await res.json();
    all.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);

  return all;
}

async function fetchAllRecords() {
  const views = candidateViews();
  let lastErr = null;

  for (const viewName of views) {
    try {
      console.log(`Trying view: "${viewName}"`);
      const records = await fetchAllRecordsForView(viewName);
      console.log(`Using view: "${viewName}"`);
      return { records, viewName };
    } catch (err) {
      lastErr = err;

      // If it's a view-not-found 422, try next candidate
      if (err.status === 422 && isViewNotFoundError(err.body || "")) {
        console.log(`View not found: "${viewName}" — trying next...`);
        continue;
      }

      // Other errors should stop immediately (bad token, permissions, etc.)
      throw err;
    }
  }

  // If we exhausted all candidates:
  throw new Error(
    `No matching Airtable view found. Tried:\n- ${views.join("\n- ")}\n\nLast error: ${
      lastErr?.message || "unknown"
    }`
  );
}

// ---------- transform ----------
function transformRecord(record) {
  const f = record.fields || {};

  return {
    // identifiers
    scheduleRecordId: record.id,

    // IMPORTANT: string for grouping + sorting
    courseOrTopicId: asString(f.Source_ID),

    // metadata
    sourceKind: asString(f.Source_Kind), // "Course" | "Topic"
    subject: asString(f.Subject),
    title: asString(f["Course/Topic_Title"]),
    scheduleCard: asString(f.Schedule_CARD),

    // scheduling stats
    min: asNumber(f.MIN, 0),
    wk: asNumber(f.WK, 0),
    termTracking: asNumber(f.Term_Tracking, 12),

    // flags
    isVariant: asBool01(f.isVariant),

    // optional helpers
    variantKey: asString(f.variantKey),
    variantSort: asNumber(f.variantSort, 0),

    gradeBandKey: asString(f.gradeBandKey),
    gradeBandSort: asNumber(f.gradeBandSort, 0),
    grade_min: asNumber(f.grade_min, 0),
    grade_max: asNumber(f.grade_max, 0),

    gradeFilter: asList(f.Grade_Filter),

    gradeNote: asString(f["(Opt.) +Grade Note"]),
    cardText: asString(f.Card_Text),

    // passthroughs (if you want them; safe even if blank)
    teach: asString(f.TEACH),
    type: asString(f.Type),
    sort: asString(f.Sort),
  };
}

function safeCompare(a, b) {
  const aid = asString(a.courseOrTopicId);
  const bid = asString(b.courseOrTopicId);
  let cmp = aid.localeCompare(bid);
  if (cmp) return cmp;

  // Keep together: variants first (optional preference)
  cmp = (b.isVariant || 0) - (a.isVariant || 0);
  if (cmp) return cmp;

  // Choices: grade band order
  cmp = (a.gradeBandSort || 0) - (b.gradeBandSort || 0);
  if (cmp) return cmp;

  // Variants: variant order
  cmp = (a.variantSort || 0) - (b.variantSort || 0);
  if (cmp) return cmp;

  // Minutes then title
  cmp = (a.min || 0) - (b.min || 0);
  if (cmp) return cmp;

  return asString(a.title).localeCompare(asString(b.title));
}

// ---------- main ----------
async function main() {
  console.log(`Fetching ${TABLE_NAME}...`);
  const { records, viewName } = await fetchAllRecords();
  console.log(`Fetched ${records.length} records from "${viewName}"`);

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
