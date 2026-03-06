/**
 * extensions/chrome-extension/src/popup.js
 */

const log = document.getElementById('log');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const msgInput = document.getElementById('msgInput');

function addLog(msg) {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function setStatus(connected) {
  statusDot.className = 'status-dot' + (connected ? ' online' : '');
  statusText.textContent = connected ? 'Connected' : 'Offline';
}

// Get initial status
chrome.runtime.sendMessage({ type: 'popup:status' }, (res) => {
  if (res) setStatus(res.connected);
});

// Listen for gateway messages
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    setStatus(msg.connected);
    addLog(msg.connected ? 'Gateway connected' : 'Gateway disconnected');
  }
  if (msg.type === 'chat:response') {
    addLog(`Agent: ${msg.content?.slice(0, 80) || '(empty response)'}`);
  }
});

// Send message
document.getElementById('sendBtn').addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
  const content = msgInput.value.trim();
  if (!content) return;
  addLog(`You: ${content}`);
  chrome.runtime.sendMessage({ type: 'popup:send', content }, (res) => {
    if (!res?.sent) addLog('Failed — is the gateway running?');
  });
  msgInput.value = '';
}

// Share current page
document.getElementById('sharePageBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Extract page content via scripting API
  let content = '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText?.slice(0, 3000)
    });
    content = results[0]?.result || '';
  } catch {}

  chrome.runtime.sendMessage({
    type: 'popup:share-page',
    url: tab.url,
    title: tab.title,
    content
  }, (res) => {
    addLog(res?.sent ? `Shared page: ${tab.title}` : 'Failed to share page');
  });
});

// Share selection
document.getElementById('shareSelectionBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString()
    });
    const selection = results[0]?.result;
    if (selection) {
      msgInput.value = selection;
      addLog('Selection loaded into input');
    } else {
      addLog('No text selected on page');
    }
  } catch {
    addLog('Cannot access page content');
  }
});

// Open Web UI
document.getElementById('openWebUIBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:3000' });
});

addLog('HyperClaw extension ready');
