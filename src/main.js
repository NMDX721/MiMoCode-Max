const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ApiClient = require('./api');
const Cache = require('./cache');
const ServerManager = require('./server');
const serverManager = new ServerManager();

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
ipcMain.handle('api:update-session', (_, { id, data }) => api.updateSession(id, data));
ipcMain.handle('api:delete-session', (_, id) => api.deleteSession(id));
ipcMain.handle('api:send-message', async (_, { sessionId, content, agent, images }) => {
  for (let i = 0; i < 30; i++) {
    try { return await api.sendMessage(sessionId, content, agent, images); }
    catch (e) {
      if (e.message === 'busy' && i < 29) {
        await new Promise(r => setTimeout(r, 1000)); // Wait 1 second between retries
        continue;
      }
      throw e;
    }
  }
});
ipcMain.handle('api:set-server-url', (_, url) => { api.setUrl(url); return true; });
ipcMain.handle('api:get-server-url', () => api.baseUrl);
ipcMain.handle('api:abort-message', (_, sessionId) => api.abortMessage(sessionId));
ipcMain.handle('api:get-logs', () => {
  try {
    // Read only last 50KB of log file to prevent hanging
    const stat = fs.statSync(logFile);
    const readSize = Math.min(stat.size, 50 * 1024);
    const fd = fs.openSync(logFile, 'r');
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch { return ''; }
});

ipcMain.handle('api:get-server-logs', async () => {
  try {
    const logPath = path.join(app.getPath('userData'), 'server.log');
    if (fs.existsSync(logPath)) {
      return fs.readFileSync(logPath, 'utf8');
    }
    return 'No server logs available';
  } catch {
    return 'Failed to read server logs';
  }
});

ipcMain.handle('server:status', async () => {
  return await serverManager.isRunning();
});
ipcMain.handle('server:restart', async () => {
  serverManager.stop();
  return await serverManager.start();
});

// ---------- SSE: http.request on /event (V1 API) ----------
let sseSessionId = null;
let sseConnection = null;
let sseReconnectTimer = null;
let sseStopped = true;
const reasoningPartIds = new Set(); // Track reasoning part IDs

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
      scheduleReconnect(Math.min(1000 * Math.pow(2, reconnectAttempts++), 30000));
      return;
    }

    let buffer = '';
    let firstData = true;

    res.on('data', (chunk) => {
      if (firstData) { log('[SSE] First data received'); firstData = false; reconnectAttempts = 0; }
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
      scheduleReconnect(Math.min(1000 * Math.pow(2, reconnectAttempts++), 30000));
    });

    res.on('error', () => {
      sseConnection = null;
      scheduleReconnect(Math.min(1000 * Math.pow(2, reconnectAttempts++), 30000));
    });
  });

  sseConnection.on('error', (err) => {
    if (!sseStopped) {
      log('[SSE] Error:', err.message);
      sseConnection = null;
      scheduleReconnect(Math.min(1000 * Math.pow(2, reconnectAttempts++), 30000));
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

    // Track reasoning part IDs from updated events
    if (part?.type === 'reasoning' && part?.id) {
      reasoningPartIds.add(part.id);
    }

    if (eventType === 'message.part.delta' && !part) {
      // Delta events: { type, properties: { sessionID, messageID, partID, field, delta } }
      const partID = data.properties?.partID;
      // Check if this partID is a reasoning part
      const isReasoning = reasoningPartIds.has(partID);

      part = {
        id: partID,
        type: isReasoning ? 'reasoning' : (data.properties?.field === 'text' ? 'text' : data.properties?.field),
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

let reconnectAttempts = 0;

function scheduleReconnect(ms) {
  if (sseStopped) return;
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
  sseReconnectTimer = setTimeout(() => {
    if (!sseStopped && sseSessionId) {
      log('[SSE] Attempting reconnect...');
      connectSSE();
    }
  }, ms);
}

function stopSSE() {
  sseStopped = true;
  sseSessionId = null;
  reasoningPartIds.clear(); // Clear tracking on stop
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
app.whenReady().then(async () => {
  log('[App] Starting MiMo Code - Max...');

  // 检查并关闭 TUI，确保 Max 独占 API
  if (serverManager.isTuiRunning()) {
    log('[App] TUI detected, terminating for exclusive access...');
    serverManager.killTui();
    // 等待端口释放
    await new Promise(r => setTimeout(r, 2000));
  }

  // 启动 headless server
  const serverStarted = await serverManager.start();
  if (serverStarted) {
    log('[App] Server started successfully');
  } else {
    log('[App] Warning: Server failed to start');
  }

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  log('[App] Shutting down...');
  serverManager.stop();
  if (tray) tray.destroy();
  app.quit();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
