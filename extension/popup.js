const syncButton = document.getElementById("sync-btn");
const result = document.getElementById("result");
const pageDot = document.getElementById("page-dot");
const pageLabel = document.getElementById("page-label");
const pageSub = document.getElementById("page-sub");
const serverDot = document.getElementById("server-dot");
const serverLabel = document.getElementById("server-label");
const serverSub = document.getElementById("server-sub");

let activeTabId = null;
let pageReady = false;
let serverReady = false;

function setStatus(dot, state) {
  dot.className = `status-dot ${state}`;
}

function updateButton() {
  syncButton.disabled = !(pageReady && serverReady);
}

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function tabMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(activeTabId, message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

async function checkPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  if (!tab?.url?.includes("aliexpress.com")) throw new Error("Open AliExpress My Orders in this tab.");

  const status = await tabMessage({ action: "getPageStatus" });
  pageReady = Boolean(status?.isOrderPage);
  setStatus(pageDot, pageReady ? "ok" : "warn");
  pageLabel.textContent = pageReady ? "AliExpress orders ready" : "Not on My Orders";
  pageSub.textContent = pageReady
    ? `${status.capturedOrders} order${status.capturedOrders === 1 ? "" : "s"} currently visible`
    : "Open My Orders before importing";
}

async function checkBackend() {
  const status = await runtimeMessage({ action: "getBackendStatus" });
  serverReady = Boolean(status?.success);
  setStatus(serverDot, serverReady ? "ok" : "error");
  serverLabel.textContent = serverReady ? "TrackAli backend running" : "Backend unavailable";
  serverSub.textContent = serverReady
    ? `${status.total_orders} saved order${status.total_orders === 1 ? "" : "s"}`
    : "Run start.bat";
}

async function boot() {
  await Promise.all([
    checkPage().catch((error) => {
      pageReady = false;
      setStatus(pageDot, "warn");
      pageLabel.textContent = "AliExpress orders needed";
      pageSub.textContent = error.message;
    }),
    checkBackend().catch(() => {
      serverReady = false;
      setStatus(serverDot, "error");
      serverLabel.textContent = "Backend unavailable";
      serverSub.textContent = "Run start.bat";
    }),
  ]);
  updateButton();
}

syncButton.addEventListener("click", async () => {
  syncButton.disabled = true;
  syncButton.textContent = "Loading every order...";
  result.className = "";
  result.textContent = "Keep this popup open while AliExpress loads older pages.";

  try {
    const collected = await tabMessage({ action: "collectOrders" });
    if (collected?.error) throw new Error(collected.error);

    syncButton.textContent = "Saving orders...";
    const saved = await runtimeMessage({ action: "syncOrders", orders: collected.orders });
    if (!saved?.success) throw new Error(saved?.error || "Sync failed");

    result.className = "success";
    result.textContent = `${saved.total_orders} saved. ${saved.new_orders} new, ${saved.updated_orders} refreshed.`;
    serverSub.textContent = `${saved.total_orders} saved orders`;
  } catch (error) {
    result.className = "error";
    result.textContent = error.message;
  } finally {
    syncButton.textContent = "Import all orders";
    updateButton();
  }
});

boot();
