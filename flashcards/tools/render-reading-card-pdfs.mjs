import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const OUT_DIR = "pdf/flashcards/reading";
const PAGE_PATH = "flashcards/reading/index.html";

const packets = [
  {
    name: "reading-level-1-starter-pack.pdf",
    packet: "jump-in-level-1",
  },
  {
    name: "reading-level-2-starter-pack.pdf",
    packet: "jump-in-level-2",
  },
  {
    name: "reading-level-3-starter-pack.pdf",
    packet: "jump-in-level-3",
  },
  {
    name: "reading-level-2-add-on-pack.pdf",
    packet: "progression-level-2",
  },
  {
    name: "reading-level-3-add-on-pack.pdf",
    packet: "progression-level-3",
  },
];

const replacementLevels = ["level-1", "level-2", "level-3"];

const replacementTypes = [
  "phonogram",
  "short-vowel",
  "definition",
  "red-word",
  "sentence",
  "word",
  "game",
];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function pageUrl(params) {
  const fileUrl = pathToFileURL(path.resolve(PAGE_PATH)).href;
  const url = new URL(fileUrl);

  url.searchParams.set("render", "pdf");
  url.searchParams.set("side", "both");

  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  return url.href;
}

async function renderPdf(browser, url, outputPath) {
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle" });

  await page.waitForFunction(() => document.body.dataset.renderReady === "true", {
    timeout: 60000,
  });

  const hasCards = await page.locator(".print-card:not(.empty)").count();

  if (!hasCards) {
    await page.close();
    return false;
  }

  await ensureDir(path.dirname(outputPath));

  await page.pdf({
    path: outputPath,
    format: "Letter",
    printBackground: true,
    margin: {
      top: "0",
      right: "0",
      bottom: "0",
      left: "0",
    },
  });

  await page.close();
  console.log(`Rendered ${outputPath}`);
  return true;
}

async function main() {
  await ensureDir(OUT_DIR);

  const browser = await chromium.launch();

  for (const packet of packets) {
    await renderPdf(
      browser,
      pageUrl({ packet: packet.packet }),
      path.join(OUT_DIR, packet.name)
    );
  }

  for (const level of replacementLevels) {
    for (const type of replacementTypes) {
      const outputPath = path.join(
        OUT_DIR,
        "replacements",
        `${level}-${type}.pdf`
      );

      await renderPdf(
        browser,
        pageUrl({
          packet: `jump-in-${level}`,
          replacementLevel: level,
          replacementType: type,
        }),
        outputPath
      );
    }
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
