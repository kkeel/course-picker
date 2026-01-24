import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "pdf/book-list";
const BASE =
  "https://planning.alveary.org/books.html?autoprint=1&pdf=1";

// Read selections from env:
// - GRADES: "G2,G6" (optional). If empty -> render all grades.
// - INCLUDE_MASTER: "true"/"false" (optional). Default: true.
function parseSelectedGrades() {
  const raw = (process.env.GRADES || "").trim();
  if (!raw) return []; // empty means "all grades"

  const items = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const valid = new Set(Array.from({ length: 12 }, (_, i) => `G${i + 1}`));
  const out = [];
  for (const g of items) {
    if (valid.has(g) && !out.includes(g)) out.push(g);
  }
  return out;
}

function parseIncludeMaster() {
  const v = (process.env.INCLUDE_MASTER || "").trim().toLowerCase();
  if (!v) return true; // default true
  return v === "true" || v === "1" || v === "yes";
}

function gradeNumberFromCode(code) {
  return Number(String(code).replace(/^G/i, ""));
}

function buildTargets(selectedGrades, includeMaster) {
  const targets = [];

  if (includeMaster) {
    targets.push({
      key: "MASTER",
      url: `${BASE}&master=1`,
      filename: "Book-List_MASTER.pdf",
      expectTitle: "Master",
    });
  }

  const gradesToRender = selectedGrades.length
    ? selectedGrades
    : Array.from({ length: 12 }, (_, i) => `G${i + 1}`);

  for (const code of gradesToRender) {
    const n = gradeNumberFromCode(code);
    targets.push({
      key: code,
      url: `${BASE}&grade=${code}`,
      filename: `Book-List_${code}.pdf`,
      expectTitle: `Grade ${n}`,
    });
  }

  return targets;
}

const selectedGrades = parseSelectedGrades();
const includeMaster = parseIncludeMaster();
const targets = buildTargets(selectedGrades, includeMaster);

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage"],
});
const page = await browser.newPage();

// Prevent print dialog during automation
await page.addInitScript(() => {
  window.print = () => {};
});

async function waitForAllImages(page, timeoutMs = 600000) {
  const start = Date.now();

  // Force eager loading for all images (important for huge lists)
  await page.evaluate(() => {
    document.querySelectorAll("img").forEach((img) => {
      try {
        img.loading = "eager";
      } catch (e) {}
      img.setAttribute("loading", "eager");
    });
  });

  // Wait until every image is finished loading (or errored)
  await page.waitForFunction(() => {
    const imgs = Array.from(document.images || []);
    if (!imgs.length) return true;
    return imgs.every((img) => img.complete);
  }, null, { timeout: timeoutMs });

  // Ask Chromium to decode images before PDF snapshot
  await page.evaluate(async () => {
    const imgs = Array.from(document.images || []);
    await Promise.allSettled(
      imgs
        .filter((img) => img.complete && img.naturalWidth > 0 && img.decode)
        .map((img) => img.decode())
    );
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Images ready after ${elapsed}s`);
}

for (const t of targets) {
  console.log(`\n--- Rendering ${t.key}: ${t.url}`);

  await page.goto(t.url, { waitUntil: "load", timeout: 180_000 });

  // Wait until grade/master label is applied
  await page.waitForFunction(
    (expected) => {
      const title = document.title || "";
      return title.toLowerCase().includes(String(expected).toLowerCase());
    },
    t.expectTitle,
    { timeout: 180_000 }
  );

  // Small settle time for images/layout
  await page.waitForTimeout(750);

  if (t.key === "MASTER") {
    // Master list is HUGE — give images plenty of time
    await waitForAllImages(page, 12 * 60 * 1000);
  } else {
    // Normal grades
    await waitForAllImages(page, 2 * 60 * 1000);
  }

  const outPath = path.join(OUT_DIR, t.filename);

  await page.pdf({
    path: outPath,
    printBackground: true,
    preferCSSPageSize: true, // respects landscape @page in print-books.css
  });

  console.log(`Saved: ${outPath}`);
}

await browser.close();
console.log("\nDone.");
