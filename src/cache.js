const fs = require('fs');
const path = require('path');

class Cache {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.messagesDir = path.join(baseDir, 'messages');
    this._ensureDirs();
  }

  _ensureDirs() {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.messagesDir, { recursive: true });
  }

  // ---------- Sessions ----------

  getSessions() {
    try {
      const data = fs.readFileSync(path.join(this.baseDir, 'sessions.json'), 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  setSessions(sessions) {
    fs.writeFileSync(
      path.join(this.baseDir, 'sessions.json'),
      JSON.stringify(sessions, null, 2),
      'utf-8'
    );
  }

  // ---------- Messages ----------

  getMessages(sessionId) {
    try {
      const filePath = path.join(this.messagesDir, `${sessionId}.json`);
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  setMessages(sessionId, messages) {
    const filePath = path.join(this.messagesDir, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf-8');
  }

  // Append new messages to cache (dedup by id)
  appendMessages(sessionId, newMessages) {
    const existing = this.getMessages(sessionId);
    const existingIds = new Set(existing.map(m => m.info?.id));
    const toAdd = newMessages.filter(m => !existingIds.has(m.info?.id));
    if (toAdd.length > 0) {
      this.setMessages(sessionId, [...existing, ...toAdd]);
    }
    return toAdd.length;
  }

  // ---------- Config ----------

  getConfig() {
    try {
      const data = fs.readFileSync(path.join(this.baseDir, 'config.json'), 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  setConfig(config) {
    fs.writeFileSync(
      path.join(this.baseDir, 'config.json'),
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }
}

module.exports = Cache;
