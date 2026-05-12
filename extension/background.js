// Intercept Wolt API requests to capture auth headers
const captured = {
  authorization: null,
  sessionId: null,
};

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (!details.url.includes("consumer-api.wolt.com")) return;

    for (const header of details.requestHeaders || []) {
      const name = header.name.toLowerCase();
      if (name === "authorization" && header.value?.startsWith("Bearer ")) {
        captured.authorization = header.value;
      }
      if (name === "wolt-session-id") {
        captured.sessionId = header.value;
      }
    }

    if (captured.authorization && captured.sessionId) {
      chrome.storage.local.set({
        wolt_auth: captured.authorization,
        wolt_session_id: captured.sessionId,
        captured_at: Date.now(),
      });
    }
  },
  { urls: ["https://consumer-api.wolt.com/*"] },
  ["requestHeaders", "extraHeaders"]
);

// Listen for sync command from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "sync") {
    handleSync().then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // keep channel open for async response
  }

  if (message.action === "getStatus") {
    chrome.storage.local.get(
      ["wolt_auth", "wolt_session_id", "captured_at"],
      (data) => {
        sendResponse({
          hasCredentials: !!(data.wolt_auth && data.wolt_session_id),
          capturedAt: data.captured_at || null,
        });
      }
    );
    return true;
  }
});

async function handleSync() {
  const data = await chrome.storage.local.get([
    "wolt_auth",
    "wolt_session_id",
  ]);

  if (!data.wolt_auth || !data.wolt_session_id) {
    throw new Error(
      "No credentials captured yet. Open wolt.com and browse around first."
    );
  }

  // Fetch order history from Wolt
  const woltRes = await fetch(
    "https://consumer-api.wolt.com/order-tracking-api/v1/order_history/?limit=50",
    {
      headers: {
        Authorization: data.wolt_auth,
        "wolt-session-id": data.wolt_session_id,
        "User-Agent": navigator.userAgent,
      },
    }
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
