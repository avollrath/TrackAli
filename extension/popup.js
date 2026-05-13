const dot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const hintText = document.getElementById("hint-text");
const syncBtn = document.getElementById("sync-btn");
const resultBox = document.getElementById("result-box");

function formatTime(ts) {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function setStatus(state, text, hint = "") {
  dot.className = "dot " + state;
  statusText.textContent = text;
  hintText.textContent = hint;
}

function showResult(type, html) {
  resultBox.className = `result ${type}`;
  resultBox.innerHTML = html;
  resultBox.style.display = "block";
}

// Check credential status on open
chrome.runtime.sendMessage({ action: "getStatus" }, (response) => {
  if (response.hasCredentials) {
    const ago = formatTime(response.capturedAt);
    setStatus(
      "green",
      `Credentials captured ${ago}`,
      "Ready to sync. Click the button to fetch your latest 50 orders."
    );
    syncBtn.disabled = false;
  } else {
    setStatus(
      "yellow",
      "Session expired or not captured",
      "Reload wolt.com — the extension will pick up a fresh token automatically."
    );
    syncBtn.disabled = true;
  }
});

syncBtn.addEventListener("click", () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";
  resultBox.style.display = "none";

  chrome.runtime.sendMessage({ action: "sync" }, (response) => {
    syncBtn.disabled = false;
    syncBtn.textContent = "Sync Now";

    if (chrome.runtime.lastError) {
      showResult(
        "error",
        `Extension error: ${chrome.runtime.lastError.message}`
      );
      return;
    }

    if (response.success) {
      showResult(
        "success",
        `✓ Sync complete<br>
         <strong>${response.new_orders}</strong> new order${response.new_orders !== 1 ? "s" : ""} added<br>
         <strong>${response.existing_orders}</strong> already in database<br>
         Total: <strong>${response.total_orders}</strong> orders`
      );
    } else {
      showResult("error", `✗ ${response.error}`);
    }
  });
});
