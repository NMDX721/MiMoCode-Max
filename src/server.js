// server.js - MiMo Code Server 管理
// 关键发现：TUI 启动时会自动启动 server
// Max 应该连接到 TUI 的 server，而不是自己启动

const { spawn, execSync } = require('child_process');
const http = require('http');

function safeLog(...args) {
  try { console.log(...args); } catch {}
}

class ServerManager {
  constructor(port = 4096) {
    this.port = port;
    this.process = null;
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.isHeadlessServer = false;  // 标记是否是 Max 自己启动的 server
  }

  // 检查 server 是否运行
  async isRunning() {
    return new Promise((resolve) => {
      const req = http.get(`${this.baseUrl}/global/health`, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  }

  // 检查 TUI 是否在运行
  isTuiRunning() {
    try {
      const output = execSync('tasklist /FI "IMAGENAME eq mimo.exe" /NH', {
        encoding: 'utf8',
        windowsHide: true,
      });
      return output.includes('mimo.exe');
    } catch {
      return false;
    }
  }

  // 启动 server（Max 专用）
  async start() {
    safeLog('[Server] Checking server status...');

    // 关键逻辑：如果 server 已经在运行（可能是 TUI 启动的），直接连接
    if (await this.isRunning()) {
      safeLog('[Server] Server already running on port', this.port);
      safeLog('[Server] Connecting to existing server (TUI or headless)');
      this.isHeadlessServer = false;  // 不是 Max 启动的
      return true;
    }

    // 如果 server 没运行，检查 TUI 是否在运行
    if (this.isTuiRunning()) {
      safeLog('[Server] TUI is running but server not responding');
      safeLog('[Server] Waiting for TUI server to start...');
      
      // 等待 TUI 的 server 启动
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await this.isRunning()) {
          safeLog('[Server] TUI server is now running');
          return true;
        }
      }
      
      safeLog('[Server] TUI server did not start, starting headless server');
    }

    // 如果都没有，启动 headless server
    safeLog('[Server] Starting headless server on port', this.port);
    this.isHeadlessServer = true;

    return new Promise((resolve) => {
      this.process = spawn('mimo', ['serve', '--port', String(this.port)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: true,
      });

      this.process.unref();

      let retries = 0;
      const checkInterval = setInterval(async () => {
        if (await this.isRunning()) {
          clearInterval(checkInterval);
          safeLog('[Server] Headless server started successfully');
          resolve(true);
        } else if (retries++ > 30) {
          clearInterval(checkInterval);
          safeLog('[Server] Failed to start headless server');
          resolve(false);
        }
      }, 1000);
    });
  }

  // 停止 server（只停止 Max 自己启动的）
  stop() {
    if (this.process && this.isHeadlessServer) {
      safeLog('[Server] Stopping headless server...');
      this.process.kill();
      this.process = null;
      this.isHeadlessServer = false;
    } else {
      safeLog('[Server] Not stopping server (managed by TUI)');
    }
  }

  // 获取服务器状态
  getStatus() {
    return {
      port: this.port,
      baseUrl: this.baseUrl,
      isRunning: this.process !== null || false,
      tuiRunning: this.isTuiRunning(),
      isHeadlessServer: this.isHeadlessServer,
    };
  }
}

module.exports = ServerManager;
