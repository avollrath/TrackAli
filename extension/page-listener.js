(function () {
  const EVENT_NAME = "trackali:order-response";

  function publish(payload) {
    if (!payload || payload.api !== "mtop.aliexpress.trade.buyer.order.list") return;
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = String(args[0]?.url || args[0] || "");
      if (url.includes("mtop.aliexpress.trade.buyer.order.list")) {
        publish(await response.clone().json());
      }
    } catch {}
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this.__trackAliUrl = String(url || "");
    return originalOpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__trackAliUrl?.includes("mtop.aliexpress.trade.buyer.order.list")) {
      this.addEventListener("load", function () {
        try {
          publish(JSON.parse(this.responseText));
        } catch {}
      });
    }
    return originalSend.apply(this, args);
  };
})();
