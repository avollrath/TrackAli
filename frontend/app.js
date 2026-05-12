const API = "http://localhost:5000";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let allOrders = [];
let lastSynced = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const tbody = document.getElementById("orders-tbody");
const searchInput = document.getElementById("search-input");
const hideFailedChk = document.getElementById("hide-failed");
const onlyRatedChk = document.getElementById("only-rated");
const sortSelect = document.getElementById("sort-select");
const countLabel = document.getElementById("order-count");
const lastSyncedLabel = document.getElementById("last-synced-label");
const tableContainer = document.getElementById("table-container");
const emptyState = document.getElementById("empty-state");
const loadingState = document.getElementById("loading-state");

// ---------------------------------------------------------------------------
// Fetch & render
// ---------------------------------------------------------------------------
async function loadOrders() {
  try {
    const res = await fetch(`${API}/orders`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allOrders = data.orders || [];
    lastSynced = data.last_synced || null;
    updateLastSynced();
    renderTable();
  } catch (err) {
    loadingState.innerHTML = `
      <div class="text-4xl mb-4">⚠️</div>
      <p class="text-red-400 text-sm">Could not connect to backend.<br>Run <code class="bg-[#1a1a1a] px-1 rounded">python backend/app.py</code> and refresh.</p>`;
  }
}

function updateLastSynced() {
  if (!lastSynced) {
    lastSyncedLabel.textContent = "Never synced";
    return;
  }
  const diff = Math.floor((Date.now() - new Date(lastSynced)) / 1000);
  let label;
  if (diff < 60) label = `${diff}s ago`;
  else if (diff < 3600) label = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
  else label = new Date(lastSynced).toLocaleDateString();
  lastSyncedLabel.textContent = `Last synced ${label}`;
}

function getFiltered() {
  const q = searchInput.value.trim().toLowerCase();
  const hideFailed = hideFailedChk.checked;
  const onlyRated = onlyRatedChk.checked;
  const sort = sortSelect.value;

  let list = allOrders.filter((o) => {
    if (hideFailed && o.status !== "delivered") return false;
    if (onlyRated && (!o.user_custom_data || o.user_custom_data.rating === 0)) return false;
    if (q) {
      const haystack = `${o.venue_name} ${o.items}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  list = list.slice().sort((a, b) => {
    if (sort === "date_desc") return compareDates(b.received_at, a.received_at);
    if (sort === "date_asc") return compareDates(a.received_at, b.received_at);
    if (sort === "rating_desc") {
      return (b.user_custom_data?.rating || 0) - (a.user_custom_data?.rating || 0);
    }
    if (sort === "venue_asc") return a.venue_name.localeCompare(b.venue_name);
    return 0;
  });

  return list;
}

function compareDates(a, b) {
  return parseDate(a) - parseDate(b);
}

function parseDate(str) {
  if (!str) return 0;
  // "09/05/2026, 20:04" → parseable
  const [datePart, timePart] = str.split(", ");
  if (!datePart) return 0;
  const [d, m, y] = datePart.split("/");
  return new Date(`${y}-${m}-${d}T${timePart || "00:00"}:00`).getTime();
}

function renderTable() {
  loadingState.classList.add("hidden");
  const list = getFiltered();

  countLabel.textContent = `${list.length} of ${allOrders.length} orders`;

  if (allOrders.length === 0) {
    tableContainer.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.classList.add("flex");
    return;
  }

  emptyState.classList.add("hidden");
  emptyState.classList.remove("flex");
  tableContainer.classList.remove("hidden");

  tbody.innerHTML = "";
  for (const order of list) {
    tbody.appendChild(buildRow(order));
  }
}

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------
function buildRow(order) {
  const ucd = order.user_custom_data || { rating: 0, notes: "", last_edited: null };
  const tr = document.createElement("tr");
  tr.className = "row-fade hover:bg-[#141414] transition-colors";
  tr.dataset.id = order.purchase_id;

  const statusHtml = order.status === "delivered"
    ? `<span class="status-badge text-xs text-emerald-400"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span> Delivered</span>`
    : `<span class="status-badge text-xs text-red-400"><span class="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"></span> Failed</span>`;

  const starsHtml = buildStars(ucd.rating, order.purchase_id);

  tr.innerHTML = `
    <td class="py-3 pr-4">${statusHtml}</td>
    <td class="py-3 pr-4 text-gray-400 text-xs whitespace-nowrap">${escHtml(order.received_at)}</td>
    <td class="py-3 pr-4 font-medium text-gray-100 truncate max-w-[10rem]" title="${escHtml(order.venue_name)}">${escHtml(order.venue_name)}</td>
    <td class="py-3 pr-4 text-gray-400 text-xs leading-relaxed">${escHtml(order.items)}</td>
    <td class="py-3 pr-4 text-right text-gray-300 whitespace-nowrap">${escHtml(order.total_amount)}</td>
    <td class="py-3 pr-4">${starsHtml}</td>
    <td class="py-3">
      <textarea
        class="notes-area w-full bg-transparent text-xs text-gray-400 placeholder-gray-700 border-b border-transparent focus:border-[#333] transition-colors"
        placeholder="Add notes…"
        data-id="${escHtml(order.purchase_id)}"
      >${escHtml(ucd.notes)}</textarea>
    </td>`;

  // Star click handlers
  tr.querySelectorAll(".star-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rating = parseInt(btn.dataset.value, 10);
      saveUpdate(order.purchase_id, { rating });
      // Update local state & re-render stars in row
      order.user_custom_data.rating = rating;
      tr.querySelector(".stars-wrap").innerHTML = buildStars(rating, order.purchase_id);
      rebindStars(tr, order);
    });
  });

  // Notes blur handler
  const textarea = tr.querySelector("textarea");
  textarea.addEventListener("blur", () => {
    const notes = textarea.value;
    if (notes !== ucd.notes) {
      ucd.notes = notes;
      saveUpdate(order.purchase_id, { notes });
    }
  });

  return tr;
}

function buildStars(current, id) {
  const stars = [1, 2, 3, 4, 5].map((v) => {
    const filled = v <= current;
    return `<button class="star-btn text-lg leading-none" data-id="${escHtml(id)}" data-value="${v}" title="${v} star${v > 1 ? "s" : ""}">${filled ? "★" : "☆"}</button>`;
  }).join("");
  return `<div class="stars-wrap flex gap-0.5 text-yellow-400">${stars}</div>`;
}

function rebindStars(tr, order) {
  tr.querySelectorAll(".star-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rating = parseInt(btn.dataset.value, 10);
      saveUpdate(order.purchase_id, { rating });
      order.user_custom_data.rating = rating;
      tr.querySelector(".stars-wrap").innerHTML = buildStars(rating, order.purchase_id);
      rebindStars(tr, order);
    });
  });
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function saveUpdate(purchaseId, fields) {
  try {
    await fetch(`${API}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchase_id: purchaseId, ...fields }),
    });
  } catch (err) {
    console.error("Failed to save update:", err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
searchInput.addEventListener("input", renderTable);
hideFailedChk.addEventListener("change", renderTable);
onlyRatedChk.addEventListener("change", renderTable);
sortSelect.addEventListener("change", renderTable);

// Refresh last-synced label every minute
setInterval(updateLastSynced, 60_000);

// Boot
loadOrders();
