import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "pdf/course-list";
const BASE =
  "https://kkeel.github.io/course-picker/index.html?autoprint=1&pdf=1";

const targets = [
  {
    key: "MASTER",
    url: `${BASE}&master=1`,
    filename: "Course-List_MASTER.pdf",
    expectTitle: "Master",
  },
  ...Array.from({ length: 12 }, (_, i) => {
    const code = `G${i + 1}`;
    return {
      key: code,
      url: `${BASE}&grade=${code}`,
      filename: `Course-List_${code}.pdf`,
      expectTitle: `Grade ${i + 1}`,
    };
  }),
];

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
