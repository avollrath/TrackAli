// Badge helpers — green dot when credentials are available
function setBadgeReady() {
  chrome.action.setBadgeText({ text: " " });
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

// Restore badge state on service worker startup
chrome.storage.local.get("wolt_auth", (data) => {
  if (data.wolt_auth) setBadgeReady();
});

// Fallback: intercept Wolt API request headers when service worker is alive
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    let auth = null;
    let sessionId = null;
    for (const header of details.requestHeaders || []) {
      const name = header.name.toLowerCase();
      if (name === "authorization" && header.value?.startsWith("Bearer ")) auth = header.value;
      if (name === "wolt-session-id") sessionId = header.value;
    }
    if (auth) {
      chrome.storage.local.set({
        wolt_auth: auth,
        ...(sessionId && { wolt_session_id: sessionId }),
        captured_at: Date.now(),
      });
      setBadgeReady();
    }
  },
  { urls: ["https://consumer-api.wolt.com/*"] },
  ["requestHeaders", "extraHeaders"]
);

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Primary credential capture: content script read token from localStorage
  if (message.action === "storeCredentials") {
    const update = {
      wolt_auth: message.authorization,
      captured_at: Date.now(),
    };
    if (message.sessionId) update.wolt_session_id = message.sessionId;
    chrome.storage.local.set(update);
    setBadgeReady();
    return; // no async response needed
  }


  if (message.action === "sync") {
    handleSync()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.action === "getStatus") {
    chrome.storage.local.get(
      ["wolt_auth", "wolt_session_id", "captured_at"],
      (data) => {
        sendResponse({
          hasCredentials: !!data.wolt_auth,
          capturedAt: data.captured_at || null,
        });
      }
    );
    return true;
  }

  // unhandled message — don't return true
});

async function handleSync() {
  const data = await chrome.storage.local.get([
    "wolt_auth",
    "wolt_session_id",
  ]);

  if (!data.wolt_auth) {
    throw new Error(
      "No credentials captured yet. Open wolt.com, wait a moment, then try again."
    );
  }

  const reqHeaders = {
    Authorization: data.wolt_auth,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };
  if (data.wolt_session_id) reqHeaders["wolt-session-id"] = data.wolt_session_id;

  // Fetch order history from Wolt
  const woltRes = await fetch(
    "https://consumer-api.wolt.com/order-tracking-api/v1/order_history/?limit=50",
    { headers: reqHeaders }
  );

  if (!woltRes.ok) {
    const text = await woltRes.text();
    throw new Error(`Wolt API error ${woltRes.status}: ${text}`);
  }

  const woltData = await woltRes.json();

  // POST raw payload to local backend
  const backendRes = await fetch("http://localhost:5000/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(woltData),
  });

  if (!backendRes.ok) {
    const text = await backendRes.text();
    throw new Error(`Backend error ${backendRes.status}: ${text}`);
  }

  const result = await backendRes.json();
  return { success: true, ...result };
}
