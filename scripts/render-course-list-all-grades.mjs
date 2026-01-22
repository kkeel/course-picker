import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "pdf/course-list";
const BASE =
  "https://kkeel.github.io/course-picker/courses.html?autoprint=1&pdf=1";

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

  // Keep only valid G1..G12, remove duplicates
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
      filename: "Course-List_MASTER.pdf",
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
      filename: `Course-List_${code}.pdf`,
      expectTitle: `Grade ${n}`,
    });
  }

  return targets;
}

const selectedGrades = parseSelectedGrades();
const includeMaster = parseIncludeMaster();
const targets = buildTargets(selectedGrades, includeMaster);

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

// Prevent any print dialog / window.print side effects during automation
await page.addInitScript(() => {
  window.print = () => {}; // no-op
});

for (const t of targets) {
  console.log(`\n--- Rendering ${t.key}: ${t.url}`);

  await page.goto(t.url, { waitUntil: "networkidle", timeout: 180_000 });

  // Wait until autoprint has applied the correct label (title includes "Grade X" or "Master")
  await page.waitForFunction(
    (expected) => {
      const title = document.title || "";
      return title.toLowerCase().includes(String(expected).toLowerCase());
    },
    t.expectTitle,
    { timeout: 180_000 }
  );

  // Let layout settle (fonts/images)
  await page.waitForTimeout(750);

  const outPath = path.join(OUT_DIR, t.filename);

  await page.pdf({
    path: outPath,
    printBackground: true,
    preferCSSPageSize: true,
  });

  console.log(`Saved: ${outPath}`);
}

await browser.close();
console.log("\nDone.");
