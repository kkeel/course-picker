import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright";

const OUT_DIR = "pdf/flashcards/reading";
const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

function startServer(rootDir = process.cwd()) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(rootDir, decodeURIComponent(url.pathname));

    if (url.pathname.endsWith("/")) {
      filePath = path.join(filePath, "index.html");
    }

    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();

      const contentTypes = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".pdf": "application/pdf",
      };

      res.writeHead(200, {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function pageUrl(params) {
  const url = new URL("/flashcards/reading/index.html", BASE_URL);

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
    console.log(`Skipped empty PDF: ${outputPath}`);
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

  const server = await startServer();
  const browser = await chromium.launch();

  try {
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
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
