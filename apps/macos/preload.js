const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hyperclaw', {
  store: {
    get: (k) => ipcRenderer.invoke('store:get', k),
    set: (k, v) => ipcRenderer.invoke('store:set', k, v)
  },
  send: (channel) => ipcRenderer.send(channel),
  api: {
    getNodes: () => ipcRenderer.invoke('api:getNodes'),
    getGatewayStatus: () => ipcRenderer.invoke('api:getGatewayStatus')
  },
  connect: {
    test: (baseUrl, token) => ipcRenderer.invoke('connect:test', baseUrl, token),
    reconnect: () => ipcRenderer.send('connect:reconnect')
  },
  chat: {
    getStored: () => ipcRenderer.invoke('chat:getStored'),
    appendStored: (role, content) => ipcRenderer.invoke('chat:appendStored', role, content),
    send: (text) => ipcRenderer.invoke('chat:send', text),
    onResponse: (cb) => { ipcRenderer.on('chat:response', (_, c) => cb(c)); },
    onChunk: (cb) => { ipcRenderer.on('chat:chunk', (_, t) => cb(t)); }
  },
  system: {
    run: (cmd, opts) => ipcRenderer.invoke('system:run', cmd, opts),
    notify: (title, body, opts) => ipcRenderer.invoke('system:notify', title, body, opts)
  },
  voice: { onResult: (cb) => { ipcRenderer.on('voice:result', (_, t) => cb(t)); } },
  sendVoiceResult: (text) => ipcRenderer.invoke('voice:result', text)
});
