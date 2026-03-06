/**
 * HyperClaw macOS Menu Bar App — Production
 * - Tray, notifications, Open Chat/Dashboard, Voice PTT, shell commands
 * - State management (electron-store)
 * - Auth/pairing UI (Connect window)
 * - Node/device management
 * - Persistent conversation UI
 * - Settings screen
 * - Auto-update ready
 */
const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');
const nodeNotifier = require('node-notifier');
const store = require('./store');

let tray = null;
let gatewayConnected = false;
let ws = null;
let chatWin = null;
let reconnectAttempts = 0;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

// ─── System.run
function systemRun(command, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(command, {
      cwd: opts.cwd || process.env.HOME,
      env: { ...process.env, ...opts.env },
      timeout: opts.timeout || 30000,
      maxBuffer: 1024 * 1024
    }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ─── system.notify
function systemNotify(title, body, opts = {}) {
  if (!store.get('notifications')) return;
  nodeNotifier.notify({
    title: title || 'HyperClaw',
    message: body || '',
    icon: opts.icon ? path.join(__dirname, opts.icon) : undefined,
    sound: opts.sound !== false,
    wait: opts.wait || false
  });
}

// ─── Gateway WebSocket with auth flow + session recovery
function connectGateway() {
  const baseUrl = store.getGatewayUrl();
  const wsUrl = store.getWsUrl();
  const token = store.getAuthToken();
  try {
    if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
    const WebSocket = require('ws');
    const url = wsUrl.includes('://') ? wsUrl : `ws://${wsUrl.replace(/^https?:\/\//, '')}`;
    ws = new WebSocket(url);
    ws.on('open', () => {
      gatewayConnected = true;
      reconnectAttempts = 0;
      updateTray();
      store.set('lastConnectedAt', new Date().toISOString());
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connect.challenge') {
          if (token) ws.send(JSON.stringify({ type: 'auth', token }));
          else { gatewayConnected = false; updateTray(); }
        } else if (msg.type === 'auth.ok' || msg.type === 'connect.ok') {
          gatewayConnected = true;
          reconnectAttempts = 0;
          updateTray();
        } else if (msg.type === 'chat:response' && chatWin && !chatWin.isDestroyed()) {
          chatWin.webContents.send('chat:response', msg.content || '');
        } else if (msg.type === 'chat:chunk' && chatWin && !chatWin.isDestroyed()) {
          chatWin.webContents.send('chat:chunk', msg.content || '');
        }
      } catch (_) {}
    });
    ws.on('close', () => {
      gatewayConnected = false;
      updateTray();
      scheduleReconnect();
    });
    ws.on('error', () => {
      gatewayConnected = false;
      updateTray();
    });
  } catch (e) {
    gatewayConnected = false;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts++;
  setTimeout(() => connectGateway(), delay);
}

function sendChatMessage(text) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify({ type: 'chat:message', content: text, source: 'macos' }));
    return true;
  } catch { return false; }
}

// ─── Icons
const FALLBACK_ICON_SVG = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="#06b6d4" rx="4"/></svg>'
).toString('base64');
const FALLBACK_ICON_ON = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="#10b981" rx="4"/></svg>'
).toString('base64');
const FALLBACK_ICON_OFF = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="#64748b" rx="4"/></svg>'
).toString('base64');

function loadIcon(pathOrDataUrl) {
  if (pathOrDataUrl.startsWith('data:')) return nativeImage.createFromDataURL(pathOrDataUrl);
  const img = nativeImage.createFromPath(pathOrDataUrl);
  return img.isEmpty() ? null : img;
}

function updateTray() {
  const iconPath = path.join(__dirname, 'icons', gatewayConnected ? 'icon-on.png' : 'icon-off.png');
  let img = loadIcon(iconPath) || loadIcon(gatewayConnected ? FALLBACK_ICON_ON : FALLBACK_ICON_OFF);
  if (tray) tray.setImage(img);
  tray?.setContextMenu(createTrayMenu());
}

function createTrayMenu() {
  return Menu.buildFromTemplate([
    { label: gatewayConnected ? '● Connected' : '○ Disconnected', enabled: false },
    { type: 'separator' },
    { label: 'Connect / Pair', click: () => openConnectWindow() },
    { label: 'Open Chat', click: () => openChatWindow() },
    { label: 'Dashboard', click: () => openDashboardWindow() },
    { type: 'separator' },
    { label: 'Devices', click: () => openNodesWindow() },
    { label: 'Voice Wake / PTT', click: () => openVoiceWakeWindow() },
    { type: 'separator' },
    { label: 'Settings', click: () => openSettingsWindow() },
    { label: 'Notify Test', click: () => systemNotify('HyperClaw', '🦅 Ready') },
    {
      label: 'Run Command',
      submenu: [
        { label: 'hyperclaw status', click: () => systemRun('hyperclaw daemon status').then(r => systemNotify('Status', r.stdout)).catch(e => systemNotify('Error', e.message)) },
        { label: 'hyperclaw doctor', click: () => systemRun('hyperclaw doctor').then(r => systemNotify('Doctor', r.stdout.slice(0, 200))).catch(e => systemNotify('Error', e.message)) }
      ]
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, 'icons', 'icon-tray.png');
  let img = loadIcon(iconPath) || loadIcon(FALLBACK_ICON_SVG);
  tray = new Tray(img);
  tray.setToolTip('HyperClaw — AI Gateway');
  tray.setContextMenu(createTrayMenu());
  updateTray();
}

const winDefaults = { webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') } };

function openConnectWindow() {
  const win = new BrowserWindow({ width: 420, height: 380, ...winDefaults, titleBarStyle: 'hiddenInset' });
  win.loadFile(path.join(__dirname, 'windows', 'connect.html'));
}

function openChatWindow() {
  if (chatWin && !chatWin.isDestroyed()) { chatWin.focus(); return; }
  chatWin = new BrowserWindow({ width: 420, height: 600, ...winDefaults, titleBarStyle: 'hiddenInset' });
  chatWin.loadFile(path.join(__dirname, 'windows', 'chat-native.html'));
  chatWin.on('closed', () => { chatWin = null; });
}

function openDashboardWindow() {
  const baseUrl = store.getGatewayUrl();
  const win = new BrowserWindow({ width: 900, height: 700, ...winDefaults });
  win.loadURL(`${baseUrl}/dashboard`).catch(() => win.loadURL('about:blank'));
}

function openNodesWindow() {
  const win = new BrowserWindow({ width: 400, height: 360, ...winDefaults, titleBarStyle: 'hiddenInset' });
  win.loadFile(path.join(__dirname, 'windows', 'nodes.html'));
}

function openSettingsWindow() {
  const win = new BrowserWindow({ width: 440, height: 420, ...winDefaults, titleBarStyle: 'hiddenInset' });
  win.loadFile(path.join(__dirname, 'windows', 'settings.html'));
}

// ─── Voice Wake / PTT
let voiceWin = null;
const VOICE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:20px;font-family:system-ui;background:#0a0f1a;color:#fff;display:flex;flex-direction:column;align-items:center;gap:12px;}
button{width:120px;height:44px;border:none;border-radius:22px;font-size:16px;font-weight:600;cursor:pointer;background:#06b6d4;color:#000;}
button.rec{background:#ef4444;}
label{font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:6px;cursor:pointer;}
#status{font-size:12px;color:#94a3b8;}
</style></head><body>
<button id="ptt">Push to Talk</button>
<label><input type="checkbox" id="always"> Always-on (continuous listen)</label>
<div id="status">Click to start</div>
<script>
const btn=document.getElementById('ptt');
const status=document.getElementById('status');
const alwaysCheck=document.getElementById('always');
let rec=null;
function startRec(){
  const Sp=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Sp){ status.textContent='Speech API not available'; return; }
  rec=new Sp(); rec.continuous=false; rec.interimResults=false; rec.lang='en-US';
  rec.onresult=function(e){
    const t=e.results[0][0].transcript;
    window.hyperclaw.sendVoiceResult(t);
    status.textContent='Sent: '+t.slice(0,40)+(t.length>40?'...':'');
    if(alwaysCheck.checked) setTimeout(startRec,500);
    else { rec=null; btn.textContent='Push to Talk'; btn.classList.remove('rec'); }
  };
  rec.onerror=function(){ if(!alwaysCheck.checked){ rec=null; btn.textContent='Push to Talk'; btn.classList.remove('rec'); } else setTimeout(startRec,1000); };
  rec.start(); btn.textContent='Stop'; btn.classList.add('rec'); status.textContent='Listening...';
}
btn.onclick=function(){
  if(rec){ rec.stop(); rec=null; btn.textContent='Push to Talk'; btn.classList.remove('rec'); status.textContent='Stopped'; return; }
  startRec();
};
</script></body></html>`;

function openVoiceWakeWindow() {
  if (voiceWin && !voiceWin.isDestroyed()) { voiceWin.focus(); return; }
  voiceWin = new BrowserWindow({
    width: 280, height: 140, resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    titleBarStyle: 'hiddenInset', alwaysOnTop: true
  });
  voiceWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(VOICE_HTML)}`);
  voiceWin.on('closed', () => { voiceWin = null; });
}

// ─── IPC
ipcMain.handle('store:get', (_, k) => store.get(k));
ipcMain.handle('store:set', (_, k, v) => { store.set(k, v); });

ipcMain.on('settings:saved', () => {
  try { app.setLoginItemSettings({ openAtLogin: store.get('launchAtLogin') }); } catch (_) {}
  connectGateway();
});

ipcMain.on('connect:reconnect', () => connectGateway());

ipcMain.handle('system:run', (_, cmd, opts) => systemRun(cmd, opts));
ipcMain.handle('system:notify', (_, title, body, opts) => systemNotify(title, body, opts));

ipcMain.handle('voice:result', (_, text) => {
  if (sendChatMessage(text)) systemNotify('HyperClaw', `Sent: ${text.slice(0, 50)}${text.length > 50 ? '…' : ''}`);
  else systemNotify('HyperClaw', 'Not connected');
});

ipcMain.handle('api:getNodes', async () => {
  const baseUrl = store.getGatewayUrl();
  return new Promise((resolve) => {
    const url = new URL('/api/nodes', baseUrl);
    http.get(url.toString(), (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).nodes || []); } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
});

ipcMain.handle('api:getGatewayStatus', async () => {
  const baseUrl = store.getGatewayUrl();
  return new Promise((resolve) => {
    const url = new URL('/api/status', baseUrl);
    http.get(url.toString(), (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
});

ipcMain.handle('chat:getStored', () => store.getChatMessages());
ipcMain.handle('chat:appendStored', (_, role, content) => store.appendChatMessage({ role, content }));
ipcMain.handle('chat:send', (_, text) => Promise.resolve(sendChatMessage(text)));

// ─── Connect: test gateway connection
ipcMain.handle('connect:test', async (_, baseUrl, token) => {
  try {
    const WebSocket = require('ws');
    const wsUrl = baseUrl.replace(/^http/, 'ws').replace(/^https/, 'wss');
    return new Promise((resolve) => {
      const test = new WebSocket(wsUrl);
      const t = setTimeout(() => { try { test.close(); } catch (_) {} resolve({ ok: false, msg: 'Timeout' }); }, 5000);
      test.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'connect.ok') { clearTimeout(t); test.close(); resolve({ ok: true, msg: 'Connected' }); return; }
          if (m.type === 'connect.challenge' && token) {
            test.send(JSON.stringify({ type: 'auth', token }));
          } else if (m.type === 'connect.challenge' && !token) {
            clearTimeout(t); test.close(); resolve({ ok: false, msg: 'Gateway requires token' }); return;
          }
          if (m.type === 'auth.ok') { clearTimeout(t); test.close(); resolve({ ok: true, msg: 'Connected' }); return; }
          if (m.type === 'error') { clearTimeout(t); test.close(); resolve({ ok: false, msg: m.message || 'Auth failed' }); }
        } catch (_) {}
      });
      test.on('error', () => { clearTimeout(t); resolve({ ok: false, msg: 'Connection failed' }); });
    });
  } catch (e) { return { ok: false, msg: e.message }; }
});

// ─── Launch at login
try { app.setLoginItemSettings({ openAtLogin: store.get('launchAtLogin') }); } catch (_) {}

// ─── Auto-update (when packaged, uses publish config)
let autoUpdateStarted = false;
function maybeStartAutoUpdate() {
  if (app.isPackaged && !autoUpdateStarted) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = false;
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      autoUpdateStarted = true;
    } catch (_) {}
  }
}

app.whenReady().then(() => {
  app.dock?.hide();
  createTray();
  connectGateway();
  // Periodic reconnect when disconnected (every 15s)
  setInterval(() => { if (!gatewayConnected) connectGateway(); }, 15000);
  maybeStartAutoUpdate();
});

app.on('activate', () => {
  if (!gatewayConnected) connectGateway();
});
