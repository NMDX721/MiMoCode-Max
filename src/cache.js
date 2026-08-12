const fs = require('fs');
const path = require('path');

class Cache {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.messagesDir = path.join(baseDir, 'messages');
    this.memoryCache = new Map(); // In-memory cache for frequently accessed data
    this._ensureDirs();
  }

  _ensureDirs() {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.messagesDir, { recursive: true });
  }

  // ---------- Sessions ----------

  getSessions() {
    const cacheKey = 'sessions';
    const cached = this._getFromMemoryCache(cacheKey);
    if (cached) return cached;

    try {
      const data = fs.readFileSync(path.join(this.baseDir, 'sessions.json'), 'utf-8');
      const sessions = JSON.parse(data);
      this._setToMemoryCache(cacheKey, sessions, 30000); // Cache for 30 seconds
      return sessions;
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
    this._setToMemoryCache('sessions', sessions, 30000);
  }

  // ---------- Messages ----------

  getMessages(sessionId) {
    const cacheKey = `messages:${sessionId}`;
    const cached = this._getFromMemoryCache(cacheKey);
    if (cached) return cached;

    try {
      const filePath = path.join(this.messagesDir, `${sessionId}.json`);
      const data = fs.readFileSync(filePath, 'utf-8');
      const messages = JSON.parse(data);
      this._setToMemoryCache(cacheKey, messages, 10000); // Cache for 10 seconds
      return messages;
    } catch {
      return [];
    }
  }

  setMessages(sessionId, messages) {
    const filePath = path.join(this.messagesDir, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf-8');
    this._setToMemoryCache(`messages:${sessionId}`, messages, 10000);
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

  // Update a single message in cache (for streaming updates)
  updateMessage(sessionId, message) {
    if (!message?.info?.id) return false;

    const messages = this.getMessages(sessionId);
    const index = messages.findIndex(m => m.info?.id === message.info.id);

    if (index >= 0) {
      messages[index] = message;
      this.setMessages(sessionId, messages);
      return true;
    } else {
      // Message not found, append it
      this.setMessages(sessionId, [...messages, message]);
      return true;
    }
  }

  // ---------- Config ----------

  getConfig() {
    const cached = this._getFromMemoryCache('config');
    if (cached) return cached;

    try {
      const data = fs.readFileSync(path.join(this.baseDir, 'config.json'), 'utf-8');
      const config = JSON.parse(data);
      this._setToMemoryCache('config', config, 60000); // Cache for 60 seconds
      return config;
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
    this._setToMemoryCache('config', config, 60000);
  }

  // ---------- Memory Cache Helpers ----------

  _getFromMemoryCache(key) {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.data;
  }

  _setToMemoryCache(key, data, ttlMs) {
    this.memoryCache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs
    });
    // Limit cache size to prevent memory leaks
    if (this.memoryCache.size > 100) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
    }
  }

  // Clear all cache
  clearAll() {
    this.memoryCache.clear();
  }
}

module.exports = Cache;
