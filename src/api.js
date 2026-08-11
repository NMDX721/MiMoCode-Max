const http = require('http');

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  setUrl(url) {
    this.baseUrl = url;
  }

  request(method, urlPath, body, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, this.baseUrl);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 409) {
            reject(new Error('busy'));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // Convenience methods
  getSessions() { return this.request('GET', '/session'); }
  getSession(id) { return this.request('GET', `/session/${id}`); }
  getMessages(sessionId) { return this.request('GET', `/session/${sessionId}/message`); }
  getMessagesLight(sessionId) { return this.request('GET', `/session/${sessionId}/message?limit=5`); }
  syncHistory(body) { return this.request('POST', '/sync/history', body); }
  getConfig() { return this.request('GET', '/config'); }

  createSession(data) { return this.request('POST', '/session', data); }

  sendMessage(sessionId, content, agent) {
    return this.request('POST', `/session/${sessionId}/message`, {
      parts: [{ type: 'text', text: content }],
      agent: agent || 'compose',
    });
  }

  deleteSession(id) { return this.request('DELETE', `/session/${id}`); }

  // SSE streaming
  streamMessages(sessionId, onChunk, onDone, onError) {
    const url = new URL(`/session/${sessionId}/message`, this.baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    };

    const req = http.request(options, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              onChunk(JSON.parse(line.slice(6)));
            } catch {}
          }
        }
      });
      res.on('end', () => onDone());
    });

    req.on('error', onError);
    req.setTimeout(300000, () => { req.destroy(); onError(new Error('timeout')); });
    req.end();
    return req;
  }
}

module.exports = ApiClient;
