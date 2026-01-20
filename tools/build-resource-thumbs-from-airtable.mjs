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

async function downloadTo(urlStr, destPath) {
  const res = await fetch(urlStr);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${urlStr}`);
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

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });

  const recs = await fetchAll(TABLE, VIEW);

  let created = 0;
  let skipped = 0;
  let noImage = 0;

  for (const rec of recs) {
    const f = rec.fields || {};
    const resourceId = (f.resourceID || rec.id).toString().trim();
    const outFile = path.join(OUT_DIR, `${resourceId}.webp`);

    // Skip only if the existing thumbnail is newer than the image-modified timestamp
    const lastMod = f.Last_Modified_Image; // Airtable field (string/date)
    if (await fileExists(outFile) && lastMod) {
      const stat = await fs.stat(outFile);
      const thumbTime = stat.mtimeMs;
      const imageTime = Date.parse(lastMod); // assumes ISO-ish date string
      if (!Number.isNaN(imageTime) && thumbTime >= imageTime) {
        skipped++;
        continue;
      }
    }

    const attachments = f.Image; // Airtable attachment field
    const att = Array.isArray(attachments) ? attachments[0] : null;
    const attUrl = att && att.url;

    if (!attUrl) {
      noImage++;
      continue;
    }

    const tmpIn = path.join(TMP_DIR, `${resourceId}-in`);
    const tmpOut = path.join(TMP_DIR, `${resourceId}.webp`);

    try {
      await downloadTo(attUrl, tmpIn);
      await convertToWebp(tmpIn, tmpOut);
      await fs.copyFile(tmpOut, outFile);
      created++;
      console.log(`✅ cover: ${resourceId}.webp`);
    } catch (e) {
      console.warn(`⚠️ cover failed for ${resourceId}: ${e.message}`);
    } finally {
      // best-effort cleanup
      try { await fs.unlink(tmpIn); } catch {}
      try { await fs.unlink(tmpOut); } catch {}
    }
  }

  console.log(`Done. created=${created} skipped=${skipped} noImage=${noImage}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
