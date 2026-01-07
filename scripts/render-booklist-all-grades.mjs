import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "pdf/book-list";
const BASE =
  "https://kkeel.github.io/course-picker/books.html?autoprint=1&pdf=1";

const targets = [
  {
    key: "MASTER",
    url: `${BASE}&master=1`,
    filename: "Book-List_MASTER.pdf",
    expectTitle: "Master",
  },
  ...Array.from({ length: 12 }, (_, i) => {
    const code = `G${i + 1}`;
    return {
      key: code,
      url: `${BASE}&grade=${code}`,
      filename: `Book-List_${code}.pdf`,
      expectTitle: `Grade ${i + 1}`,
    };
  }),
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

// Prevent print dialog during automation
await page.addInitScript(() => {
  window.print = () => {};
});

for (const t of targets) {
  console.log(`\n--- Rendering ${t.key}: ${t.url}`);

  await page.goto(t.url, { waitUntil: "networkidle", timeout: 180_000 });

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

  const outPath = path.join(OUT_DIR, t.filename);

  await page.pdf({
    path: outPath,
    printBackground: true,
    preferCSSPageSize: true, // <-- respects landscape @page in print-books.css
  });

  console.log(`Saved: ${outPath}`);
}

await browser.close();
console.log("\nDone.");
