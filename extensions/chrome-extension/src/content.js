/**
 * extensions/chrome-extension/src/content.js
 * HyperClaw Chrome Extension — content script.
 * Injected into every page. Provides:
 * - Page text extraction for "Share page" feature
 * - Visual overlay when HyperClaw is processing a request
 * - Selected text relay on keyboard shortcut (Alt+H)
 */

(function() {
  'use strict';

  let overlay = null;

  // ─── Keyboard shortcut: Alt+H = send selection to HyperClaw ────────────────
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'h') {
      const selection = window.getSelection()?.toString().trim();
      if (selection) {
        chrome.runtime.sendMessage({
          type: 'popup:send',
          content: `[From ${document.title}]\n${selection}`
        });
        showToast(`Sent to HyperClaw: "${selection.slice(0, 50)}..."`);
      }
    }
  });

  // ─── Show a non-intrusive toast notification ─────────────────────────────────
  function showToast(message, duration = 2500) {
    const existing = document.getElementById('hyperclaw-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'hyperclaw-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #0a0f1a;
      color: #06b6d4;
      border: 1px solid #1f2937;
      border-radius: 8px;
      padding: 10px 16px;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      z-index: 2147483647;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 320px;
      animation: hc-slide-in 0.2s ease;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes hc-slide-in {
        from { transform: translateX(20px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    toast.innerHTML = `<span>🦅</span><span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  // ─── Listen for messages from background/popup ───────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'content:get-page') {
      sendResponse({
        url: location.href,
        title: document.title,
        text: document.body?.innerText?.slice(0, 5000) || '',
        selection: window.getSelection()?.toString() || ''
      });
    }

    if (msg.type === 'content:show-response') {
      showToast(msg.content?.slice(0, 100) || 'HyperClaw responded');
    }

    if (msg.type === 'content:highlight') {
      // Highlight a selection on the page (for agent responses referencing page content)
      const text = msg.text;
      if (text) {
        const body = document.body.innerHTML;
        document.body.innerHTML = body.replace(
          new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          match => `<mark style="background:#06b6d4;color:#000;border-radius:2px">${match}</mark>`
        );
      }
    }
  });

})();
