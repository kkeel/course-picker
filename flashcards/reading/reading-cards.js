const DATA_BASE = new URL("../../data/flashcards/reading", import.meta.url).href;

const state = {
  cards: [],
  mode: "print",
  packet: "progression-level-1",
  groupBy: "type",
  side: "front",
};

const els = {
  status: document.getElementById("readingStatus"),
  cardSheets: document.getElementById("cardSheets"),
  printSummary: document.getElementById("printSummary"),
  packetFilter: document.getElementById("packetFilter"),
  printGroupFilter: document.getElementById("printGroupFilter"),
  sideFilter: document.getElementById("sideFilter"),
  printButton: document.getElementById("printButton"),
};

function driveImageUrl(url) {
  const text = String(url || "").trim();
  const match = text.match(/\/file\/d\/([^/]+)/);
  if (!match) return text;
  return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1200`;
}

function getPacketCards() {
  if (state.packet.startsWith("progression-")) {
    const level = state.packet.replace("progression-", "");
    return state.cards.filter((card) => card.firstAssignedSlug === level);
  }

  if (state.packet.startsWith("jump-in-")) {
    const level = state.packet.replace("jump-in-", "");
    return state.cards.filter((card) => card.includedInSlugs?.includes(level));
  }

  return [];
}

function groupCards(cards) {
  const map = new Map();

  for (const card of cards) {
    const key = state.groupBy === "level"
      ? card.firstAssigned || "Other"
      : card.type || "Other";

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(card);
  }

  return [...map.entries()];
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function renderCard(card, side) {
  const imageUrl = side === "back" ? card.back?.image : card.front?.image;
  const label = `${card.type || "Card"} ${card.cardNumber || ""}`.trim();

  return `
    <div class="print-card">
      ${
        imageUrl
          ? `<img src="${driveImageUrl(imageUrl)}" alt="${escapeHtml(label)}">`
          : `<div class="missing-image">Missing ${side} image<br>${escapeHtml(card.title || "")}</div>`
      }
      <div class="card-label">${escapeHtml(label)}</div>
    </div>
  `;
}

function renderEmptyCard() {
  return `<div class="print-card empty"></div>`;
}

function renderSheets() {
  const cards = getPacketCards();
  const sortedCards = [...cards].sort((a, b) => {
    if (state.groupBy === "type") {
      return String(a.type || "").localeCompare(String(b.type || "")) ||
        String(a.lesson || "").localeCompare(String(b.lesson || ""), undefined, { numeric: true }) ||
        (a.cardNumber ?? 9999) - (b.cardNumber ?? 9999);
    }

    return String(a.firstAssigned || "").localeCompare(String(b.firstAssigned || "")) ||
      String(a.lesson || "").localeCompare(String(b.lesson || ""), undefined, { numeric: true }) ||
      String(a.type || "").localeCompare(String(b.type || "")) ||
      (a.cardNumber ?? 9999) - (b.cardNumber ?? 9999);
  });

  els.status.textContent = "";
  els.printSummary.textContent = `${cards.length} cards selected.`;

  if (!sortedCards.length) {
    els.cardSheets.innerHTML = `<div class="empty-state">No cards found for this selection.</div>`;
    return;
  }

  const pages = chunk(sortedCards, 10);

  const html = pages.map((pageCards, index) => {
    const filledCards = [...pageCards];
    while (filledCards.length < 10) filledCards.push(null);

    if (state.side === "both") {
      return `
        ${renderSheet(filledCards, "front", index + 1)}
        ${renderSheet(mirrorBackCards(filledCards), "back", index + 1)}
      `;
    }

    const sheetCards = state.side === "back"
      ? mirrorBackCards(filledCards)
      : filledCards;

    return renderSheet(sheetCards, state.side, index + 1);
  }).join("");

  els.cardSheets.innerHTML = html;
}

function renderSheet(cards, side, sheetNumber) {
  const sideLabel = side === "back" ? "Backs" : "Fronts";

  return `
    <article class="sheet ${side === "back" ? "is-back-sheet" : "is-front-sheet"}">
      <div class="sheet-heading">
        <span>${escapeHtml(sideLabel)}</span>
        <span>Sheet ${sheetNumber}</span>
      </div>
      <div class="card-grid">
        ${cards.map((card) => card ? renderCard(card, side) : renderEmptyCard()).join("")}
      </div>
    </article>
  `;
}

function mirrorBackCards(cards) {
  const mirrored = [...cards];

  for (let i = 0; i < mirrored.length; i += 2) {
    const left = mirrored[i];
    mirrored[i] = mirrored[i + 1] || null;
    mirrored[i + 1] = left || null;
  }

  return mirrored;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadCards() {
  els.status.textContent = "Loading reading cards…";

  let filePath = "";

  if (state.packet.startsWith("progression-")) {
    const level = state.packet.replace("progression-", "");
    filePath = `by-first-assigned/${level}.json`;
  } else if (state.packet.startsWith("jump-in-")) {
    const level = state.packet.replace("jump-in-", "");
    filePath = `by-level/${level}.json`;
  } else {
    els.status.textContent = "";
    els.cardSheets.innerHTML = `<div class="empty-state">Tagged card printing is coming soon.</div>`;
    return;
  }

  const response = await fetch(`${DATA_BASE}/${filePath}`);
  if (!response.ok) throw new Error(`Could not load reading cards JSON: ${response.status}`);

  const data = await response.json();
  state.cards = data.cards || [];

  renderSheets();
}

els.packetFilter?.addEventListener("change", (event) => {
  state.packet = event.target.value;
  loadCards();
});

els.printGroupFilter?.addEventListener("change", (event) => {
  state.groupBy = event.target.value;
  loadCards();
});

els.sideFilter?.addEventListener("change", (event) => {
  state.side = event.target.value;
  loadCards();
});

els.printButton?.addEventListener("click", () => {
  window.print();
});

loadCards().catch((error) => {
  console.error(error);
  els.status.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
});
