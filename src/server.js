// server.js - MiMo Code Headless Server 管理
const { spawn, execSync } = require('child_process');
const http = require('http');

// 安全的日志函数，避免 EPIPE 错误
function safeLog(...args) {
  try {
    console.log(...args);
  } catch {}
}

class ServerManager {
  constructor(port = 4096) {
    this.port = port;
    this.process = null;
    this.baseUrl = `http://127.0.0.1:${port}`;
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

  // 关闭 TUI 进程
  killTui() {
    try {
      execSync('taskkill /F /IM mimo.exe', {
        windowsHide: true,
        stdio: 'ignore',
      });
      safeLog('[Server] TUI process terminated');
      return true;
    } catch {
      safeLog('[Server] No TUI process found');
      return false;
    }
  }

  // 等待端口空闲
  async waitForPortFree(timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const inUse = await this.isPortInUse();
      if (!inUse) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  // 检查端口是否被占用
  async isPortInUse() {
    return new Promise((resolve) => {
      const req = http.get(`${this.baseUrl}/global/health`, (res) => {
        resolve(true);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
  }

  // 启动 server（Max 专用）
  async start() {
    safeLog('[Server] Starting MiMo Code server for Max...');

    // 步骤 1: 检查 TUI 是否在运行
    if (this.isTuiRunning()) {
      safeLog('[Server] TUI detected, terminating...');
      this.killTui();
      // 等待端口释放
      await this.waitForPortFree(5000);
    }

    // 步骤 2: 检查 server 是否已在运行
    if (await this.isRunning()) {
      safeLog('[Server] Server already running on port', this.port);
      return true;
    }

    // 步骤 3: 启动新的 server
    safeLog('[Server] Starting server on port', this.port);

    return new Promise((resolve) => {
      this.process = spawn('mimo', ['serve', '--port', String(this.port)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });

      this.process.unref();

      let retries = 0;
      const checkInterval = setInterval(async () => {
        if (await this.isRunning()) {
          clearInterval(checkInterval);
          safeLog('[Server] Server started successfully on port', this.port);
          resolve(true);
        } else if (retries++ > 30) {
          clearInterval(checkInterval);
          safeLog('[Server] Failed to start after 30 retries');
          resolve(false);
        }
      }, 1000);
    });
  }

  // 停止 server
  stop() {
    if (this.process) {
      safeLog('[Server] Stopping server...');
      this.process.kill();
      this.process = null;
    }
  }

  // 获取服务器状态
  getStatus() {
    return {
      port: this.port,
      baseUrl: this.baseUrl,
      isRunning: this.process !== null || false,
      tuiRunning: this.isTuiRunning(),
    };
  }
}

module.exports = ServerManager;
