const API_BASE = "http://localhost:5000";

const elements = {
  orders: document.getElementById("orders"),
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search-input"),
  status: document.getElementById("status-filter"),
  year: document.getElementById("year-filter"),
  sort: document.getElementById("sort-select"),
  unrated: document.getElementById("unrated-only"),
  groupByDay: document.getElementById("group-by-day"),
  lastSynced: document.getElementById("last-synced"),
  orderCount: document.getElementById("order-count"),
  importButton: document.getElementById("import-button"),
  importFile: document.getElementById("import-file"),
  exportButton: document.getElementById("export-button"),
  demoButton: document.getElementById("demo-button"),
  toast: document.getElementById("toast"),
};

let allOrders = [];
let demoMode = localStorage.getItem("trackali-demo") === "1";

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function parseOrderDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function orderYear(order) {
  const timestamp = parseOrderDate(order.order_date);
  return timestamp ? String(new Date(timestamp).getFullYear()) : "";
}

function parseMoney(value) {
  const text = String(value || "").replaceAll("â‚¬", "€").trim();
  let numeric = text.replace(/[^\d,.-]/g, "");
  if (!/\d/.test(numeric)) return null;
  const comma = numeric.lastIndexOf(",");
  const dot = numeric.lastIndexOf(".");
  if (comma > dot) {
    numeric = numeric.replace(/\./g, "").replace(",", ".");
  } else {
    numeric = numeric.replace(/,/g, "");
  }
  const amount = Number(numeric);
  if (!Number.isFinite(amount)) return null;
  let currency = "";
  if (text.includes("€") || /\bEUR\b/i.test(text)) currency = "EUR";
  else if (text.includes("£") || /\bGBP\b/i.test(text)) currency = "GBP";
  else if (text.includes("$") || /\bUSD\b|US\s*\$/i.test(text)) currency = "USD";
  return { amount, currency };
}

function totalBreakdown(orders) {
  const totals = new Map();
  orders.forEach((order) => {
    const money = parseMoney(order.total);
    if (!money) return;
    totals.set(money.currency, (totals.get(money.currency) || 0) + money.amount);
  });
  return [...totals.entries()]
    .filter(([currency]) => currency)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({
      currency,
      formatted: new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(amount),
    }));
}

function totalHtml(orders) {
  const totals = totalBreakdown(orders);
  if (!totals.length) return "<strong>-</strong>";
  return totals.map((total) => `
    <span class="order-total-line">${escapeHtml(total.formatted)}</span>
  `).join("");
}

function priceSortValue(order) {
  const totals = order._groupedOrders ? totalBreakdown(order._groupedOrders) : totalBreakdown([order]);
  return Math.max(0, ...totals.map((total) => {
    const money = parseMoney(total.formatted);
    return money?.amount || 0;
  }));
}

function dayKey(order) {
  const timestamp = parseOrderDate(order.order_date);
  if (!timestamp) return `unknown-${order.order_id}`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupOrdersByDay(orders) {
  const days = new Map();
  orders.forEach((order) => {
    const key = dayKey(order);
    const existing = days.get(key);
    if (!existing) {
      days.set(key, {
        ...order,
        _dayGroup: true,
        _groupedOrders: [order],
        order_id: `day-${key}`,
        order_ids: [...(order.order_ids || [order.order_id])],
        seller_names: [...(order.seller_names || [order.seller_name])],
        products: [...(order.products || [])],
      });
      return;
    }

    existing._groupedOrders.push(order);
    existing.order_ids.push(...(order.order_ids || [order.order_id]));
    (order.seller_names || [order.seller_name]).filter(Boolean).forEach((seller) => {
      if (!existing.seller_names.includes(seller)) existing.seller_names.push(seller);
    });
    existing.products.push(...(order.products || []));
    if (existing.status !== order.status) existing.status = "Mixed status";
  });
  return [...days.values()];
}

function consolidateOrders(orders) {
  const grouped = new Map();
  for (const order of orders) {
    const orderId = String(order.order_id || "").trim();
    if (!orderId) continue;
    const groupId = String(order.checkout_id || orderId).trim();
    const existing = grouped.get(groupId);
    if (!existing) {
      grouped.set(groupId, {
        ...order,
        order_ids: [orderId],
        seller_names: [order.seller_name].filter(Boolean),
        products: (order.products || []).map((product) => ({
          ...product,
          seller_name: order.seller_name,
        })),
        user_custom_data: { ...(order.user_custom_data || {}) },
      });
      continue;
    }

    if (!existing.order_ids.includes(orderId)) existing.order_ids.push(orderId);
    if (order.seller_name && !existing.seller_names.includes(order.seller_name)) {
      existing.seller_names.push(order.seller_name);
    }
    const products = new Map();
    [
      ...(existing.products || []),
      ...(order.products || []).map((product) => ({ ...product, seller_name: order.seller_name })),
    ].forEach((product) => {
      const key = [product.product_url, product.name, product.variant, product.price].join("|");
      const current = products.get(key);
      products.set(key, current
        ? { ...current, quantity: Math.max(Number(current.quantity || 1), Number(product.quantity || 1)) }
        : { ...product });
    });
    existing.products = [...products.values()];
    const existingMoney = parseMoney(existing.total);
    const orderMoney = parseMoney(order.total);
    if (existingMoney && orderMoney && existingMoney.currency === orderMoney.currency) {
      existing.total = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: existingMoney.currency,
      }).format(existingMoney.amount + orderMoney.amount);
    }
    if (existing.status !== order.status) existing.status = "Mixed status";
  }
  return [...grouped.values()];
}

function statusClass(value) {
  const status = String(value || "").toLowerCase();
  if (/complete|processed|deliver/.test(status)) return "done";
  if (/cancel|refund/.test(status)) return "muted";
  if (/ship|transit/.test(status)) return "moving";
  return "pending";
}

function stars(order) {
  const rating = Number(order.user_custom_data?.rating || 0);
  return [1, 2, 3, 4, 5].map((value) => `
    <button class="star ${value <= rating ? "filled" : ""}" data-rating="${value}" aria-label="Rate ${value} out of 5">★</button>
  `).join("");
}

function productHtml(product) {
  const localImage = safeUrl(product.local_image_url
    ? `${API_BASE}${product.local_image_url}`
    : "");
  const remoteImage = safeUrl(product.image_url);
  const image = localImage || remoteImage;
  const productUrl = safeUrl(product.product_url);
  const content = `
    <div class="product-image">${image
      ? `<img src="${escapeHtml(image)}" ${localImage && remoteImage ? `data-fallback="${escapeHtml(remoteImage)}"` : ""} alt="" loading="lazy" />`
      : "<span>TA</span>"}</div>
    <div class="product-copy">
      <strong>${escapeHtml(product.name)}</strong>
      ${product.variant ? `<small>${escapeHtml(product.variant)}</small>` : ""}
      ${product.seller_name ? `<small>${escapeHtml(product.seller_name)}</small>` : ""}
      <span>${product.quantity > 1 ? `Qty ${product.quantity} · ` : ""}${escapeHtml(product.price || "")}</span>
    </div>`;
  return productUrl
    ? `<a class="product" href="${escapeHtml(productUrl)}" target="_blank" rel="noopener">${content}</a>`
    : `<div class="product">${content}</div>`;
}

function orderHtml(order) {
  const orderUrl = safeUrl(order.order_url);
  const sellerUrl = safeUrl(order.seller_url);
  const sellers = order.seller_names || [order.seller_name];
  const sellerLabel = sellers.length > 1 ? `${sellers.length} sellers` : sellers[0];
  const custom = order.user_custom_data || {};
  return `
    <article class="order-card" data-order-id="${escapeHtml(order.order_id)}">
      <div class="order-head">
        <div>
          <div class="order-date">${escapeHtml(order.order_date || "Date unavailable")}</div>
          ${sellerUrl && sellers.length === 1
            ? `<a class="seller" href="${escapeHtml(sellerUrl)}" target="_blank" rel="noopener">${escapeHtml(sellerLabel)}</a>`
            : `<span class="seller">${escapeHtml(sellerLabel)}</span>`}
        </div>
        <div class="order-meta">
          <span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span>
          <strong class="order-total">${order._groupedOrders ? totalHtml(order._groupedOrders) : escapeHtml(order.total || "-")}</strong>
        </div>
      </div>
      <div class="products">${(order.products || []).map(productHtml).join("") || '<p class="missing">Product details unavailable.</p>'}</div>
      ${order._dayGroup
        ? '<div class="order-foot grouped-note">Ratings and notes are available when “Group by day” is off.</div>'
        : `<div class="order-foot">
            <div class="rating" aria-label="Purchase rating">${stars(order)}</div>
            <textarea class="notes" rows="1" placeholder="Add a private note...">${escapeHtml(custom.notes || "")}</textarea>
            ${orderUrl ? `<a class="detail-link" href="${escapeHtml(orderUrl)}" target="_blank" rel="noopener">Order details ↗</a>` : ""}
          </div>`}
      <div class="order-id">Order ${escapeHtml((order.order_ids || [order.order_id]).join(", "))}</div>
    </article>`;
}

function filteredOrders() {
  const query = elements.search.value.trim().toLowerCase();
  const status = elements.status.value;
  const year = elements.year.value;
  let orders = allOrders.filter((order) => {
    if (status !== "all" && order.status !== status) return false;
    if (year !== "all" && orderYear(order) !== year) return false;
    if (elements.unrated.checked && Number(order.user_custom_data?.rating || 0) > 0) return false;
    const productText = (order.products || []).map((product) => `${product.name} ${product.variant}`).join(" ");
    const sellerText = (order.seller_names || [order.seller_name]).join(" ");
    return !query || `${order.order_id} ${sellerText} ${order.status} ${productText}`.toLowerCase().includes(query);
  });

  if (elements.groupByDay.checked) orders = groupOrdersByDay(orders);

  return orders.sort((a, b) => {
    if (elements.sort.value === "oldest") return parseOrderDate(a.order_date) - parseOrderDate(b.order_date);
    if (elements.sort.value === "price") return priceSortValue(b) - priceSortValue(a);
    if (elements.sort.value === "rating") return Number(b.user_custom_data?.rating || 0) - Number(a.user_custom_data?.rating || 0);
    if (elements.sort.value === "seller") return a.seller_name.localeCompare(b.seller_name);
    return parseOrderDate(b.order_date) - parseOrderDate(a.order_date);
  });
}

function updateStats(orders) {
  const underlyingOrders = orders.flatMap((order) => order._groupedOrders || [order]);
  const products = orders.reduce((count, order) =>
    count + (order.products || []).reduce((sum, product) => sum + Number(product.quantity || 1), 0), 0);
  const rated = orders.filter((order) =>
    (order._groupedOrders || [order]).some((item) => Number(item.user_custom_data?.rating || 0) > 0)
  ).length;
  const sellers = new Map();
  orders.forEach((order) => {
    (order.seller_names || [order.seller_name]).filter(Boolean).forEach((seller) => {
      sellers.set(seller, (sellers.get(seller) || 0) + 1);
    });
  });
  const topSeller = [...sellers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

  document.getElementById("stat-orders").textContent = orders.length;
  document.getElementById("stat-products").textContent = products;
  const totals = totalBreakdown(underlyingOrders);
  document.getElementById("stat-total").innerHTML = totals.length
    ? totals.map((total) => `
        <div class="total-line">
          <strong>${escapeHtml(total.formatted)}</strong>
          <small>${escapeHtml(total.currency)}</small>
        </div>`).join("")
    : "<strong>-</strong>";
  document.getElementById("stat-rated").textContent = rated;
  document.getElementById("stat-seller").textContent = topSeller;
}

function render() {
  const orders = filteredOrders();
  updateStats(orders);
  elements.orders.innerHTML = orders.map(orderHtml).join("");
  elements.orders.classList.toggle("hidden", !orders.length);
  elements.empty.classList.toggle("hidden", allOrders.length > 0);
  const totalCount = elements.groupByDay.checked ? groupOrdersByDay(allOrders).length : allOrders.length;
  const unit = elements.groupByDay.checked ? "days" : "orders";
  elements.orderCount.textContent = `${orders.length} of ${totalCount} ${unit}`;

  elements.orders.querySelectorAll(".order-card").forEach((card) => {
    if (card.querySelector(".grouped-note")) return;
    const order = allOrders.find((item) => item.order_id === card.dataset.orderId);
    card.querySelectorAll(".star").forEach((button) => {
      button.addEventListener("click", () => saveCustom(order, { rating: Number(button.dataset.rating) }));
    });
    card.querySelector(".notes").addEventListener("change", (event) => saveCustom(order, { notes: event.target.value }));
  });
  elements.orders.querySelectorAll("img[data-fallback]").forEach((image) => {
    image.addEventListener("error", () => {
      image.src = image.dataset.fallback;
      image.removeAttribute("data-fallback");
    }, { once: true });
  });
}

function populateStatuses() {
  const selected = elements.status.value;
  const statuses = [...new Set(allOrders.map((order) => order.status).filter(Boolean))].sort();
  elements.status.innerHTML = '<option value="all">All statuses</option>' +
    statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join("");
  if (statuses.includes(selected)) elements.status.value = selected;
}

function populateYears() {
  const selected = elements.year.value;
  const years = [...new Set(allOrders.map(orderYear).filter(Boolean))].sort((a, b) => b - a);
  elements.year.innerHTML = '<option value="all">All years</option>' +
    years.map((year) => `<option value="${year}">${year}</option>`).join("");
  if (years.includes(selected)) elements.year.value = selected;
}

async function saveCustom(order, fields) {
  if (demoMode) {
    showToast("Demo mode is read-only.", "error");
    return;
  }
  const previous = { ...order.user_custom_data };
  Object.assign(order.user_custom_data, fields);
  render();
  try {
    await api("/orders/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: order.order_id, ...fields }),
    });
  } catch (error) {
    order.user_custom_data = previous;
    render();
    showToast(`Save failed: ${error.message}`, "error");
  }
}

function showToast(message, type = "") {
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("visible"), 3500);
}

async function loadOrders() {
  elements.loading.classList.remove("hidden");
  elements.error.classList.add("hidden");
  try {
    const response = await api(`/orders${demoMode ? "?demo=1" : ""}`);
    const data = await response.json();
    allOrders = consolidateOrders(data.orders || []);
    elements.lastSynced.textContent = data.last_synced
      ? `Synced ${new Date(data.last_synced).toLocaleString()}`
      : "Never synced";
    populateStatuses();
    populateYears();
    render();
  } catch {
    elements.error.classList.remove("hidden");
  } finally {
    elements.loading.classList.add("hidden");
  }
}

[elements.search, elements.status, elements.year, elements.sort, elements.unrated, elements.groupByDay].forEach((element) => {
  element.addEventListener(element === elements.search ? "input" : "change", render);
});

elements.demoButton.addEventListener("click", () => {
  demoMode = !demoMode;
  localStorage.setItem("trackali-demo", demoMode ? "1" : "0");
  elements.demoButton.classList.toggle("active", demoMode);
  loadOrders();
});

elements.importButton.addEventListener("click", () => {
  if (!demoMode) elements.importFile.click();
});

elements.importFile.addEventListener("change", async () => {
  const file = elements.importFile.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const response = await api("/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    showToast(`Imported ${result.new_orders} new orders.`);
    await loadOrders();
  } catch (error) {
    showToast(`Import failed: ${error.message}`, "error");
  } finally {
    elements.importFile.value = "";
  }
});

elements.exportButton.addEventListener("click", async () => {
  if (demoMode) return;
  try {
    const response = await api("/export");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "trackali-orders.json";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showToast(`Export failed: ${error.message}`, "error");
  }
});

elements.demoButton.classList.toggle("active", demoMode);
loadOrders();
