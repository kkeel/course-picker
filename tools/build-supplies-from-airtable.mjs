// ✅ Build Supplies JSON from Airtable (MA_Supplies only)

import Airtable from "airtable";
import fs from "fs/promises";

const base = new Airtable({
  apiKey: process.env.AIRTABLE_PAT,
}).base(process.env.AIRTABLE_BASE_ID);

// 🔑 TABLE NAME (matches your Airtable)
const TABLE = "MA_Supplies";

// 📁 OUTPUT
const OUTPUT = "data/MA_Supplies.json";

// 🧠 Helper
function get(field, rec) {
  return rec.get(field) ?? null;
}

function arr(field, rec) {
  const val = rec.get(field);
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// 🚀 Build
async function run() {
  const records = [];

  await base(TABLE)
    .select({
      view: "Grid view", // adjust later if needed
    })
    .eachPage(async (page, next) => {
      for (const rec of page) {
        records.push({
          id: rec.id,

          // --- Core ---
          title: get("Supply", rec),

          image: get("Image_ViewLink", rec),
          imageFile: get("Image", rec),

          location: get("Location to Find (Optional)", rec),
          isbn: get("ISBN/ASIN", rec),

          // --- Flags ---
          optional: !!get("Optional", rec),
          groupSupply: !!get("Group Supply", rec),
          household: !!get("Household Supply", rec),

          // --- Content ---
          rationale: get("➜ RATIONALE:", rec),
          note: get("➜ NOTE:", rec),
          maySub: get("➜ MAY SUB", rec),

          qty: get("QTY", rec),

          // --- Links ---
          link1: get("URL 1", rec),
          link2: get("URL 2", rec),

          // --- Discount ---
          discount: !!get("Discount", rec),
          discountCode: get("with code", rec),
          discountLink: get("using link", rec),

          // --- Scope / Cross-course text ---
          scope: get("Scope", rec),
          usedInText: get("Shared_Supply(R3)", rec),

          // --- Subject ---
          subjects: arr("Subject(s)", rec),

          // --- Course Connections ---
          courses: arr("Course/Topic(R2)", rec),
          programList: get("ProgramLIST (from Rotation_3)", rec),

          // --- Sorting ---
          sortId: get("Sort_ID (from Rotation_3)", rec),
          supplySort: get("Supply_Sort", rec),
          supplyTermSortR3: get("Supply/Term_Sort(R3)", rec),

          // --- IDs ---
          supplyId: get("Supply ID", rec),
          termSort: get("Term_Sort", rec),
        });
      }

      next();
    });

  console.log(`[Supplies] Loaded ${records.length} records`);

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(records, null, 2));

  console.log(`[Supplies] Saved → ${OUTPUT}`);
}

run().catch((err) => {
  console.error("[Supplies] Build failed", err);
  process.exit(1);
});
