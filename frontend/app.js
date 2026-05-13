const API = "http://localhost:5000";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let allOrders = [];
let lastSynced = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const tbody            = document.getElementById("orders-tbody");
const searchInput      = document.getElementById("search-input");
const hideFailedChk    = document.getElementById("hide-failed");
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

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------
function buildSkeletonRows(n = 8) {
  const widths = [60, 80, 120, 200, 50, 100, 140];
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
    allOrders = data.orders || [];
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
  if (diff < 60)    label = `${diff}s ago`;
  else if (diff < 3600)  label = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
  else label = new Date(lastSynced).toLocaleDateString();
  lastSyncedLabel.textContent = `Last synced ${label}`;
}

function getFiltered() {
  const q          = searchInput.value.trim().toLowerCase();
  const hideFailed = hideFailedChk.checked;
  const onlyRated  = onlyRatedChk.checked;
  const sort       = sortSelect.value;

  let list = allOrders.filter(o => {
    if (hideFailed && o.status !== "delivered") return false;
    if (onlyRated && (!o.user_custom_data || o.user_custom_data.rating === 0)) return false;
    if (q && !`${o.venue_name} ${o.items}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return list.slice().sort((a, b) => {
    if (sort === "date_desc")   return compareDates(b.received_at, a.received_at);
    if (sort === "date_asc")    return compareDates(a.received_at, b.received_at);
    if (sort === "rating_desc") return (b.user_custom_data?.rating || 0) - (a.user_custom_data?.rating || 0);
    if (sort === "venue_asc")   return a.venue_name.localeCompare(b.venue_name);
    return 0;
  });
}

function renderTable() {
  loadingState.style.display = "none";

  const list = getFiltered();
  updateStats(list);
  countLabel.textContent = `${list.length} of ${allOrders.length} orders`;

  if (allOrders.length === 0) {
    tableContainer.classList.add("hidden");
    emptyState.style.display = "flex";
    return;
  }

  emptyState.style.display = "none";
  tableContainer.classList.remove("hidden");

  tbody.innerHTML = "";
  for (const order of list) {
    tbody.appendChild(buildRow(order));
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function updateStats(list) {
  const delivered = list.filter(o => o.status === "delivered");

  // Total spent
  const spent = delivered.reduce((sum, o) => sum + parseAmount(o.total_amount), 0);
  document.getElementById("stat-count").textContent   = list.length;
  document.getElementById("stat-spent").textContent   = list.length ? `€${spent.toFixed(2)}` : "—";
  document.getElementById("stat-avg-value").textContent =
    delivered.length ? `€${(spent / delivered.length).toFixed(2)}` : "—";

  // Avg rating (only rated orders)
  const rated = list.filter(o => o.user_custom_data?.rating > 0);
  const avgRating = rated.length
    ? (rated.reduce((s, o) => s + o.user_custom_data.rating, 0) / rated.length).toFixed(1)
    : "—";
  document.getElementById("stat-avg-rating").textContent = avgRating !== "—" ? `${avgRating} ★` : "—";

  // Top venue
  const venueCount = {};
  for (const o of list) venueCount[o.venue_name] = (venueCount[o.venue_name] || 0) + 1;
  const topVenue = Object.entries(venueCount).sort((a, b) => b[1] - a[1])[0];
  document.getElementById("stat-top-venue").textContent = topVenue ? topVenue[0] : "—";

  // Unrated
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

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------
function buildRow(order) {
  const ucd = order.user_custom_data || { rating: 0, notes: "", last_edited: null };
  const tr  = document.createElement("tr");
  tr.className = "row-fade" + (order.status !== "delivered" ? " failed-row" : "");
  tr.dataset.id = order.purchase_id;

  const statusHtml = order.status === "delivered"
    ? `<span class="badge delivered"><span class="badge-dot"></span>Delivered</span>`
    : `<span class="badge failed"><span class="badge-dot"></span>Failed</span>`;

  tr.innerHTML = `
    <td>${statusHtml}</td>
    <td style="color:var(--text-3);font-size:12px;white-space:nowrap">${escHtml(order.received_at)}</td>
    <td><button class="venue-link" data-venue="${escHtml(order.venue_name)}" title="${escHtml(order.venue_name)}">${escHtml(order.venue_name)}</button></td>
    <td class="items-cell">
      <span class="items-text">${escHtml(order.items)}</span>
      <div class="items-tooltip">${escHtml(order.items)}</div>
    </td>
    <td class="total-cell" style="text-align:right">${escHtml(order.total_amount)}</td>
    <td><div class="stars-wrap" id="stars-${escHtml(order.purchase_id)}">${buildStars(ucd.rating, order.purchase_id)}</div></td>
    <td>
      <textarea class="notes-area" placeholder="Add a note…" data-id="${escHtml(order.purchase_id)}">${escHtml(ucd.notes)}</textarea>
    </td>`;

  // Venue modal
  tr.querySelector(".venue-link").addEventListener("click", () => openModal(order.venue_name));

  // Star handlers
  bindStars(tr, order);

  // Notes blur
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
// Stars
// ---------------------------------------------------------------------------
function buildStars(current, id) {
  return [1, 2, 3, 4, 5].map(v => {
    const filled = v <= current;
    return `<button class="star-btn${filled ? " filled" : ""}" data-id="${escHtml(id)}" data-value="${v}" title="${v} star${v > 1 ? "s" : ""}">★</button>`;
  }).join("");
}

function bindStars(tr, order) {
  const wrap = tr.querySelector(".stars-wrap");
  const ucd  = order.user_custom_data;

  wrap.querySelectorAll(".star-btn").forEach(btn => {
    // Hover preview
    btn.addEventListener("mouseenter", () => {
      const hv = parseInt(btn.dataset.value, 10);
      wrap.querySelectorAll(".star-btn").forEach(b =>
        b.classList.toggle("filled", parseInt(b.dataset.value, 10) <= hv)
      );
    });
    btn.addEventListener("mouseleave", () => {
      wrap.querySelectorAll(".star-btn").forEach(b =>
        b.classList.toggle("filled", parseInt(b.dataset.value, 10) <= ucd.rating)
      );
    });
    btn.addEventListener("click", () => {
      const rating = parseInt(btn.dataset.value, 10);
      ucd.rating = rating;
      saveUpdate(order.purchase_id, { rating });
      wrap.innerHTML = buildStars(rating, order.purchase_id);
      bindStars(tr, order);
      updateStats(getFiltered());
    });
  });
}

// ---------------------------------------------------------------------------
// Restaurant detail modal
// ---------------------------------------------------------------------------
function openModal(venueName) {
  const venueOrders = allOrders
    .filter(o => o.venue_name === venueName)
    .sort((a, b) => compareDates(b.received_at, a.received_at));

  const delivered = venueOrders.filter(o => o.status === "delivered");
  const spent = delivered.reduce((s, o) => s + parseAmount(o.total_amount), 0);
  const rated = venueOrders.filter(o => o.user_custom_data?.rating > 0);
  const avgRating = rated.length
    ? (rated.reduce((s, o) => s + o.user_custom_data.rating, 0) / rated.length).toFixed(1)
    : "—";

  document.getElementById("modal-venue-name").textContent = venueName;
  document.getElementById("modal-venue-sub").textContent  =
    `First order ${venueOrders[venueOrders.length - 1]?.received_at || ""}`;
  document.getElementById("modal-stat-orders").textContent = venueOrders.length;
  document.getElementById("modal-stat-spent").textContent  = `€${spent.toFixed(2)}`;
  document.getElementById("modal-stat-rating").textContent = avgRating !== "—" ? `${avgRating} ★` : "—";

  // Item frequency
  const itemFreq = {};
  for (const o of venueOrders) {
    if (!o.items) continue;
    for (const item of o.items.split(",").map(s => s.trim()).filter(Boolean)) {
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

  // Order history
  document.getElementById("modal-orders-list").innerHTML = venueOrders.map(o => {
    const ucd = o.user_custom_data || {};
    const stars = [1,2,3,4,5].map(v =>
      `<span class="modal-mini-star${v <= ucd.rating ? " filled" : ""}">★</span>`
    ).join("");
    return `
      <div class="modal-order-row">
        <div class="modal-order-date">${escHtml(o.received_at)}</div>
        <div class="modal-order-items">
          ${escHtml(o.items || "—")}
          ${ucd.notes ? `<div style="font-size:11px;color:var(--text-3);margin-top:3px">💬 ${escHtml(ucd.notes)}</div>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
          <div class="modal-order-total">${escHtml(o.total_amount)}</div>
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
    a.href     = url;
    a.download = "orders_db.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    showToast("Export failed — is the backend running?", "error");
  }
});

// ---------------------------------------------------------------------------
// Unrated card filter shortcut
// ---------------------------------------------------------------------------
unratedCard.addEventListener("click", () => {
  onlyRatedChk.checked = false;
  hideFailedChk.checked = false;
  searchInput.value = "";
  // Custom filter: show only unrated delivered orders
  const q = "__unrated__";
  searchInput.dataset.unratedFilter = "1";
  renderTable();
  delete searchInput.dataset.unratedFilter;
});

// Override getFiltered for unrated shortcut
const _origGetFiltered = getFiltered;

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
function compareDates(a, b) { return parseDate(a) - parseDate(b); }

function parseDate(str) {
  if (!str) return 0;
  const [datePart, timePart] = str.split(", ");
  if (!datePart) return 0;
  const [d, m, y] = datePart.split("/");
  return new Date(`${y}-${m}-${d}T${timePart || "00:00"}:00`).getTime();
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
searchInput.addEventListener("input", renderTable);
hideFailedChk.addEventListener("change", renderTable);
onlyRatedChk.addEventListener("change", renderTable);
sortSelect.addEventListener("change", renderTable);

// Sync chip active state on checkboxes
[hideFailedChk, onlyRatedChk].forEach(chk => {
  chk.addEventListener("change", () => {
    chk.closest(".filter-chip").classList.toggle("active", chk.checked);
  });
});

// Unrated card — show only unrated
unratedCard.addEventListener("click", () => {
  onlyRatedChk.checked = false;
  document.getElementById("chip-only-rated").classList.remove("active");
  searchInput.value = "";

  // Temporarily override filter to show unrated only
  const list = allOrders.filter(o => !o.user_custom_data?.rating);
  updateStats(list);
  countLabel.textContent = `${list.length} of ${allOrders.length} orders`;
  emptyState.style.display = list.length === 0 ? "flex" : "none";
  tableContainer.classList.toggle("hidden", list.length === 0);
  tbody.innerHTML = "";
  for (const order of list) tbody.appendChild(buildRow(order));
});

// Refresh last-synced label every minute
setInterval(updateLastSynced, 60_000);

// Boot
loadOrders();
