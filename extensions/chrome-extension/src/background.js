/**
 * extensions/chrome-extension/src/background.js
 * HyperClaw Chrome Extension — background service worker.
 * Maintains a persistent WebSocket connection to the gateway.
 */

const GATEWAY_URL = 'ws://localhost:18789';
const RECONNECT_DELAY = 3000;

let ws = null;
let reconnectTimer = null;
let isConnected = false;
let gatewayToken = null;

async function loadToken() {
  const { gatewayToken: t } = await chrome.storage.local.get('gatewayToken');
  gatewayToken = t || '';
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(GATEWAY_URL);

  ws.onopen = () => {
    isConnected = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    // Authenticate
    if (gatewayToken) {
      ws.send(JSON.stringify({ type: 'auth', token: gatewayToken }));
    }

    notifyPopup({ type: 'status', connected: true });
    setIcon(true);
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleGatewayMessage(msg);
  };

  ws.onclose = () => {
    isConnected = false;
    notifyPopup({ type: 'status', connected: false });
    setIcon(false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
}

function handleGatewayMessage(msg) {
  switch (msg.type) {
    case 'chat:response':
      // Show notification for agent responses
      if (msg.content) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/icons/icon48.png',
          title: 'HyperClaw',
          message: msg.content.slice(0, 120) + (msg.content.length > 120 ? '...' : '')
        });
      }
      break;

    case 'action:openUrl':
      // Agent can open URLs in new tab
      if (msg.url) chrome.tabs.create({ url: msg.url });
      break;
  }

  notifyPopup(msg);
}

function notifyPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function setIcon(online) {
  // Would set different icon based on connection status
  // Requires actual icon files
}

async function sendToGateway(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { error: 'Not connected to gateway' };
  }
  ws.send(JSON.stringify(payload));
  return { sent: true };
}

// ─── Context menus ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'hyperclaw-ask',
    title: 'Ask HyperClaw about "%s"',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'hyperclaw-share-page',
    title: 'Share page with HyperClaw',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'hyperclaw-ask' && info.selectionText) {
    await sendToGateway({
      type: 'chat:message',
      content: info.selectionText,
      source: 'chrome-extension',
      tabUrl: tab.url
    });
  }

  if (info.menuItemId === 'hyperclaw-share-page' && tab.url) {
    await sendToGateway({
      type: 'chat:message',
      content: `I'm reading this page: ${tab.url}\nTitle: ${tab.title}\n\nWhat can you tell me about it?`,
      source: 'chrome-extension'
    });
  }
});

// ─── Message from popup / content script ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'popup:send') {
    sendToGateway({ type: 'chat:message', content: msg.content, source: 'chrome-extension' })
      .then(sendResponse);
    return true;
  }

  if (msg.type === 'popup:status') {
    sendResponse({ connected: isConnected });
  }

  if (msg.type === 'popup:share-page') {
    sendToGateway({
      type: 'chat:message',
      content: `Shared page:\nURL: ${msg.url}\nTitle: ${msg.title}\nContent: ${msg.content?.slice(0, 2000) || '(empty)'}`,
      source: 'chrome-extension'
    }).then(sendResponse);
    return true;
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

loadToken().then(connect);
