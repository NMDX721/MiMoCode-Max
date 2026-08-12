const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mimo', {
  // Sessions
  getSessions: () => ipcRenderer.invoke('api:get-sessions'),
  getSession: (id) => ipcRenderer.invoke('api:get-session', id),
  createSession: (data) => ipcRenderer.invoke('api:create-session', data),
  deleteSession: (id) => ipcRenderer.invoke('api:delete-session', id),

  // Messages
  getMessages: (sessionId) => ipcRenderer.invoke('api:get-messages', sessionId),
  sendMessage: (sessionId, content, agent, images) => ipcRenderer.invoke('api:send-message', { sessionId, content, agent, images }),

  // Config
  getConfig: () => ipcRenderer.invoke('api:get-config'),
  setServerUrl: (url) => ipcRenderer.invoke('api:set-server-url', url),
  getServerUrl: () => ipcRenderer.invoke('api:get-server-url'),

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
