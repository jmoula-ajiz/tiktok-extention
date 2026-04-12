chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.local.set({ current: null, history: [] });
  }
});

function bridgeBase(host, port) {
  const h = (host || "127.0.0.1").replace(/\/$/, "");
  const p = String(port || "8787");
  return `http://${h}:${p}`;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "geminiHealth") {
    const { host, port } = msg;
    fetch(`${bridgeBase(host, port)}/health`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, status: r.status, data })))
      .then((out) => sendResponse(out))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg?.type === "geminiAnalyze") {
    const { host, port, videos } = msg;
    fetch(`${bridgeBase(host, port)}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videos: videos || [] }),
    })
      .then(async (r) => {
        const text = await r.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { detail: text };
        }
        sendResponse({ ok: r.ok, status: r.status, data });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  return false;
});
