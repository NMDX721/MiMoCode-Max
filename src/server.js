// server.js - MiMo Code Server 管理
// 关键发现：TUI 启动时会自动启动 server
// Max 应该连接到 TUI 的 server，而不是自己启动

const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 调试日志函数 - 写入文件（带旋转）
const logFile = path.join(process.env.USERPROFILE || '', '.mimocode_home', 'max-debug.log');
const MAX_LOG_SIZE = 1024 * 1024; // 1MB
function safeLog(...args) {
  const msg = new Date().toISOString() + ' [Server] ' + args.join(' ') + '\n';
  try {
    // 旋转日志
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_SIZE) {
      fs.renameSync(logFile, logFile + '.old');
    }
    fs.appendFileSync(logFile, msg);
  } catch {}
  try { console.log(msg.trim()); } catch {}
}

class ServerManager {
  constructor(port = 4096) {
    this.port = port;
    this.process = null;
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.isHeadlessServer = false;
    safeLog('ServerManager initialized on port', this.port);
  }

  // 检查 server 是否运行
  async isRunning() {
    return new Promise((resolve) => {
      const req = http.get(`${this.baseUrl}/global/health`, (res) => {
        const running = res.statusCode === 200;
        safeLog('isRunning check:', running ? 'YES' : 'NO', '(status:', res.statusCode, ')');
        resolve(running);
        res.resume();
      });
      req.on('error', (err) => {
        safeLog('isRunning check: NO (error:', err.message, ')');
        resolve(false);
      });
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
      const running = output.includes('mimo.exe');
      safeLog('TUI check:', running ? 'RUNNING' : 'NOT RUNNING');
      if (running) {
        safeLog('TUI process details:', output.substring(0, 200));
      }
      return running;
    } catch (err) {
      safeLog('TUI check: ERROR', err.message);
      return false;
    }
  }

  // 启动 server
  async start() {
    safeLog('=== Starting server check ===');

    // 步骤 1: 检查 server 是否已在运行
    safeLog('Step 1: Checking if server is already running...');
    if (await this.isRunning()) {
      safeLog('✓ Server already running on port', this.port);
      safeLog('✓ Connecting to existing server (TUI or headless)');
      this.isHeadlessServer = false;
      return true;
    }

    // 步骤 2: 检查 TUI 是否在运行
    safeLog('Step 2: Checking if TUI is running...');
    if (this.isTuiRunning()) {
      safeLog('TUI is running but server not responding');
      safeLog('Waiting for TUI server to start (up to 10 seconds)...');

      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        safeLog(`Wait attempt ${i + 1}/10...`);
        if (await this.isRunning()) {
          safeLog('✓ TUI server is now running');
          return true;
        }
      }

      safeLog('⚠ TUI server did not start, will start headless server');
    } else {
      safeLog('TUI is not running');
    }

    // 步骤 3: 启动 headless server
    safeLog('Step 3: Starting headless server on port', this.port);
    this.isHeadlessServer = true;

    return new Promise((resolve) => {
      safeLog('Spawning: mimo serve --port', this.port);

      // 使用 cmd.exe /c 来确保 PATH 被解析，同时隐藏窗口
      this.process = spawn('cmd.exe', ['/c', 'mimo', 'serve', '--port', String(this.port)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });

      this.process.on('error', (err) => {
        safeLog('Spawn error:', err.message);
      });

      this.process.on('exit', (code) => {
        safeLog('Process exited with code:', code);
      });

      this.process.unref();

      let retries = 0;
      const checkInterval = setInterval(async () => {
        retries++;
        safeLog(`Checking server (attempt ${retries}/30)...`);
        if (await this.isRunning()) {
          clearInterval(checkInterval);
          safeLog('✓ Headless server started successfully');
          resolve(true);
        } else if (retries >= 30) {
          clearInterval(checkInterval);
          safeLog('✗ Failed to start headless server after 30 retries');
          resolve(false);
        }
      }, 1000);
    });
  }

  // 停止 server
  stop() {
    safeLog('=== Stopping server ===');
    if (this.process && this.isHeadlessServer) {
      safeLog('Stopping headless server...');
      this.process.kill();
      this.process = null;
      this.isHeadlessServer = false;
      safeLog('✓ Headless server stopped');
    } else {
      safeLog('Not stopping server (managed by TUI or not started by Max)');
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
