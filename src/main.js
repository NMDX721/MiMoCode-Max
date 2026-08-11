const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const ApiClient = require('./api');
const Cache = require('./cache');
const SyncClient = require('./sync');

// ---------- Logging ----------
const logFile = path.join(app.getPath('userData'), 'debug.log');
function log(...args) {
  const msg = new Date().toISOString() + ' ' + args.join(' ') + '\n';
  fs.appendFileSync(logFile, msg);
  console.log(msg.trim());
}

// ---------- Startup optimization ----------
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'TranslateUI');
app.commandLine.appendSwitch('disable-extensions');

// ---------- Globals ----------
let mainWindow = null;
let tray = null;
let api = new ApiClient('http://127.0.0.1:4096');
let cache = new Cache(path.join(app.getPath('userData'), 'cache'));
let syncClient = new SyncClient(api);

// ---------- Window ----------
function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch { icon = nativeImage.createEmpty(); }

  tray = new Tray(icon);
  tray.setToolTip('MiMo Code - Max');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show MiMo Code', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray.destroy(); tray = null; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow && mainWindow.show());
}

// ---------- IPC handlers ----------
// Sessions
ipcMain.handle('api:get-sessions', async () => {
  try {
    const sessions = await api.getSessions();
    cache.setSessions(sessions);
    return sessions;
  } catch {
    return cache.getSessions();
  }
});

ipcMain.handle('api:get-session', (_, id) => api.getSession(id));

// Messages
ipcMain.handle('api:get-messages', async (_, sessionId) => {
  try {
    const msgs = await api.getMessages(sessionId);
    console.log('[API] getMessages:', sessionId, '->', Array.isArray(msgs) ? msgs.length : 'error', 'msgs');
    cache.setMessages(sessionId, msgs);
    return msgs;
  } catch (e) {
    console.log('[API] getMessages fallback to cache:', e.message);
    return cache.getMessages(sessionId);
  }
});

ipcMain.handle('api:get-messages-light', async (_, sessionId) => {
  try {
    const msgs = await api.getMessagesLight(sessionId);
    console.log('[API] getMessagesLight:', sessionId, '->', Array.isArray(msgs) ? msgs.length : 'error', 'msgs');
    return msgs;
  } catch (e) {
    console.log('[API] getMessagesLight error:', e.message);
    return [];
  }
});

// Incremental sync
ipcMain.handle('api:sync-events', async (_, sessionId) => {
  try {
    const events = await syncClient.getEvents(sessionId);
    console.log('[API] syncEvents:', sessionId, '->', Array.isArray(events) ? events.length : 'error', 'events');
    return events;
  } catch (e) {
    console.log('[API] syncEvents error:', e.message);
    return [];
  }
});

ipcMain.handle('api:sync-reset', (_, sessionId) => {
  if (sessionId) {
    syncClient.resetSession(sessionId);
  } else {
    syncClient.resetAll();
  }
  return true;
});

// Config
ipcMain.handle('api:get-config', async () => {
  try {
    const config = await api.getConfig();
    cache.setConfig(config);
    return config;
  } catch {
    return cache.getConfig();
  }
});

// Session operations
ipcMain.handle('api:create-session', (_, data) => api.createSession(data));
ipcMain.handle('api:delete-session', (_, id) => api.deleteSession(id));

// Send message with retry on busy
ipcMain.handle('api:send-message', async (_, { sessionId, content, agent }) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await api.sendMessage(sessionId, content, agent);
    } catch (e) {
      if (e.message === 'busy' && attempt < 9) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
        continue;
      }
      throw e;
    }
  }
});

// Streaming
ipcMain.handle('api:stream-messages', (_, sessionId) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    api.streamMessages(
      sessionId,
      (data) => {
        chunks.push(data);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stream:chunk', { sessionId, data });
        }
      },
      () => resolve(chunks),
      (err) => reject(err.message)
    );
  });
});

// Server URL
ipcMain.handle('api:set-server-url', (_, url) => { api.setUrl(url); return true; });
ipcMain.handle('api:get-server-url', () => api.baseUrl);

// Cache operations
ipcMain.handle('cache:get-messages', (_, sessionId) => cache.getMessages(sessionId));

// ---------- SSE Event Stream (Main Process) ----------
let sseConnection = null;
let sseSessionId = null;

function startSSE(sessionId) {
  if (!sessionId) return;
  stopSSE();
  sseSessionId = sessionId;

  const http = require('http');
  const url = new URL('/global/event', api.baseUrl);

  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  };

  sseConnection = http.request(options, (res) => {
    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const payload = data.payload;

            // 转发消息相关事件到渲染进程
            if (payload?.type === 'message.part.updated' || payload?.type === 'message.created') {
              const eventSessionId = payload.properties?.sessionID;
              if (eventSessionId === sseSessionId && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('sse:message-event', {
                  type: payload.type,
                  sessionId: eventSessionId,
                  part: payload.properties?.part,
                  info: payload.properties?.info
                });
              }
            }

            // 会话空闲事件（回复完成）
            if (payload?.type === 'session.idle' || payload?.type === 'session.status') {
              const eventSessionId = payload.properties?.sessionID;
              if (eventSessionId === sseSessionId && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('sse:session-idle', { sessionId: eventSessionId });
              }
            }
          } catch {}
        }
      }
    });

    res.on('end', () => {
      // 连接断开，5秒后重连
      if (sseSessionId) {
        setTimeout(() => startSSE(sseSessionId), 5000);
      }
    });
  });

  sseConnection.on('error', () => {
    // 连接错误，5秒后重连
    if (sseSessionId) {
      setTimeout(() => startSSE(sseSessionId), 5000);
    }
  });

  sseConnection.setTimeout(0);
  sseConnection.end();
  log('[SSE] Connected to event stream for session:', sessionId);
}

function stopSSE() {
  if (sseConnection) {
    sseConnection.destroy();
    sseConnection = null;
  }
  sseSessionId = null;
}

ipcMain.handle('sse:start', (_, sessionId) => {
  startSSE(sessionId);
  return true;
});

ipcMain.handle('sse:stop', () => {
  stopSSE();
  return true;
});

// Window controls
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());
ipcMain.on('window:open-external', (_, url) => shell.openExternal(url));

// ---------- App lifecycle ----------
app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', () => { if (tray) tray.destroy(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
