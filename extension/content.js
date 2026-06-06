const capturedOrders = new Map();
let syncing = false;

function absoluteUrl(value) {
  if (!value) return "";
  try {
    return new URL(value, location.origin).href;
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value || "")
    .replaceAll("â‚¬", "€")
    .replace(/\s+/g, " ")
    .trim();
}

function checkoutId(fields) {
  const paymentOutId = String(fields.paymentOutId || "");
  return paymentOutId.length > 8 ? paymentOutId.slice(0, -8) : String(fields.orderId);
}

function orderFromFields(fields) {
  if (!fields?.orderId) return null;
  return {
    order_id: String(fields.orderId),
    checkout_id: checkoutId(fields),
    order_date: cleanText(fields.orderDateText),
    status: cleanText(fields.statusText) || "Unknown",
    seller_name: cleanText(fields.storeName) || "Unknown seller",
    seller_url: absoluteUrl(fields.storePageUrl),
    order_url: absoluteUrl(fields.orderDetailUrl),
    message_url: absoluteUrl(fields.sellerConnectUrl),
    total: cleanText(fields.totalPriceText || fields.formatPriceInfo?.split("|")[0]),
    products: (fields.orderLines || []).map((line) => ({
      name: cleanText(line.itemTitle) || "AliExpress item",
      variant: (line.skuAttrs || []).map((attr) => cleanText(attr.text)).filter(Boolean).join(", "),
      quantity: Number(line.quantity) || 1,
      price: cleanText(line.itemPriceText || line.formatPriceInfo?.split("|")[0]),
      image_url: absoluteUrl(line.itemImgUrl),
      product_url: absoluteUrl(line.itemDetailUrl),
    })),
  };
}

function capturePayload(payload) {
  const components = payload?.data?.data;
  if (!components || typeof components !== "object") return;
  for (const component of Object.values(components)) {
    if (component?.tag !== "pc_om_list_order") continue;
    const order = orderFromFields(component.fields);
    if (order) capturedOrders.set(order.order_id, order);
  }
}

window.addEventListener("trackali:order-response", (event) => capturePayload(event.detail));

function textOf(element) {
  return cleanText(element?.textContent);
}

function closestOrderCard(link) {
  let node = link;
  while (node && node !== document.body) {
    const text = textOf(node);
    if (node.querySelectorAll?.('a[href*="/item/"]').length && /Order\s*(ID|date)|Total/i.test(text)) {
      return node;
    }
    node = node.parentElement;
  }
  return link.closest("div");
}

function parseDomOrders() {
  const detailLinks = [...document.querySelectorAll('a[href*="/p/order/detail.html"][href*="orderId="]')];
  for (const detailLink of detailLinks) {
    const orderId = new URL(detailLink.href).searchParams.get("orderId");
    if (!orderId) continue;

    const card = closestOrderCard(detailLink);
    const cardText = textOf(card);
    const productMap = new Map();

    [...card.querySelectorAll('a[href*="/item/"]')].forEach((link) => {
      const href = absoluteUrl(link.href);
      if (productMap.has(href)) return;
      const container = link.closest("div");
      const image = container?.querySelector("img");
      const title = cleanText(link.title || image?.alt || textOf(link));
      if (!title) return;
      productMap.set(href, {
        name: title,
        variant: "",
        quantity: 1,
        price: cleanText(textOf(container).match(/(?:€|US \$|\$|£)\s?[\d.,]+/)?.[0]),
        image_url: absoluteUrl(image?.src),
        product_url: href,
      });
    });

    const date = cardText.match(/(?:Order date\s*)?([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i)?.[1] || "";
    const total = [...cardText.matchAll(/(?:€|US \$|\$|£)\s?[\d.,]+/g)].at(-1)?.[0] || "";
    const status = cardText.match(/To pay|To ship|Shipped|Awaiting delivery|Completed|Processed|Cancelled|Refunded/i)?.[0] || "Unknown";
    const storeLink = card.querySelector('a[href*="/store/"]');
    const existing = capturedOrders.get(orderId) || {};

    capturedOrders.set(orderId, {
      order_id: orderId,
      checkout_id: existing.checkout_id || orderId,
      order_date: existing.order_date || cleanText(date),
      status: existing.status || cleanText(status),
      seller_name: existing.seller_name || textOf(storeLink) || "Unknown seller",
      seller_url: existing.seller_url || absoluteUrl(storeLink?.href),
      order_url: existing.order_url || detailLink.href,
      message_url: existing.message_url || "",
      total: existing.total || cleanText(total),
      products: existing.products?.length ? existing.products : [...productMap.values()],
    });
  }
}

function findViewOrdersButton() {
  return [...document.querySelectorAll("button, a, [role='button']")].find((element) => {
    const text = textOf(element).toLowerCase();
    return element.getClientRects().length > 0 && (text === "view orders" || text === "view more orders");
  });
}

function waitForGrowth(previousCount, timeout = 12000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      parseDomOrders();
      if (capturedOrders.size > previousCount || Date.now() - started >= timeout) {
        clearInterval(timer);
        resolve(capturedOrders.size > previousCount);
      }
    }, 300);
  });
}

async function collectAllOrders() {
  if (syncing) throw new Error("A sync is already running.");
  syncing = true;
  try {
    parseDomOrders();
    let clicks = 0;

    while (clicks < 200) {
      const button = findViewOrdersButton();
      if (!button) break;
      const previousCount = capturedOrders.size;
      button.scrollIntoView({ block: "center" });
      button.click();
      clicks += 1;
      const grew = await waitForGrowth(previousCount);
      if (!grew && findViewOrdersButton() === button) break;
    }

    parseDomOrders();
    if (!capturedOrders.size) {
      throw new Error("No orders found. Open AliExpress My Orders and wait for the list to load.");
    }
    return { orders: [...capturedOrders.values()], clicks };
  } finally {
    syncing = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "getPageStatus") {
    parseDomOrders();
    sendResponse({
      supported: true,
      isOrderPage: /\/p\/order\/index\.html|\/orderList\./i.test(location.href) ||
        document.querySelector('a[href*="/p/order/detail.html"][href*="orderId="]') !== null,
      capturedOrders: capturedOrders.size,
    });
    return;
  }

  if (message.action === "collectOrders") {
    collectAllOrders()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});
