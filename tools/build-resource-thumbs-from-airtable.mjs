import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

const OUT_DIR = path.join(__dirname, "..", "img", "resources");
const TMP_DIR = path.join(__dirname, "..", ".tmp-resource-images");
const MANIFEST_PATH = path.join(OUT_DIR, `.thumb-manifest-r${ROTATION}.json`);

// Set this once, per your requirement:
const FORCE_UPDATE_SINCE = Date.parse("2025-12-23T21:40:00.000Z"); // Dec 23 2025, 1:40 PM PST

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

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readManifest() {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeManifest(manifest) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function downloadTo(urlStr, destPath, bustKey) {
  // Cache-bust the Airtable CDN
  const u = new URL(urlStr);
  if (bustKey) u.searchParams.set("v", String(bustKey));

  const res = await fetch(u.toString(), {
    headers: {
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    }
  });

  if (!res.ok) throw new Error(`Download failed ${res.status}: ${u.toString()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

async function convertToWebp(srcPath, outPath) {
  await execFileAsync("convert", [
    srcPath,
    "-resize", "220x320>",
    "-strip",
    "-quality", "82",
    outPath
  ]);
}

function safeDateParse(val) {
  // Airtable may give "1/6/2026 1:07pm" which Date.parse can be inconsistent with.
  // We only use this for the "since Dec 23" filter; if it fails, we treat as unknown.
  const t = Date.parse(val);
  return Number.isNaN(t) ? null : t;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });

  const manifest = await readManifest();
  const recs = await fetchAll(TABLE, VIEW);

  let created = 0;
  let skipped = 0;
  let noImage = 0;
  let forced = 0;

  for (const rec of recs) {
    const f = rec.fields || {};
    const resourceId = (f.resourceID || rec.id).toString().trim();
    const outFile = path.join(OUT_DIR, `${resourceId}.webp`);

    const attachments = f.Image; // Airtable attachment field
    const att = Array.isArray(attachments) ? attachments[0] : null;
    const attUrl = att && att.url;

    if (!attUrl) {
      noImage++;
      continue;
    }

    // Best "version" signal: attachment id (changes when the attachment changes)
    const versionKey = att.id || `${att.filename || ""}|${att.size || ""}|${attUrl || ""}`;

    // Your requirement: force update if modified since Dec 23, 2025 1:40 PM PST
    const lastModRaw = f.Last_Modified_Image;
    const lastModTime = lastModRaw ? safeDateParse(lastModRaw) : null;
    const isForceSince = (lastModTime != null && lastModTime >= FORCE_UPDATE_SINCE);

    const prevKey = manifest[resourceId]?.versionKey;
    const haveFile = await fileExists(outFile);

    // Skip if:
    // - file exists
    // - versionKey unchanged since last run
    // - and not in the "force since Dec 23" set
    if (haveFile && prevKey === versionKey && !isForceSince) {
      skipped++;
      continue;
    }

    if (isForceSince) forced++;

    const tmpIn = path.join(TMP_DIR, `${resourceId}-in`);
    const tmpOut = path.join(TMP_DIR, `${resourceId}.webp`);

    try {
      // bustKey ensures we don't accidentally get stale CDN bytes
      const bustKey = att.id || lastModRaw || Date.now();
      await downloadTo(attUrl, tmpIn, bustKey);
      await convertToWebp(tmpIn, tmpOut);
      await fs.copyFile(tmpOut, outFile);

      manifest[resourceId] = {
        versionKey,
        lastModifiedImage: lastModRaw || null,
        updatedAt: new Date().toISOString()
      };

      created++;
      console.log(`✅ cover: ${resourceId}.webp ${isForceSince ? "(forced)" : ""}`);
    } catch (e) {
      console.warn(`⚠️ cover failed for ${resourceId}: ${e.message}`);
    } finally {
      try { await fs.unlink(tmpIn); } catch {}
      try { await fs.unlink(tmpOut); } catch {}
    }
  }

  await writeManifest(manifest);

  console.log(`Done. created=${created} skipped=${skipped} noImage=${noImage} forced_since=${forced}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
