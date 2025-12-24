// tools/build-resources-from-airtable.mjs
//
// Build MA_Resources.json directly from Airtable view:
//   MA_Resources / "R3 – Resources JSON"
//
// Usage:
// AIRTABLE_PAT=xxx AIRTABLE_BASE_ID=xxx ROTATION=3 node tools/build-resources-from-airtable.mjs

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

const TABLE = "MA_Resources";
const VIEW  = `R${ROTATION} – Resources JSON`;

function asString(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(asString).filter(Boolean).join(", ");
  if (typeof v === "object") return v.name ?? v.id ?? "";
  return String(v);
}

function asBool(v) {
  // Airtable checkbox usually returns true/false
  if (v === true) return true;
  if (v === false) return false;
  const s = asString(v).trim();
  return s === "✔" || s === "✔️" || s.toLowerCase() === "true";
}

function asIdArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v
      .map(x => (typeof x === "object" ? x.id : String(x)))
      .map(s => (s || "").trim())
      .filter(Boolean);
  }
  return String(v)
    .split(/[,;\n]+/)
    .map(x => x.trim())
    .filter(Boolean);
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

async function main() {
  const recs = await fetchAll(TABLE, VIEW);

  const resources = recs.map((rec) => {
    const f = rec.fields || {};
    const resourceId = asString(f["resourceID"]).trim() || rec.id;

    return {
      resourceId,
      title: asString(f["Title"]).trim(),
      author: asString(f["Author"]).trim(),
      isbnAsin: asString(f["ISBN-ASIN"]).trim(),

      resourceTagText: asString(f["Resource Tag Text"]).trim(),

      links: [
        {
          text: asString(f["Link Text 1"]).trim(),
          url:  asString(f["URL 1"]).trim()
        },
        {
          text: asString(f["Link Text 2"]).trim(),
          url:  asString(f["URL 2"]).trim()
        }
      ].filter(x => x.text || x.url),

      flags: {
        save:      asBool(f["SAVE"]),
        print:     asBool(f["PRINT"]),
        reference: asBool(f["REFERENCE"]),
        optional:  asBool(f["OPTIONAL"])
      },

      discount: {
        text: asString(f["DISCOUNT:"]).trim(),
        code: asString(f["with code"]).trim()
      },

      maySub:    asString(f["→ May sub"]).trim(),
      rationale: asString(f["→ RATIONALE"]).trim(),
      note:      asString(f["NOTE:"]).trim(),

      assignmentIdsR3: asIdArray(f["assignmentID_R3"]),
      imageViewLink:   asString(f["Image_ViewLink"]).trim(),
      bookEditUrl:     asString(f["Edit_BookListURL"])
    };
  });

  resources.sort((a,b) => (a.title || "").localeCompare(b.title || ""));

  const payload = {
    lastUpdated: new Date().toISOString(),
    rotation: `R${ROTATION}`,
    resources
  };

  const outPath = path.join(__dirname, "..", "data", "MA_Resources.json");
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath} (${resources.length} resources)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

