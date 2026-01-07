import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "pdf/course-list";
const URL =
  "https://kkeel.github.io/course-picker/index.html?autoprint=1&grade=G1&pdf=1";

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

// Prevent any print dialog / window.print side effects during automation
await page.addInitScript(() => {
  window.print = () => {}; // no-op
});

console.log("Opening:", URL);
await page.goto(URL, { waitUntil: "networkidle", timeout: 180_000 });

// Wait until autoprint has applied Grade 1 and updated the title
await page.waitForFunction(() => {
  return typeof document !== "undefined"
    && /Grade\s*1/i.test(document.title || "");
}, null, { timeout: 180_000 });

// Give layout a moment to settle (fonts/images/etc.)
await page.waitForTimeout(750);

const outPath = path.join(OUT_DIR, "Course-List_G1.pdf");

// Create the PDF using CSS @page size/margins (preferCSSPageSize)
await page.pdf({
  path: outPath,
  printBackground: true,
  preferCSSPageSize: true,
});

await browser.close();
console.log("Saved:", outPath);
