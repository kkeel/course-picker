// tools/build-extra-helpings-from-airtable.mjs
//
// Builds:
// - data/extra-helpings/index.json
// - data/extra-helpings/{rotation3RecordId}.json
// - img/extra-helpings/{resourceId}.webp

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ROTATION = process.env.ROTATION || "3";

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.error("ERROR: Missing AIRTABLE_PAT or AIRTABLE_BASE_ID");
  process.exit(1);
}

const API = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

const ROTATION_TABLE = `Rotation_${ROTATION}`;
const ROTATION_VIEW = "Extra Helpings";

const RESOURCES_TABLE = "MA_Resources";
const RESOURCES_VIEW = "Extra Helpings";

const IDEAS_TABLE = "MA_extraHelpings";
const IDEAS_VIEW = "Grid view";

const DATA_DIR = path.join(__dirname, "..", "data", "extra-helpings");
const IMAGE_DIR = path.join(__dirname, "..", "img", "extra-helpings");
const TMP_DIR = path.join(__dirname, "..", ".tmp-extra-helpings-images");
const MANIFEST_PATH = path.join(IMAGE_DIR, `.thumb-manifest-r${ROTATION}.json`);

function asString(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(asString).filter(Boolean).join(", ");
  if (typeof v === "object") return v.name ?? v.id ?? "";
  return String(v);
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function asIdArray(v) {
  return asArray(v)
    .map((x) => (typeof x === "object" && x !== null ? x.id : String(x)))
    .map((x) => x.trim())
    .filter(Boolean);
}

function pickField(fields, keys) {
  for (const key of keys) {
    const value = fields?.[key];
    if (value != null && asString(value).trim() !== "") return value;
  }
  return "";
}

async function fetchAll(table, view) {
  const out = [];
  let offset;

  do {
    const params = new URLSearchParams();
    if (view) params.set("view", view);
    if (offset) params.set("offset", offset);

    const res = await fetch(`${API}/${encodeURIComponent(table)}?${params}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Airtable fetch failed ${table}/${view}: ${res.status} ${body}`);
    }

    const json = await res.json();
    out.push(...(json.records || []));
    offset = json.offset;
  } while (offset);

  return out;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function writeManifest(manifest) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadTo(urlStr, destPath, bustKey) {
  const u = new URL(urlStr);
  if (bustKey) u.searchParams.set("v", String(bustKey));

  const res = await fetch(u.toString(), {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!res.ok) throw new Error(`Download failed ${res.status}: ${u.toString()}`);

  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

async function convertToWebp(srcPath, outPath) {
  await execFileAsync("convert", [
    srcPath,
    "-resize",
    "260x360>",
    "-strip",
    "-quality",
    "82",
    outPath,
  ]);
}

function normalizeTerm(value) {
  const text = asString(value).toLowerCase();

  if (text.includes("1")) return 1;
  if (text.includes("2")) return 2;
  if (text.includes("3")) return 3;

  return null;
}

function normalizeRichText(text) {
  return asString(text).trim();
}

function buildIdeasByR3(ideaRecords) {
  const byR3 = {};

  for (const rec of ideaRecords) {
    const f = rec.fields || {};
    const r3Ids = asIdArray(f["R3 Connection"]);
    const term = normalizeTerm(f["Term"]);

    if (!term) continue;

    const item = {
      id: asString(f["exHelpingID"]).trim() || rec.id,
      term,
      sort: asString(f["Sort"]).trim(),
      content: normalizeRichText(f["Extra Helping Assignments/Ideas"]),
    };

    if (!item.content) continue;

    for (const r3Id of r3Ids) {
      if (!byR3[r3Id]) byR3[r3Id] = [];
      byR3[r3Id].push(item);
    }
  }

  for (const r3Id of Object.keys(byR3)) {
    byR3[r3Id].sort((a, b) => {
      if (a.term !== b.term) return a.term - b.term;
      return String(a.sort || "").localeCompare(String(b.sort || ""));
    });
  }

  return byR3;
}

function buildResourceMap(resourceRecords) {
  const map = {};

  for (const rec of resourceRecords) {
    const f = rec.fields || {};
    const resourceId = asString(f["resourceID"]).trim() || rec.id;

    map[resourceId] = {
      id: resourceId,
      resourceId,
      title: asString(f["Title"]).trim(),
      author: asString(f["Author"]).trim(),
      isbnAsin: asString(f["ISBN-ASIN"]).trim(),
      resourceTagText: asString(f["Resource Tag Text"]).trim(),
      scope: asString(f["🍯Scope"]).trim(),
      rationale: asString(f["➜ RATIONALE"]).trim(),
      imagePath: `img/extra-helpings/${resourceId}.webp`,
      links: [
        {
          text: asString(f["Link Text 1"]).trim() || "Option 1",
          url: asString(f["URL Link 1"]).trim(),
        },
        {
          text: asString(f["Link Text 2"]).trim() || "Option 2",
          url: asString(f["URL Link 2"]).trim(),
        },
      ].filter((link) => link.url),
    };
  }

  return map;
}

async function buildImages(resourceRecords) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });

  const manifest = await readManifest();

  let created = 0;
  let skipped = 0;
  let noImage = 0;

  for (const rec of resourceRecords) {
    const f = rec.fields || {};
    const resourceId = asString(f["resourceID"]).trim() || rec.id;
    const outFile = path.join(IMAGE_DIR, `${resourceId}.webp`);

    const attachments = f["Image"];
    const att = Array.isArray(attachments) ? attachments[0] : null;
    const attUrl = att?.url || "";

    if (!attUrl) {
      noImage++;
      continue;
    }

    const versionKey = att.id || `${att.filename || ""}|${att.size || ""}|${attUrl}`;
    const previousKey = manifest[resourceId]?.versionKey;
    const haveFile = await fileExists(outFile);

    if (haveFile && previousKey === versionKey) {
      skipped++;
      continue;
    }

    const tmpIn = path.join(TMP_DIR, `${resourceId}-in`);
    const tmpOut = path.join(TMP_DIR, `${resourceId}.webp`);

    try {
      await downloadTo(attUrl, tmpIn, versionKey);
      await convertToWebp(tmpIn, tmpOut);
      await fs.copyFile(tmpOut, outFile);

      manifest[resourceId] = {
        versionKey,
        updatedAt: new Date().toISOString(),
      };

      created++;
      console.log(`✅ extra helping image: ${resourceId}.webp`);
    } catch (error) {
      console.warn(`⚠️ extra helping image failed for ${resourceId}: ${error.message}`);
    } finally {
      try { await fs.unlink(tmpIn); } catch {}
      try { await fs.unlink(tmpOut); } catch {}
    }
  }

  await writeManifest(manifest);

  console.log(`[extra helpings images] created=${created} skipped=${skipped} noImage=${noImage}`);
}

function buildTerms(ideas) {
  return [1, 2, 3].map((term) => ({
    term,
    title: `Term ${term}`,
    items: ideas.filter((item) => item.term === term),
  }));
}

function sortIdParts(sortId) {
  return String(sortId || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isCourseLevel(sortId) {
  const parts = sortIdParts(sortId);
  return parts.length >= 4 && parts[3] === "000";
}

function courseSortKey(sortId) {
  const parts = sortIdParts(sortId);

  if (parts.length < 4) return String(sortId || "");

  return [...parts.slice(0, 3), "000"].join(".");
}

function mergeUniqueById(items) {
  const out = [];
  const seen = new Set();

  for (const item of items || []) {
    const id = item?.id || item?.resourceId;
    if (!id || seen.has(id)) continue;

    seen.add(id);
    out.push(item);
  }

  return out;
}

async function main() {
  const [rotationRecords, resourceRecords, ideaRecords] = await Promise.all([
    fetchAll(ROTATION_TABLE, ROTATION_VIEW),
    fetchAll(RESOURCES_TABLE, RESOURCES_VIEW),
    fetchAll(IDEAS_TABLE, IDEAS_VIEW),
  ]);

  const ideasByR3 = buildIdeasByR3(ideaRecords);
  const resourcesById = buildResourceMap(resourceRecords);

  await buildImages(resourceRecords);

  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });

  const indexRows = [];

  const rotationMetaById = {};
  const rotationIdsByCourseKey = {};
  
  for (const record of rotationRecords) {
    const f = record.fields || {};
    const sortId = asString(f["Sort_ID"]).trim();
    const key = courseSortKey(sortId);
  
    rotationMetaById[record.id] = {
      id: record.id,
      title:
        asString(f["ProgramLIST"]).trim() ||
        sortId ||
        record.id,
      subject: asString(f["🍯Subject"]).trim(),
      gradeText: asString(f["Grade_Text"]).trim(),
      gradeFilter: asString(f["Grade_Filter"]).trim(),
      sortId,
      setting: asString(f["🍯Setting"]).trim(),
      resourceIds: asIdArray(f["MA_Resources (ExHelpings)"]),
      isCourseLevel: isCourseLevel(sortId),
      courseKey: key,
    };
  
    if (!rotationIdsByCourseKey[key]) {
      rotationIdsByCourseKey[key] = [];
    }
  
    rotationIdsByCourseKey[key].push(record.id);
  }

  for (const rec of rotationRecords) {
    const f = rec.fields || {};
    const r3Id = rec.id;

    const meta = rotationMetaById[r3Id];
    const relatedIds = meta.isCourseLevel
      ? rotationIdsByCourseKey[meta.courseKey] || [r3Id]
      : [
          ...new Set([
            rotationIdsByCourseKey[meta.courseKey]?.find(
              (id) => rotationMetaById[id]?.isCourseLevel
            ),
            r3Id,
          ].filter(Boolean)),
        ];
    
    const relatedSections = relatedIds
      .map((id) => rotationMetaById[id])
      .filter(Boolean)
      .sort((a, b) => String(a.sortId || "").localeCompare(String(b.sortId || "")));
    
    const resourceIds = relatedSections.flatMap((section) => section.resourceIds || []);
    
    const resources = mergeUniqueById(
      resourceIds
        .map((id) => resourcesById[id])
        .filter(Boolean)
    ).sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    
    const ideas = relatedSections.flatMap((section) => ideasByR3[section.id] || []);
    
    const title = meta.title;

    const payload = {
      id: r3Id,
      recordID: r3Id,
      title,
      subject: meta.subject,
      gradeText: meta.gradeText,
      gradeFilter: meta.gradeFilter,
      sortId: meta.sortId,
      setting: meta.setting,
      relatedSections: relatedSections.map((section) => ({
        id: section.id,
        title: section.title,
        sortId: section.sortId,
        type: section.isCourseLevel ? "course" : "topic",
      })),
      generatedAt: new Date().toISOString(),

      ideas: {
        intro:
          "Ideas for projects, activities, books, games, and more for students with a high level of interest.",
        terms: buildTerms(ideas),
      },

      resources,
    };

    const hasContent =
      ideas.length > 0 ||
      resources.length > 0;

    if (!hasContent) continue;

    await writeJson(path.join(DATA_DIR, `${r3Id}.json`), payload);

    indexRows.push({
      id: r3Id,
      title: payload.title,
      subject: payload.subject,
      gradeText: payload.gradeText,
      sortId: payload.sortId,
      setting: payload.setting,
      url: `extra-helpings.html?id=${encodeURIComponent(r3Id)}`,
      ideaCount: ideas.length,
      resourceCount: resources.length,
    });
  }

  indexRows.sort((a, b) => {
    const sortCompare = String(a.sortId || "").localeCompare(String(b.sortId || ""));
    if (sortCompare) return sortCompare;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });

  await writeJson(path.join(DATA_DIR, "index.json"), {
    generatedAt: new Date().toISOString(),
    rotation: `R${ROTATION}`,
    count: indexRows.length,
    rows: indexRows,
  });

  console.log(`[extra helpings] pages=${indexRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
