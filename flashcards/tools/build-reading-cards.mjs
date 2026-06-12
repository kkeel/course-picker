import fs from "node:fs/promises";
import path from "node:path";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.LESSON_WRITING_BASE_ID;
const TABLE_NAME = "Reading Lesson Cards";

const OUT_DIR = "data/flashcards/reading";
const IMAGE_DIR = `${OUT_DIR}/images`;

if (!AIRTABLE_PAT) throw new Error("Missing AIRTABLE_PAT");
if (!BASE_ID) throw new Error("Missing LESSON_WRITING_BASE_ID");

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fieldValue(fields, name, fallback = "") {
  const value = fields?.[name];
  if (value === undefined || value === null) return fallback;
  return value;
}

function asText(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (value.name) return String(value.name);
    return JSON.stringify(value);
  }
  return String(value).trim();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asSelectList(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];

  return arr
    .map((item) => {
      if (!item) return "";
      if (typeof item === "string") return item.trim();
      if (typeof item === "object" && item.name) return String(item.name).trim();
      return String(item).trim();
    })
    .filter(Boolean);
}

function levelNumber(levelName) {
  const match = String(levelName || "").match(/(\d+)/);
  return match ? Number(match[1]) : 999;
}

function sortCards(a, b) {
  return (
    levelNumber(a.firstAssigned) - levelNumber(b.firstAssigned) ||
    String(a.lesson || "").localeCompare(String(b.lesson || ""), undefined, { numeric: true }) ||
    String(a.type || "").localeCompare(String(b.type || "")) ||
    (a.cardNumber ?? 9999) - (b.cardNumber ?? 9999) ||
    String(a.title || "").localeCompare(String(b.title || ""))
  );
}

function googleDriveFileId(url) {
  const text = String(url || "").trim();
  if (!text) return "";

  const fileMatch = text.match(/\/file\/d\/([^/]+)/);
  if (fileMatch) return fileMatch[1];

  const idMatch = text.match(/[?&]id=([^&]+)/);
  if (idMatch) return idMatch[1];

  return "";
}

function imageExtFromContentType(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "png";
}

async function downloadDriveImage(sourceUrl, fileStem) {
  const fileId = googleDriveFileId(sourceUrl);
  if (!fileId) return { image: sourceUrl, sourceImage: sourceUrl, cached: false };

  await fs.mkdir(IMAGE_DIR, { recursive: true });

  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    const res = await fetch(downloadUrl);

    if (!res.ok) {
      console.warn(`Image download failed ${res.status}: ${sourceUrl}`);
      return { image: sourceUrl, sourceImage: sourceUrl, cached: false };
    }

    const contentType = res.headers.get("content-type") || "";

    if (!contentType.startsWith("image/")) {
      console.warn(`Drive did not return an image (${contentType}): ${sourceUrl}`);
      return { image: sourceUrl, sourceImage: sourceUrl, cached: false };
    }

    const ext = imageExtFromContentType(contentType);
    const relativePath = `${IMAGE_DIR}/${fileStem}.${ext}`;
    const buffer = Buffer.from(await res.arrayBuffer());

    await fs.writeFile(relativePath, buffer);

    return {
      image: `/${relativePath}`,
      sourceImage: sourceUrl,
      cached: true,
    };
  } catch (error) {
    console.warn(`Image download error: ${sourceUrl}`);
    console.warn(error.message);
    return { image: sourceUrl, sourceImage: sourceUrl, cached: false };
  }
}

async function airtableFetchAll(tableName) {
  const records = [];
  let offset = "";

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("pageSize", "100");

    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable error ${res.status}: ${text}`);
    }

    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Wrote ${filePath}`);
}

async function normalizeCard(record) {
  const f = record.fields || {};

  const title = asText(fieldValue(f, "Card"));
  const type = asText(fieldValue(f, "Type of Card"));
  const firstAssigned = asText(fieldValue(f, "First Assigned in"));
  const includedIn = asSelectList(fieldValue(f, "Included in"));

  const sourceFrontImage = asText(fieldValue(f, "Front Image Link"));
  const sourceBackImage = asText(fieldValue(f, "Back Image Link"));

  const frontImage = await downloadDriveImage(sourceFrontImage, `${record.id}-front`);
  const backImage = await downloadDriveImage(sourceBackImage, `${record.id}-back`);

  return {
    id: record.id,
    title,

    lesson: asText(fieldValue(f, "Lesson")),
    cardNumber: asNumber(fieldValue(f, "Card #")),

    type,
    typeSlug: slugify(type),

    firstAssigned,
    firstAssignedSlug: slugify(firstAssigned),

    includedIn,
    includedInSlugs: includedIn.map(slugify),

    front: {
      text: asText(fieldValue(f, "Front of Card")),
      image: frontImage.image,
      sourceImage: frontImage.sourceImage,
      imageCached: frontImage.cached,
    },

    back: {
      text: asText(fieldValue(f, "Back of Card")),
      keyword: asText(fieldValue(f, "Key Word (back)")),
      mnemonic: asText(fieldValue(f, "Mnemonic (back)")),
      image: backImage.image,
      sourceImage: backImage.sourceImage,
      imageCached: backImage.cached,
    },

    rawFields: f,
  };
}

function groupBy(cards, keyFn) {
  const out = {};

  for (const card of cards) {
    const keys = keyFn(card);
    const list = Array.isArray(keys) ? keys : [keys];

    for (const key of list) {
      if (!key) continue;
      if (!out[key]) out[key] = [];
      out[key].push(card);
    }
  }

  for (const key of Object.keys(out)) {
    out[key].sort(sortCards);
  }

  return out;
}

async function main() {
  console.log(`Fetching ${TABLE_NAME} from Airtable...`);

  const records = await airtableFetchAll(TABLE_NAME);
  const generatedAt = new Date().toISOString();

  console.log(`Normalizing cards and caching images...`);

  const normalizedCards = [];
  for (const record of records) {
    normalizedCards.push(await normalizeCard(record));
  }

  const cards = normalizedCards
    .filter((card) => card.title || card.front.image || card.back.image)
    .sort(sortCards);

  const cachedImageCount = cards.reduce((count, card) => {
    return count + (card.front.imageCached ? 1 : 0) + (card.back.imageCached ? 1 : 0);
  }, 0);

  const levels = [...new Set(cards.flatMap((card) => card.includedIn))]
    .filter(Boolean)
    .sort((a, b) => levelNumber(a) - levelNumber(b) || a.localeCompare(b));

  const firstAssignedLevels = [...new Set(cards.map((card) => card.firstAssigned))]
    .filter(Boolean)
    .sort((a, b) => levelNumber(a) - levelNumber(b) || a.localeCompare(b));

  const types = [...new Set(cards.map((card) => card.type))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const master = {
    generatedAt,
    source: {
      baseId: BASE_ID,
      table: TABLE_NAME,
    },
    count: cards.length,
    cachedImageCount,
    cards,
  };

  const metadata = {
    generatedAt,
    source: {
      baseId: BASE_ID,
      table: TABLE_NAME,
    },
    recordCount: records.length,
    cardCount: cards.length,
    cachedImageCount,
    levels,
    firstAssignedLevels,
    types,
    files: {
      master: "master.json",
      metadata: "metadata.json",
      byLevel: "by-level/{level-slug}.json",
      byFirstAssigned: "by-first-assigned/{level-slug}.json",
      byType: "by-type/{type-slug}.json",
      images: "images/{record-id}-{front|back}.png",
    },
  };

  await writeJson(`${OUT_DIR}/master.json`, master);
  await writeJson(`${OUT_DIR}/metadata.json`, metadata);

  const byLevel = groupBy(cards, (card) => card.includedInSlugs);
  for (const [slug, groupCards] of Object.entries(byLevel)) {
    await writeJson(`${OUT_DIR}/by-level/${slug}.json`, {
      generatedAt,
      levelSlug: slug,
      count: groupCards.length,
      cards: groupCards,
    });
  }

  const byFirstAssigned = groupBy(cards, (card) => card.firstAssignedSlug);
  for (const [slug, groupCards] of Object.entries(byFirstAssigned)) {
    await writeJson(`${OUT_DIR}/by-first-assigned/${slug}.json`, {
      generatedAt,
      levelSlug: slug,
      count: groupCards.length,
      cards: groupCards,
    });
  }

  const byType = groupBy(cards, (card) => card.typeSlug);
  for (const [slug, groupCards] of Object.entries(byType)) {
    await writeJson(`${OUT_DIR}/by-type/${slug}.json`, {
      generatedAt,
      typeSlug: slug,
      count: groupCards.length,
      cards: groupCards,
    });
  }

  console.log(`Done. Built ${cards.length} reading cards.`);
  console.log(`Cached ${cachedImageCount} images.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
