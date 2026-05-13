const API = "http://localhost:5000";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let allOrders = [];
let lastSynced = null;

// Infinite scroll
const PAGE_SIZE = 25;
let visibleCount = PAGE_SIZE;
let currentList  = [];

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const tbody            = document.getElementById("orders-tbody");
const searchInput      = document.getElementById("search-input");
const onlyRatedChk     = document.getElementById("only-rated");
const sortSelect       = document.getElementById("sort-select");
const countLabel       = document.getElementById("order-count");
const lastSyncedLabel  = document.getElementById("last-synced-label");
const tableContainer   = document.getElementById("table-container");
const emptyState       = document.getElementById("empty-state");
const errorState       = document.getElementById("error-state");
const loadingState     = document.getElementById("loading-state");
const skeletonTbody    = document.getElementById("skeleton-tbody");
const exportBtn        = document.getElementById("export-btn");
const unratedCard      = document.getElementById("stat-unrated-card");
const modalBackdrop    = document.getElementById("modal-backdrop");
const modalClose       = document.getElementById("modal-close");
const scrollSentinel   = document.getElementById("scroll-sentinel");

// ---------------------------------------------------------------------------
// Star SVG
// ---------------------------------------------------------------------------
const STAR_PATH = `<path d="M16.926 20.2a1 1 0 0 1-.466-.115l-4.471-2.352-4.471 2.348a1 1 0 0 1-1.451-1.054l.854-4.98L3.3 10.521a1 1 0 0 1 .555-1.706l5-.727 2.237-4.531A1 1 0 0 1 11.989 3a1 1 0 0 1 .9.558l2.236 4.53 5 .727a1 1 0 0 1 .555 1.706l-3.618 3.527.854 4.98a1 1 0 0 1-.99 1.172z"/>`;

function starSvg(filled, size = 20) {
  const color = filled ? "#f59e0b" : "#d1d5db";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="${color}">${STAR_PATH}</svg>`;
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------
function buildSkeletonRows(n = 8) {
  const widths = [60, 80, 160, 160, 50, 110, 140];
  skeletonTbody.innerHTML = Array.from({ length: n }, () => `
    <tr class="skeleton-row">
      ${widths.map(w => `<td><span class="skeleton" style="width:${w}px;height:13px"></span></td>`).join("")}
    </tr>`).join("");
}

// ---------------------------------------------------------------------------
// Fetch & render
// ---------------------------------------------------------------------------
async function loadOrders() {
  buildSkeletonRows();
  try {
    const res = await fetch(`${API}/orders`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Always exclude failed orders
    allOrders = (data.orders || []).filter(o => o.status === "delivered");
    lastSynced = data.last_synced || null;
    updateLastSynced();
    renderTable();
  } catch {
    loadingState.style.display = "none";
    errorState.style.display = "flex";
  }
}

function updateLastSynced() {
  if (!lastSynced) { lastSyncedLabel.textContent = "Never synced"; return; }
  const diff = Math.floor((Date.now() - new Date(lastSynced)) / 1000);
  let label;
  if (diff < 60)         label = `${diff}s ago`;
  else if (diff < 3600)  label = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
  else label = new Date(lastSynced).toLocaleDateString();
  lastSyncedLabel.textContent = `Last synced ${label}`;
}

function getFiltered() {
  const q         = searchInput.value.trim().toLowerCase();
  const onlyRated = onlyRatedChk.checked;
  const sort      = sortSelect.value;

  // allOrders already excludes failed orders at load time
  let list = allOrders.filter(o => {
    if (onlyRated && (!o.user_custom_data || o.user_custom_data.rating === 0)) return false;
    if (q && !`${o.venue_name} ${o.items}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return list.slice().sort((a, b) => {
    if (sort === "date_desc")   return compareDates(b.received_at, a.received_at);
    if (sort === "date_asc")    return compareDates(a.received_at, b.received_at);
    if (sort === "rating_desc") return (b.user_custom_data?.rating || 0) - (a.user_custom_data?.rating || 0);
    if (sort === "value_desc")  return parseAmount(b.total_amount) - parseAmount(a.total_amount);
    if (sort === "venue_asc")   return a.venue_name.localeCompare(b.venue_name);
    return 0;
  });
}

function renderTable(resetScroll = true) {
  loadingState.style.display = "none";

  currentList = getFiltered();
  if (resetScroll) visibleCount = PAGE_SIZE;

  updateStats(currentList);
  countLabel.textContent = `${currentList.length} of ${allOrders.length} orders`;

  if (allOrders.length === 0) {
    tableContainer.classList.add("hidden");
    emptyState.style.display = "flex";
    return;
  }

  emptyState.style.display = "none";
  tableContainer.classList.remove("hidden");

  renderRows();
}

function renderRows() {
  tbody.innerHTML = "";
  const slice = currentList.slice(0, visibleCount);
  for (const order of slice) tbody.appendChild(buildRow(order));
}

// ---------------------------------------------------------------------------
// Infinite scroll via IntersectionObserver
// ---------------------------------------------------------------------------
const scrollObserver = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && visibleCount < currentList.length) {
    visibleCount += PAGE_SIZE;
    renderRows();
  }
}, { rootMargin: "200px" });

if (scrollSentinel) scrollObserver.observe(scrollSentinel);

// ---------------------------------------------------------------------------
// Stats — delivered only (failed already excluded from allOrders)
// ---------------------------------------------------------------------------
function updateStats(list) {
  const spent = list.reduce((sum, o) => sum + parseAmount(o.total_amount), 0);
  document.getElementById("stat-count").textContent      = list.length;
  document.getElementById("stat-spent").textContent      = list.length ? fmtEuro(spent) : "—";
  document.getElementById("stat-avg-value").textContent  =
    list.length ? fmtEuro(spent / list.length) : "—";

  const rated = list.filter(o => o.user_custom_data?.rating > 0);
  const avgRating = rated.length
    ? (rated.reduce((s, o) => s + o.user_custom_data.rating, 0) / rated.length).toFixed(1)
    : "—";
  const avgRatingEl = document.getElementById("stat-avg-rating");
  const avgRatingStar = document.getElementById("stat-avg-rating-star");
  avgRatingEl.childNodes[0].textContent = avgRating !== "—" ? avgRating : "—";
  avgRatingStar.style.display = avgRating !== "—" ? "inline" : "none";

  const venueCount = {};
  const venueSpent = {};
  for (const o of list) {
    venueCount[o.venue_name] = (venueCount[o.venue_name] || 0) + 1;
    venueSpent[o.venue_name] = (venueSpent[o.venue_name] || 0) + parseAmount(o.total_amount);
  }
  const topVenue = Object.entries(venueCount).sort((a, b) => b[1] - a[1])[0];
  document.getElementById("stat-top-venue").textContent = topVenue ? topVenue[0] : "—";
  document.getElementById("stat-top-venue-sub").textContent = topVenue
    ? `${topVenue[1]} order${topVenue[1] !== 1 ? "s" : ""} · ${fmtEuro(venueSpent[topVenue[0]])}` : "";

  const unratedCount = list.filter(o => !o.user_custom_data?.rating).length;
  document.getElementById("stat-unrated").textContent = unratedCount;
  document.getElementById("stat-unrated-sub").textContent =
    unratedCount > 0 ? "click to review" : "all rated ✓";
}

function parseAmount(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function fmtEuro(amount) {
  return `${amount.toFixed(2).replace(".", ",")}€`;
}

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------
function buildRow(order) {
  const ucd = order.user_custom_data || { rating: 0, notes: "", last_edited: null };
  const tr  = document.createElement("tr");
  tr.className = "row-fade";
  tr.dataset.id = order.purchase_id;

  tr.innerHTML = `
    <td style="color:var(--text-3);font-size:12px;white-space:nowrap">${escHtml(order.received_at)}</td>
    <td><button class="venue-link" title="${escHtml(order.venue_name)}">${escHtml(order.venue_name)}</button></td>
    <td class="items-cell">
      ${splitItems(order.items).map(i => `<div class="item-line">${escHtml(i)}</div>`).join("")}
    </td>
    <td class="total-cell" style="text-align:right">${escHtml(fmtEuro(parseAmount(order.total_amount)))}</td>
    <td><div class="stars-wrap" id="stars-${escHtml(order.purchase_id)}">${buildStars(ucd.rating, order.purchase_id)}</div></td>
    <td>
      <textarea class="notes-area" placeholder="Add a note…" data-id="${escHtml(order.purchase_id)}">${escHtml(ucd.notes)}</textarea>
    </td>`;

  tr.querySelector(".venue-link").addEventListener("click", () => openModal(order.venue_name));
  bindStars(tr, order);

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

// ---------------------------------------------------------------------------
// Stars — SVG
// ---------------------------------------------------------------------------
function buildStars(current, id) {
  return [1, 2, 3, 4, 5].map(v =>
    `<button class="star-btn${v <= current ? " filled" : ""}" data-id="${escHtml(id)}" data-value="${v}" title="${v} star${v > 1 ? "s" : ""}">${starSvg(v <= current)}</button>`
  ).join("");
}

function bindStars(tr, order) {
  const wrap = tr.querySelector(".stars-wrap");
  const ucd  = order.user_custom_data;

  wrap.querySelectorAll(".star-btn").forEach(btn => {
    btn.addEventListener("mouseenter", () => {
      const hv = parseInt(btn.dataset.value, 10);
      wrap.querySelectorAll(".star-btn").forEach(b => {
        const v = parseInt(b.dataset.value, 10);
        b.innerHTML = starSvg(v <= hv);
      });
    });
    btn.addEventListener("mouseleave", () => {
      wrap.querySelectorAll(".star-btn").forEach(b => {
        const v = parseInt(b.dataset.value, 10);
        b.innerHTML = starSvg(v <= ucd.rating);
      });
    });
    btn.addEventListener("click", () => {
      const rating = parseInt(btn.dataset.value, 10);
      ucd.rating = rating;
      saveUpdate(order.purchase_id, { rating });
      wrap.innerHTML = buildStars(rating, order.purchase_id);
      bindStars(tr, order);
      updateStats(currentList);
    });
  });
}

// ---------------------------------------------------------------------------
// Restaurant detail modal
// ---------------------------------------------------------------------------
function openModal(venueName) {
  // Modal uses all delivered orders for that venue
  const venueOrders = allOrders
    .filter(o => o.venue_name === venueName)
    .sort((a, b) => compareDates(b.received_at, a.received_at));

  const spent = venueOrders.reduce((s, o) => s + parseAmount(o.total_amount), 0);
  const rated = venueOrders.filter(o => o.user_custom_data?.rating > 0);
  const avgRating = rated.length
    ? (rated.reduce((s, o) => s + o.user_custom_data.rating, 0) / rated.length).toFixed(1)
    : "—";

  document.getElementById("modal-venue-name").textContent = venueName;
  document.getElementById("modal-venue-sub").textContent  =
    `First order ${venueOrders[venueOrders.length - 1]?.received_at || ""}`;
  document.getElementById("modal-stat-orders").textContent = venueOrders.length;
  document.getElementById("modal-stat-spent").textContent  = fmtEuro(spent);
  const modalRatingEl = document.getElementById("modal-stat-rating");
  const modalRatingStar = document.getElementById("modal-stat-rating-star");
  modalRatingEl.childNodes[0].textContent = avgRating !== "—" ? avgRating : "—";
  modalRatingStar.style.display = avgRating !== "—" ? "inline" : "none";

  // Item frequency
  const itemFreq = {};
  for (const o of venueOrders) {
    for (const item of splitItems(o.items)) {
      itemFreq[item] = (itemFreq[item] || 0) + 1;
    }
  }
  const topItems = Object.entries(itemFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  document.getElementById("modal-items-list").innerHTML = topItems.length
    ? topItems.map(([name, count]) => `
        <span class="item-chip">
          ${escHtml(name)}
          ${count > 1 ? `<span class="item-chip-count">×${count}</span>` : ""}
        </span>`).join("")
    : `<p style="color:var(--text-3);font-size:13px">No item data available.</p>`;

  // Order history — items on separate rows
  document.getElementById("modal-orders-list").innerHTML = venueOrders.map(o => {
    const ucd   = o.user_custom_data || {};
    const stars = [1,2,3,4,5].map(v =>
      `<span class="modal-mini-star">${starSvg(v <= ucd.rating, 14)}</span>`
    ).join("");
    const itemLines = splitItems(o.items)
      .map(i => `<div class="modal-item-line">${escHtml(i)}</div>`)
      .join("") || escHtml(o.items || "—");
    return `
      <div class="modal-order-row">
        <div class="modal-order-date">${escHtml(o.received_at)}</div>
        <div class="modal-order-items">
          ${itemLines}
          ${ucd.notes ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px">💬 ${escHtml(ucd.notes)}</div>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
          <div class="modal-order-total">${fmtEuro(parseAmount(o.total_amount))}</div>
          <div class="modal-order-stars">${stars}</div>
        </div>
      </div>`;
  }).join("");

  modalBackdrop.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modalBackdrop.classList.remove("open");
  document.body.style.overflow = "";
}

modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", e => { if (e.target === modalBackdrop) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
const toastContainer = document.getElementById("toast-container");

function showToast(message, type = "info", duration = 4000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("out");
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
exportBtn.addEventListener("click", async () => {
  try {
    const res = await fetch(`${API}/export`);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "orders_db.json"; a.click();
    URL.revokeObjectURL(url);
  } catch {
    showToast("Export failed — is the backend running?", "error");
  }
});

// ---------------------------------------------------------------------------
// Unrated card shortcut
// ---------------------------------------------------------------------------
unratedCard.addEventListener("click", () => {
  onlyRatedChk.checked = false;
  document.getElementById("chip-only-rated").classList.remove("active");
  searchInput.value = "";

  const list = allOrders.filter(o => !o.user_custom_data?.rating);
  currentList  = list;
  visibleCount = PAGE_SIZE;
  updateStats(list);
  countLabel.textContent = `${list.length} of ${allOrders.length} orders`;
  emptyState.style.display = list.length === 0 ? "flex" : "none";
  tableContainer.classList.toggle("hidden", list.length === 0);
  renderRows();
});

// ---------------------------------------------------------------------------
// API
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
function compareDates(a, b) { return parseDate(a) - parseDate(b); }

function parseDate(str) {
  if (!str) return 0;
  const [datePart, timePart] = str.split(", ");
  if (!datePart) return 0;
  const [d, m, y] = datePart.split("/");
  return new Date(`${y}-${m}-${d}T${timePart || "00:00"}:00`).getTime();
}

function splitItems(str) {
  if (!str) return [];
  return str.split(" and ").map(s => s.trim()).filter(Boolean);
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
searchInput.addEventListener("input", () => renderTable(true));
onlyRatedChk.addEventListener("change", () => renderTable(true));
sortSelect.addEventListener("change", () => renderTable(true));

onlyRatedChk.addEventListener("change", () => {
  onlyRatedChk.closest(".filter-chip").classList.toggle("active", onlyRatedChk.checked);
});

setInterval(updateLastSynced, 60_000);

loadOrders();
