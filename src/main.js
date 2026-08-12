const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ApiClient = require('./api');
const Cache = require('./cache');

// ---------- Logging ----------
const logFile = path.join(app.getPath('userData'), 'debug.log');
function log(...args) {
  const msg = new Date().toISOString() + ' ' + args.join(' ') + '\n';
  fs.appendFileSync(logFile, msg);
  console.log(msg.trim());
}

// ---------- Startup ----------
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ---------- Globals ----------
let mainWindow = null;
let tray = null;
let api = new ApiClient('http://127.0.0.1:4096');
let cache = new Cache(path.join(app.getPath('userData'), 'cache'));

// ---------- Window ----------
function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    frame: false, titleBarStyle: 'hidden', backgroundColor: '#ffffff',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    show: false,
  });
  if (process.platform === 'win32') mainWindow.setIcon(iconPath);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => { if (tray) { e.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------- Tray ----------
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let icon;
  try { icon = nativeImage.createFromPath(iconPath); if (icon.isEmpty()) throw new Error(); }
  catch { icon = nativeImage.createEmpty(); }
  tray = new Tray(icon);
  tray.setToolTip('MiMo Code - Max');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show MiMo Code', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray.destroy(); tray = null; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow && mainWindow.show());
}

// ---------- IPC: API ----------
ipcMain.handle('api:get-sessions', async () => {
  try { const s = await api.getSessions(); cache.setSessions(s); return s; }
  catch { return cache.getSessions(); }
});
ipcMain.handle('api:get-session', (_, id) => api.getSession(id));
ipcMain.handle('api:get-messages', async (_, sessionId) => {
  try {
    const msgs = await api.getMessages(sessionId);
    if (Array.isArray(msgs) && msgs.length > 0) { cache.setMessages(sessionId, msgs); return msgs; }
    const cached = cache.getMessages(sessionId);
    return cached.length > 0 ? cached : (msgs || []);
  } catch { return cache.getMessages(sessionId); }
});
ipcMain.handle('api:get-config', async () => {
  try { const c = await api.getConfig(); cache.setConfig(c); return c; }
  catch { return cache.getConfig(); }
});
ipcMain.handle('api:create-session', (_, data) => api.createSession(data));
ipcMain.handle('api:delete-session', (_, id) => api.deleteSession(id));
ipcMain.handle('api:send-message', async (_, { sessionId, content, agent, images }) => {
  for (let i = 0; i < 10; i++) {
    try { return await api.sendMessage(sessionId, content, agent, images); }
    catch (e) { if (e.message === 'busy' && i < 9) { await new Promise(r => setTimeout(r, 2000)); continue; } throw e; }
  }
});
ipcMain.handle('api:set-server-url', (_, url) => { api.setUrl(url); return true; });
ipcMain.handle('api:get-server-url', () => api.baseUrl);

// ---------- SSE: http.request on /event (V1 API) ----------
let sseSessionId = null;
let sseConnection = null;
let sseReconnectTimer = null;
let sseStopped = true;

function startSSE(sessionId) {
  if (!sessionId) return;
  stopSSE();
  sseSessionId = sessionId;
  sseStopped = false;
  connectSSE();
  log('[SSE] Starting for session:', sessionId);
}

function connectSSE() {
  if (!sseSessionId || sseStopped) return;

  const url = new URL('/event', api.baseUrl);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'GET',
    headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
  };

  sseConnection = http.request(options, (res) => {
    log('[SSE] Connected, status:', res.statusCode);

    if (res.statusCode !== 200) {
      res.resume();
      scheduleReconnect(5000);
      return;
    }

    let buffer = '';
    let firstData = true;

    res.on('data', (chunk) => {
      if (firstData) { log('[SSE] First data received'); firstData = false; }
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (!data._logged) { log('[SSE] Raw event:', JSON.stringify(data).substring(0, 300)); data._logged = true; }
          handleSSEEvent(data);
        } catch {}
      }
    });

    res.on('end', () => {
      log('[SSE] Connection ended');
      sseConnection = null;
      scheduleReconnect(3000);
    });

    res.on('error', () => {
      sseConnection = null;
      scheduleReconnect(3000);
    });
  });

  sseConnection.on('error', (err) => {
    if (!sseStopped) {
      log('[SSE] Error:', err.message);
      sseConnection = null;
      scheduleReconnect(5000);
    }
  });

  sseConnection.setTimeout(0);
  sseConnection.end();
}

// V1 /event format: { type, properties }
function handleSSEEvent(data) {
  const eventType = data.type;
  const eventSessionId = data.properties?.sessionID
    || data.properties?.info?.sessionID
    || data.properties?.part?.sessionID;

  log('[SSE] Event:', eventType, 'session:', eventSessionId, 'current:', sseSessionId);

  if (!eventSessionId || eventSessionId !== sseSessionId) return;
  if (!mainWindow || mainWindow.isDestroyed()) { log('[SSE] No window!'); return; }

  if (eventType === 'message.part.updated' || eventType === 'message.updated' || eventType === 'message.part.delta') {
    // Handle delta events differently - they have delta/field, not part
    let part = data.properties?.part;
    let messageID = data.properties?.messageID || part?.messageID;

    if (eventType === 'message.part.delta' && !part) {
      // Delta events: { type, properties: { sessionID, messageID, partID, field, delta } }
      part = {
        id: data.properties?.partID,
        type: data.properties?.field === 'text' ? 'text' : data.properties?.field,
        text: data.properties?.delta,
        messageID: data.properties?.messageID,
        _isDelta: true,
      };
      messageID = data.properties?.messageID;
    }

    mainWindow.webContents.send('sse:message-event', {
      type: eventType,
      sessionId: eventSessionId,
      part: part,
      info: data.properties?.info,
      messageID: messageID,
    });
  }

  if (eventType === 'session.idle' || eventType === 'session.status') {
    mainWindow.webContents.send('sse:session-idle', {
      sessionId: eventSessionId,
      type: eventType,
    });
  }
}

function scheduleReconnect(ms) {
  if (sseStopped) return;
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
  sseReconnectTimer = setTimeout(() => { if (!sseStopped && sseSessionId) connectSSE(); }, ms);
}

function stopSSE() {
  sseStopped = true;
  sseSessionId = null;
  if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null; }
  if (sseConnection) { sseConnection.removeAllListeners(); sseConnection.destroy(); sseConnection = null; }
}

ipcMain.handle('sse:start', (_, sessionId) => { startSSE(sessionId); return true; });
ipcMain.handle('sse:stop', () => { stopSSE(); return true; });

// ---------- Window controls ----------
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:maximize', () => { if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window:close', () => mainWindow && mainWindow.close());
ipcMain.on('window:open-external', (_, url) => shell.openExternal(url));

// ---------- App lifecycle ----------
app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', () => { if (tray) tray.destroy(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
