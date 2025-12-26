// tools/build-assignments-from-airtable.mjs
//
// Build MA_Assignments.json directly from Airtable view:
//   MA_Assignments / "R3 – Assignments JSON"
//
// Usage:
// AIRTABLE_PAT=xxx AIRTABLE_BASE_ID=xxx ROTATION=3 node tools/build-assignments-from-airtable.mjs

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const AIRTABLE_PAT     = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ROTATION         = process.env.ROTATION || "3";

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.error("ERROR: Missing AIRTABLE_PAT or AIRTABLE_BASE_ID");
  process.exit(1);
}

const API = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

const TABLE = "MA_Assignments";
const VIEW  = `R${ROTATION} – Assignments JSON`;

function asString(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(asString).filter(Boolean).join(", ");
  if (typeof v === "object") return v.name ?? v.id ?? "";
  return String(v);
}

function asIdArray(v) {
  // Handles:
  // - Airtable linked record arrays: [{id,name},...]
  // - Lookup/rollup arrays: ["rec...", "rec..."]
  // - Comma-separated string: "recA, recB,"
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v
      .map(x => (typeof x === "object" ? x.id : String(x)))
      .map(s => (s || "").trim())
      .filter(Boolean);
  }
  const s = String(v);
  return s
    .split(/[,;\n]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

function parseGrades(gradeText) {
  // "G5, G6, G7, G8," => [5,6,7,8]
  const out = [];
  const s = gradeText || "";
  const re = /G(\d{1,2})/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push(Number(m[1]));
  }
  return Array.from(new Set(out)).sort((a,b)=>a-b);
}

function parseTerms(scopeText) {
  // Looks for "Term 1", "Term 2", "Term 3" in the multiline scope text
  const s = scopeText || "";
  const terms = [];
  if (s.includes("Term 1")) terms.push("T1");
  if (s.includes("Term 2")) terms.push("T2");
  if (s.includes("Term 3")) terms.push("T3");
  return terms;
}

function splitLines(text) {
  const s = (text || "").trim();
  if (!s) return [];
  return s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

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
      const body = await res.text().catch(() => "");
      throw new Error(`Airtable fetch failed ${res.status}: ${body}`);
    }

    const json = await res.json();
    out.push(...(json.records || []));
    offset = json.offset;
  } while (offset);

  return out;
}

function toAssignmentRows(rec) {
  const f = rec.fields || {};

  // These might come back as single values or arrays if someone accidentally links multiple.
  const assignmentIds = asIdArray(f["assignmentsID"]).length ? asIdArray(f["assignmentsID"]) : [rec.id];
  const targetIds     = asIdArray(f["targetID"]);
  const resourceIds   = asIdArray(f["resourceID"]);

  const targetTypeRaw = asString(f["C/T"]).trim().toUpperCase();
  const targetType = targetTypeRaw === "T" ? "topic" : "course"; // default course

  const scopeText  = asString(f["Scope"]);
  const gradeText  = asString(f["Grade_Filter"]);
  const sharedText = asString(f["Shared_RollUp_Rotation 3"]);
  const editUrl    = asString(f["Edit_ResourceAssignmentsURL(R3)"]);

  const base = {
    rotation: `R${ROTATION}`,
    targetType,
    resourceKey: asString(f["Resource_Key"]).trim(),

    scopeText,
    terms: parseTerms(scopeText),

    termNotes: {
      T1: asString(f["Assignments_T1"]).trim() || "",
      T2: asString(f["Assignments_T2"]).trim() || "",
      T3: asString(f["Assignments_T3"]).trim() || ""
    },

    gradeText,
    grades: parseGrades(gradeText),

    gradeLevelTag: asString(f["Grade Level Tag"]).trim(),

    sharedTextR3: sharedText,
    sharedLinesR3: splitLines(sharedText),

    editUrl
  };

  // Explode rows if multiple targets/resources were attached by mistake.
  // We produce one assignment row per (targetId, resourceId) pair.
  const rows = [];

  const aid = assignmentIds[0] || rec.id;

  const tIds = targetIds.length ? targetIds : [""];
  const rIds = resourceIds.length ? resourceIds : [""];

  for (const targetId of tIds) {
    for (const resourceId of rIds) {
      if (!targetId || !resourceId) continue;

      rows.push({
        assignmentId: aid,
        targetId,
        resourceId,
        ...base
      });
    }
  }

  return rows;
}

async function main() {
  const recs = await fetchAll(TABLE, VIEW);

  const assignments = [];
  for (const rec of recs) {
    assignments.push(...toAssignmentRows(rec));
  }

  // Sort: targetId then resourceKey then resourceId (stable)
  assignments.sort((a,b) => {
    if (a.targetId !== b.targetId) return a.targetId.localeCompare(b.targetId);
    if (a.resourceKey !== b.resourceKey) return (a.resourceKey || "").localeCompare(b.resourceKey || "");
    return a.resourceId.localeCompare(b.resourceId);
  });

  const payload = {
    lastUpdated: new Date().toISOString(),
    rotation: `R${ROTATION}`,
    assignments
  };

  const outPath = path.join(__dirname, "..", "data", "MA_Assignments.json");
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath} (${assignments.length} rows)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
