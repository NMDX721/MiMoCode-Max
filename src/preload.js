const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mimo', {
  // API
  getSessions: () => ipcRenderer.invoke('api:get-sessions'),
  getSession: (id) => ipcRenderer.invoke('api:get-session', id),
  getMessages: (sessionId) => ipcRenderer.invoke('api:get-messages', sessionId),
  getMessagesLight: (sessionId) => ipcRenderer.invoke('api:get-messages-light', sessionId),
  getSyncEvents: (sessionId) => ipcRenderer.invoke('api:sync-events', sessionId),
  resetSync: (sessionId) => ipcRenderer.invoke('api:sync-reset', sessionId),
  getConfig: () => ipcRenderer.invoke('api:get-config'),
  createSession: (data) => ipcRenderer.invoke('api:create-session', data),
  sendMessage: (sessionId, content, agent) => ipcRenderer.invoke('api:send-message', { sessionId, content, agent }),
  deleteSession: (id) => ipcRenderer.invoke('api:delete-session', id),
  streamMessages: (sessionId) => ipcRenderer.invoke('api:stream-messages', sessionId),
  setServerUrl: (url) => ipcRenderer.invoke('api:set-server-url', url),
  getServerUrl: () => ipcRenderer.invoke('api:get-server-url'),

  // Stream events
  onStreamChunk: (cb) => ipcRenderer.on('stream:chunk', (_, data) => cb(data)),

  // SSE events (from main process)
  startSSE: (sessionId) => ipcRenderer.invoke('sse:start', sessionId),
  stopSSE: () => ipcRenderer.invoke('sse:stop'),
  onSSEMessageEvent: (cb) => ipcRenderer.on('sse:message-event', (_, data) => cb(data)),
  onSSESessionIdle: (cb) => ipcRenderer.on('sse:session-idle', (_, data) => cb(data)),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (url) => ipcRenderer.send('window:open-external', url),
});
