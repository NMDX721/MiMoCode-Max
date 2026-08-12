// server.js - MiMo Code Headless Server 管理
const { spawn } = require('child_process');
const http = require('http');

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

  // 启动 server
  async start() {
    if (await this.isRunning()) {
      console.log('[Server] Already running on port', this.port);
      return true;
    }

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
          console.log('[Server] Started on port', this.port);
          resolve(true);
        } else if (retries++ > 30) {
          clearInterval(checkInterval);
          console.error('[Server] Failed to start after 30 retries');
          resolve(false);
        }
      }, 1000);
    });
  }

  // 停止 server
  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

module.exports = ServerManager;
