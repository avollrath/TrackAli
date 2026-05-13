// Decode a JWT and return its payload, or null if malformed
function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

// Returns true if the stored Bearer token exists and hasn't expired
function isTokenValid(auth) {
  if (!auth) return false;
  const raw = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  const payload = decodeJwt(raw);
  if (!payload?.exp) return false;
  // Give a 60-second buffer so we don't show green right before expiry
  return payload.exp > Math.floor(Date.now() / 1000) + 60;
}

function setBadgeReady() {
  chrome.action.setBadgeText({ text: " " });
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  chrome.action.setIcon({
    path: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  });
}

function setBadgeExpired() {
  chrome.action.setBadgeText({ text: "" });
  // Draw a greyed-out version of the icon using an offscreen canvas
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.filter = "grayscale(1) brightness(0.4)";
      ctx.drawImage(img, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      chrome.action.setIcon({ imageData: { [size]: imageData } });
    };
    img.src = chrome.runtime.getURL(`icons/icon${size}.png`);
  }
}

function invalidateCredentials() {
  chrome.storage.local.remove(["wolt_auth", "wolt_session_id", "captured_at"]);
  setBadgeExpired();
}

// Restore badge state on service worker startup — check token expiry
chrome.storage.local.get("wolt_auth", (data) => {
  if (isTokenValid(data.wolt_auth)) {
    setBadgeReady();
  } else if (data.wolt_auth) {
    // Token present but expired — clear it
    invalidateCredentials();
  }
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
    if (auth && isTokenValid(auth)) {
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
    if (!isTokenValid(message.authorization)) return;
    const update = {
      wolt_auth: message.authorization,
      captured_at: Date.now(),
    };
    if (message.sessionId) update.wolt_session_id = message.sessionId;
    chrome.storage.local.set(update);
    setBadgeReady();
    return;
  }

  if (message.action === "sync") {
    handleSync()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "getStatus") {
    chrome.storage.local.get(
      ["wolt_auth", "wolt_session_id", "captured_at"],
      (data) => {
        const valid = isTokenValid(data.wolt_auth);
        sendResponse({
          hasCredentials: valid,
          capturedAt: valid ? (data.captured_at || null) : null,
        });
      }
    );
    return true;
  }
});

async function handleSync() {
  const data = await chrome.storage.local.get(["wolt_auth", "wolt_session_id"]);

  if (!isTokenValid(data.wolt_auth)) {
    invalidateCredentials();
    throw new Error("Session expired. Reload wolt.com to capture a fresh token.");
  }

  const reqHeaders = {
    Authorization: data.wolt_auth,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };
  if (data.wolt_session_id) reqHeaders["wolt-session-id"] = data.wolt_session_id;

  const woltRes = await fetch(
    "https://consumer-api.wolt.com/order-tracking-api/v1/order_history/?limit=1000",
    { headers: reqHeaders }
  );

  if (woltRes.status === 401) {
    invalidateCredentials();
    throw new Error("Session expired (401). Reload wolt.com to capture a fresh token.");
  }

  if (!woltRes.ok) {
    const text = await woltRes.text();
    throw new Error(`Wolt API error ${woltRes.status}: ${text}`);
  }

  const woltData = await woltRes.json();

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
