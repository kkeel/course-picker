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
    document.querySelectorAll('img').forEach(img => {
      try { img.loading = "eager"; } catch (e) {}
      img.setAttribute("loading", "eager");
    });
  });

  // Wait until every image is finished loading (or errored)
  await page.waitForFunction(() => {
    const imgs = Array.from(document.images || []);
    if (!imgs.length) return true;

    return imgs.every(img => img.complete);
  }, null, { timeout: timeoutMs });

  // Ask Chromium to decode images before PDF snapshot
  await page.evaluate(async () => {
    const imgs = Array.from(document.images || []);
    await Promise.allSettled(
      imgs
        .filter(img => img.complete && img.naturalWidth > 0 && img.decode)
        .map(img => img.decode())
    );
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Images ready after ${elapsed}s`);
}

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
    preferCSSPageSize: true, // <-- respects landscape @page in print-books.css
  });

  console.log(`Saved: ${outPath}`);
}

await browser.close();
console.log("\nDone.");
