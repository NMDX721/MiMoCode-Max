/**
 * 增量同步客户端
 * 使用 POST /sync/history 端点进行增量消息同步
 */
class SyncClient {
  constructor(api) {
    this.api = api;
    // { sessionId: lastSeq } 映射
    this.lastSeqMap = {};
  }

  /**
   * 获取增量事件
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Array>} 新事件列表
   */
  async getEvents(sessionId) {
    const lastSeq = this.lastSeqMap[sessionId] || 0;

    // 发送当前已知的序列号
    const body = { [sessionId]: lastSeq };

    try {
      const events = await this.api.request('POST', '/sync/history', body);

      // 更新本地序列号
      if (Array.isArray(events) && events.length > 0) {
        const maxSeq = Math.max(...events.map(e => e.seq || 0));
        if (maxSeq > lastSeq) {
          this.lastSeqMap[sessionId] = maxSeq;
        }
      }

      return events || [];
    } catch (e) {
      // 409 或其他错误时返回空数组
      return [];
    }
  }

  /**
   * 重置指定会话的序列号（用于重新加载）
   */
  resetSession(sessionId) {
    delete this.lastSeqMap[sessionId];
  }

  /**
   * 重置所有会话
   */
  resetAll() {
    this.lastSeqMap = {};
  }
}

module.exports = SyncClient;
