async function backendFetch(path, options = {}) {
  const response = await fetch(`http://localhost:5000${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    let message = `Backend error ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "getBackendStatus") {
    backendFetch("/health")
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === "syncOrders") {
    backendFetch("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: message.orders || [] }),
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
