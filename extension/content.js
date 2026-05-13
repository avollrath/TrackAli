// Runs inside wolt.com page context — reads auth token from localStorage
// and forwards it to the background service worker via chrome.runtime.sendMessage.

(function () {
  function isWoltBearerToken(value) {
    return typeof value === "string" && value.startsWith("Bearer ey") && value.length >= 100;
  }

  function findToken() {
    // Wolt stores its auth state in localStorage under various keys.
    // Try the known ones first, then do a broad scan.
    const candidates = [
      "wolt_auth_token",
      "authToken",
      "auth_token",
      "token",
      "access_token",
      "wolt-token",
    ];

    for (const key of candidates) {
      const val = localStorage.getItem(key);
      if (isWoltBearerToken(val)) return val;
    }

    // Broad scan: any localStorage value that looks like a Bearer JWT
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      if (isWoltBearerToken(val)) return val;
    }

    // Try sessionStorage too
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const val = sessionStorage.getItem(key);
      if (isWoltBearerToken(val)) return val;
    }

    return null;
  }

  function findSessionId() {
    // Try localStorage keys that look like session IDs (UUIDs)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const sessionCandidates = ["wolt-session-id", "sessionId", "session_id", "wolt_session"];
    for (const key of sessionCandidates) {
      const val = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (val && uuidRe.test(val)) return val;
    }
    return null;
  }

  function sendCredentials() {
    const token = findToken();
    if (!token) return false;

    const sessionId = findSessionId(); // optional — may be null

    chrome.runtime.sendMessage({
      action: "storeCredentials",
      authorization: token,
      sessionId: sessionId,
    });

    return true;
  }

  // Try immediately on script injection
  if (!sendCredentials()) {
    // Wolt is a SPA — wait for the app to hydrate and write to storage
    const observer = new MutationObserver(() => {
      if (sendCredentials()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also retry on a short interval for up to 10 seconds
    let attempts = 0;
    const interval = setInterval(() => {
      if (sendCredentials() || ++attempts > 20) clearInterval(interval);
    }, 500);
  }
})();
