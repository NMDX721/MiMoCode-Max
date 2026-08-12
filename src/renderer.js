(() => {
  let sessions = [];
  let currentSessionId = null;
  let currentAgent = 'compose';
  let config = {};
  let isStreaming = false;
  let stopRequested = false;
  let renderedMsgIds = new Set();
  let messageCache = {};
  let loadingEl = null;
  let pendingNewChat = false;
  let pendingImages = [];
  let streamingFetchTimer = null;
  const userMsgIds = new Set(); // Track client-sent message IDs to prevent SSE duplicates
  const messageQueue = []; // Message queue for when API is busy
  let queuedImages = []; // 排队消息附带的图片

  const $ = (s) => document.querySelector(s);
  const sessionList = $('#session-list');
  const chatTitle = $('#chat-title');
  const messagesEl = $('#messages');
  const messageInput = $('#message-input');
  const btnSend = $('#btn-send');
  const btnStop = $('#btn-stop');

  async function init() {
    await loadSessions();
    await loadConfig();
    setupEventListeners();
    setupSSEListeners();
    applySettings();
    checkConnection();
  }

  // Sessions
  async function loadSessions() {
    try { sessions = await window.mimo.getSessions(); renderSessionList(); }
    catch { sessionList.innerHTML = '<div class="empty-state"><div class="text">Cannot connect</div></div>'; }
  }

  function renderSessionList() {
    const filtered = sessions.filter(s => !s.title?.toLowerCase().includes('checkpoint'));
    if (!filtered.length) { sessionList.innerHTML = '<div class="empty-state"><div class="text">No conversations</div></div>'; return; }
    sessionList.innerHTML = filtered.map(s => {
      const time = s.time?.updated ? formatTime(s.time.updated) : '';
      const active = s.id === currentSessionId ? ' active' : '';
      return `<div class="session-item${active}" data-id="${s.id}"><div class="title">${esc(s.title || 'Untitled')}</div><div class="time">${time}</div></div>`;
    }).join('');
    sessionList.querySelectorAll('.session-item').forEach(el => el.addEventListener('click', () => selectSession(el.dataset.id)));
  }

  async function selectSession(id) {
    // Clear queue when switching sessions
    if (messageQueue.length > 0) {
      messageQueue.length = 0;
      queuedImages.length = 0;
      updateQueueButton();
    }
    pendingNewChat = false;
    currentSessionId = id;
    renderedMsgIds.clear();
    delete messageCache[id];
    const session = sessions.find(s => s.id === id);
    chatTitle.textContent = session?.title || 'Untitled';
    renderSessionList();
    stopSSE();
    await loadMessages(id);
    startSSE(id);
    // Show stop button when session is active
    btnStop.classList.remove('hidden');
  }

  // Messages
  async function loadMessages(sessionId) {
    if (messageCache[sessionId]?.length) {
      renderMessages(messageCache[sessionId], false);
      return;
    }
    messagesEl.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
    try {
      const data = await window.mimo.getMessages(sessionId);
      const list = Array.isArray(data) ? data : [];
      messageCache[sessionId] = list;
      const lastUser = list.filter(m => m.info?.role === 'user').pop();
      if (lastUser?.info?.agent) currentAgent = lastUser.info.agent;
      renderMessages(list, false);
    } catch {
      messagesEl.innerHTML = '<div class="empty-state"><div class="text">Failed to load</div></div>';
    }
  }

  function renderMessages(msgs, incremental = false) {
    if (!msgs.length) { messagesEl.innerHTML = '<div class="empty-state"><div class="icon">&#x1F4AC;</div><div class="text">Start a conversation</div></div>'; renderedMsgIds.clear(); return; }
    if (!incremental) {
      const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
      messagesEl.innerHTML = '';
      renderedMsgIds.clear();
      for (const m of msgs) { const id = m.info?.id || ''; if (renderedMsgIds.has(id)) continue; renderedMsgIds.add(id); renderMsg(m); }
      if (atBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    } else {
      for (const m of msgs) { const id = m.info?.id || ''; if (renderedMsgIds.has(id)) continue; renderedMsgIds.add(id); renderMsg(m); }
      autoScroll();
    }
  }

  function renderMsg(msg) {
    const role = msg.info?.role || 'assistant';
    if (!msg.parts?.length) return;
    const container = document.createElement('div');
    container.className = `message ${role}`;
    if (msg.info?.id) container.dataset.msgId = msg.info.id;

    // Collect reasoning texts to avoid duplication
    const reasoningTexts = [];
    let originalText = '';
    for (const part of msg.parts) {
      if (part.type === 'reasoning' && part.text?.trim()) {
        reasoningTexts.push(part.text.trim());
      }
      if (part.type === 'text' && part.text?.trim()) {
        originalText += part.text;
      }
    }

    // Helper: normalize string for comparison (remove all whitespace, lowercase)
    const normalize = (s) => s.replace(/\s+/g, '').toLowerCase();

    for (const part of msg.parts) {
      switch (part.type) {
        case 'text':
          if (part.text?.trim()) {
            // Skip text if it's the same as reasoning content (prevents duplication)
            const textContent = part.text.trim();
            const normalizedText = normalize(textContent);
            const isDuplicate = reasoningTexts.some(rt => {
              const normalizedReasoning = normalize(rt);
              return normalizedReasoning === normalizedText ||
                     normalizedReasoning.includes(normalizedText) ||
                     normalizedText.includes(normalizedReasoning);
            });
            if (!isDuplicate) {
              const d = document.createElement('div');
              d.className = 'msg-text';
              d.innerHTML = fmt(part.text);
              container.appendChild(d);
            }
          }
          break;
        case 'reasoning':
          if (part.text?.trim()) container.appendChild(createThinking(part.text, false));
          break;
        case 'tool':
          container.appendChild(createTool(part));
          break;
        case 'file':
          container.appendChild(createFilePart(part));
          break;
      }
    }

    // Add copy button for assistant messages
    if (role === 'assistant' && originalText.trim()) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'msg-copy-btn';
      copyBtn.innerHTML = '&#x1F4CB;';
      copyBtn.title = 'Copy message';
      copyBtn.dataset.originalText = originalText;
      copyBtn.addEventListener('click', handleCopyMessage);
      container.appendChild(copyBtn);
    }

    if (container.children.length) messagesEl.appendChild(container);
  }

  function createThinking(text, streaming = false) {
    if (streaming) {
      // Remove streaming class from ALL previous thinking elements (they're done)
      messagesEl.querySelectorAll('.thinking.streaming').forEach(el => el.classList.remove('streaming'));
      // Update summaries of all previous thinking elements to "Thought"
      messagesEl.querySelectorAll('.thinking summary').forEach(s => { if (s.textContent === 'Thinking...') s.textContent = 'Thought'; });
    }

    const d = document.createElement('details');
    d.className = streaming ? 'thinking streaming' : 'thinking';
    const s = document.createElement('summary');
    s.textContent = streaming ? 'Thinking...' : 'Thought';
    const c = document.createElement('div'); c.className = 'thinking-content'; c.innerHTML = fmt(text || '');

    // Add copy button for thinking content
    if (!streaming && text?.trim()) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'thinking-copy-btn';
      copyBtn.innerHTML = '&#x1F4CB;';
      copyBtn.title = 'Copy thinking';
      copyBtn.dataset.originalText = text;
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCopyMessage({ currentTarget: copyBtn });
      });
      c.appendChild(copyBtn);
    }

    d.appendChild(s); d.appendChild(c);
    d.addEventListener('toggle', () => {
      s.textContent = d.classList.contains('streaming') ? 'Thinking...' : 'Thought';
    });
    return d;
  }

  function createFilePart(part) {
    const d = document.createElement('div');
    d.className = 'file-attachment';
    const isImage = part.mime?.startsWith('image/') || part.url?.startsWith('data:image/');
    if (isImage && part.url) {
      const img = document.createElement('img');
      img.src = part.url;
      img.style.maxWidth = '400px';
      img.style.borderRadius = '8px';
      img.style.cursor = 'pointer';
      img.title = part.filename || 'image';
      img.addEventListener('click', () => openImageZoom(part.url, part.filename));
      d.appendChild(img);
      if (part.filename) {
        const name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = part.filename;
        d.appendChild(name);
      }
    } else {
      d.textContent = `📎 ${part.filename || 'file'}`;
    }
    return d;
  }

  function createTool(part) {
    const tool = part.tool || 'unknown';
    const state = part.state || {};
    const status = state.status || 'pending';
    const wrapper = document.createElement('details'); wrapper.className = 'tool-call';
    const summary = document.createElement('summary');
    const icon = status === 'completed' ? '&#x2705;' : status === 'error' ? '&#x274C;' : '&#x23F3;';
    let preview = '';
    if (state.input) { const i = state.input; if (i.file_path) preview = i.file_path.split('\\').pop().split('/').pop(); else if (i.command) preview = i.command.substring(0, 60); }
    summary.innerHTML = `${icon} <strong>${tool}</strong>${preview ? ' ' + esc(preview) : ''}`;
    wrapper.appendChild(summary);
    if (state.input?.command || state.output) {
      const detail = document.createElement('div'); detail.className = 'tool-detail';
      if (state.input?.command) { const p = document.createElement('pre'); p.className = 'tool-cmd'; p.textContent = state.input.command; detail.appendChild(p); }
      if (state.output) { const p = document.createElement('pre'); p.className = 'tool-output'; p.textContent = (typeof state.output === 'string' ? state.output : JSON.stringify(state.output, null, 2)).substring(0, 3000); detail.appendChild(p); }
      wrapper.appendChild(detail);
    }
    return wrapper;
  }

  // SSE — render directly from event data, no re-fetch!
  function setupSSEListeners() {
    window.mimo.onSSEMessageEvent(async (event) => {
      if (!currentSessionId || event.sessionId !== currentSessionId) return;

      // Render directly from SSE event data
      const part = event.part;
      const info = event.info;
      const messageID = event.messageID || part?.messageID;

      console.log('[SSE-EVENT] msgID:', messageID, 'role:', info?.role, 'partType:', part?.type, 'existing:', !!messagesEl.querySelector(`[data-msg-id="${messageID}"]`));

      if (part && messageID) {
        renderPartFromEvent(messageID, info, part);
        autoScroll();
        // Show stop button when receiving events (something is being processed)
        if (!isStreaming) {
          isStreaming = true;
          btnSend.disabled = true;
        }
      }
    });

    window.mimo.onSSESessionIdle(async (event) => {
      if (!currentSessionId || event.sessionId !== currentSessionId) return;
      const mySessionId = currentSessionId; // capture at event time
      isStreaming = false;
      btnSend.disabled = false;
      removeLoading();
      stopStreamingFetch();
      // Mark all thinking elements as done streaming
      messagesEl.querySelectorAll('.thinking.streaming').forEach(el => {
        el.classList.remove('streaming');
        // Update summary from "Thinking..." to "Thought"
        const summary = el.querySelector('summary');
        if (summary && summary.textContent === 'Thinking...') summary.textContent = 'Thought';
      });
      // Remove empty thinking blocks (thinking finished with no content)
      messagesEl.querySelectorAll('.thinking').forEach(el => {
        const content = el.querySelector('.thinking-content');
        if (content && !content.textContent.trim()) el.remove();
      });
      // Final fetch to ensure completeness — only add NEW messages, don't re-render existing
      delete messageCache[mySessionId];
      try {
        const msgs = await window.mimo.getMessages(mySessionId);
        // Bail if user switched sessions during fetch
        if (currentSessionId !== mySessionId) return;
        const list = Array.isArray(msgs) ? msgs : [];
        messageCache[mySessionId] = list;
        for (const m of list) {
          const id = m.info?.id || '';
          const role = m.info?.role || 'assistant';
          // Skip user messages — already rendered client-side in sendMessage
          if (role === 'user' || userMsgIds.has(id)) {
            // Adopt pending userDiv if it lacks data-msg-id or has temp pending-* id
            if (id) {
              const pending = messagesEl.querySelector('.message.user:not([data-msg-id]), .message.user[data-msg-id^="pending-"]');
              if (pending) {
                if (pending.dataset.msgId?.startsWith('pending-')) userMsgIds.delete(pending.dataset.msgId);
                pending.dataset.msgId = id;
                renderedMsgIds.add(id);
                userMsgIds.add(id);
              }
            }
            continue;
          }
          if (messagesEl.querySelector(`[data-msg-id="${id}"]`)) continue; // already in DOM
          const container = document.createElement('div');
          container.className = `message ${role}`;
          container.dataset.msgId = id;

          // Collect reasoning texts to avoid duplication
          const reasoningTexts = [];
          for (const part of m.parts || []) {
            if (part.type === 'reasoning' && part.text?.trim()) {
              reasoningTexts.push(part.text.trim());
            }
          }

          for (const part of m.parts || []) {
            if (part.type === 'text' && part.text?.trim()) {
              // Skip text if it's the same as reasoning content (prevents duplication)
              const textContent = part.text.trim();
              const isDuplicate = reasoningTexts.some(rt =>
                rt === textContent || rt.includes(textContent) || textContent.includes(rt)
              );
              if (!isDuplicate) {
                const d = document.createElement('div');
                d.className = 'msg-text';
                d.innerHTML = fmt(part.text);
                container.appendChild(d);
              }
            }
            else if (part.type === 'reasoning' && part.text?.trim()) {
              // Skip reasoning if thinking block already exists in this container
              if (!container.querySelector('.thinking')) {
                container.appendChild(createThinking(part.text, false));
              }
            }
            else if (part.type === 'tool') container.appendChild(createTool(part));
            else if (part.type === 'file') container.appendChild(createFilePart(part));
          }
          if (container.children.length) messagesEl.appendChild(container);
        }
        autoScroll();
      } catch {}
      // Process queued messages after session becomes idle
      if (insertPending) {
        insertPending = false;
        processMessageQueue();
      } else {
        processMessageQueue();
      }
    });
  }

  // Render a single part from SSE event directly into DOM
  function renderPartFromEvent(messageID, info, part) {
    // Skip if stop was requested
    if (stopRequested) return;

    // Skip if this is a client-sent user message
    if (userMsgIds.has(messageID)) return;

    // Skip step-start/step-finish (these don't produce visible content)
    if (part.type === 'step-start' || part.type === 'step-finish') return;

    // Find existing message container by messageID
    let container = messagesEl.querySelector(`[data-msg-id="${messageID}"]`);

    if (!container) {
      // Check if there's a pending user message — adopt it
      // Match: no data-msg-id OR temp pending-* id
      const pending = messagesEl.querySelector('.message.user:not([data-msg-id]), .message.user[data-msg-id^="pending-"]');
      if (pending) {
        // If it has a temp pending-* ID, remove from userMsgIds
        if (pending.dataset.msgId?.startsWith('pending-')) {
          userMsgIds.delete(pending.dataset.msgId);
        }
        pending.dataset.msgId = messageID;
        renderedMsgIds.add(messageID);
        userMsgIds.add(messageID);
        return;
      }
      // Skip user messages explicitly marked
      if (info?.role === 'user') return;
      // Create container for new messages (assistant or unknown role)
      // Don't append to DOM yet — wait until we have content
      const role = info?.role || 'assistant';
      container = document.createElement('div');
      container.className = `message ${role}`;
      container.dataset.msgId = messageID;
      container._needsAppend = true;
      renderedMsgIds.add(messageID);
    }

    // When a tool event arrives, mark any streaming thinking in this message as done
    if (part.type === 'tool') {
      container.querySelectorAll('.thinking.streaming').forEach(el => el.classList.remove('streaming'));
    }

    // Check if this part already exists in the container
    // For reasoning parts, normalize key — API may send different IDs across events
    let partKey = `${part.type}-${part.id || part.callID || ''}`;
    if (part.type === 'reasoning') {
      // Try to find any existing thinking element in this container
      const existingThinking = container.querySelector('.thinking');
      if (existingThinking) {
        updatePartElement(existingThinking, part);
        return;
      }
    }
    if (container.querySelector(`[data-part-key="${partKey}"]`)) {
      // Update existing part
      const existing = container.querySelector(`[data-part-key="${partKey}"]`);
      updatePartElement(existing, part);
      return;
    }

    // Create new part element
    const el = createPartElement(part);
    if (el) {
      el.dataset.partKey = partKey;
      container.appendChild(el);
      // If container was created by us but not yet appended, append it now
      if (container._needsAppend) {
        messagesEl.appendChild(container);
        container._needsAppend = false;
      }
    }
  }

  function createPartElement(part) {
    switch (part.type) {
      case 'text': {
        if (!part.text?.trim()) return null;
        const div = document.createElement('div');
        div.className = 'msg-text';
        div.innerHTML = fmt(part.text);
        return div;
      }
      case 'reasoning': {
        return createThinking(part.text || '', true);
      }
      case 'tool': {
        return createTool(part);
      }
      case 'file': {
        return createFilePart(part);
      }
      default: return null;
    }
  }

  function updatePartElement(el, part) {
    if (part.type === 'text' && part.text) {
      // Check if this is a delta (partial update) or full text
      if (part._isDelta && el.textContent) {
        // Append delta to existing text
        el.innerHTML = fmt(el.textContent + part.text);
      } else {
        el.innerHTML = fmt(part.text);
      }
    } else if (part.type === 'reasoning') {
      // Update thinking content if text arrived
      if (part.text) {
        const content = el.querySelector('.thinking-content');
        if (content) {
          if (part._isDelta && content.textContent) {
            // Append delta to existing thinking content
            content.innerHTML = fmt(content.textContent + part.text);
          } else {
            content.innerHTML = fmt(part.text);
          }
        }
      }
      // Keep summary as "Thinking..." while streaming
      const summary = el.querySelector('summary');
      if (summary && el.classList.contains('streaming')) summary.textContent = 'Thinking...';
    } else if (part.type === 'tool' && part.state) {
      // Update tool status
      const summary = el.querySelector('summary');
      if (summary) {
        const status = part.state.status || 'pending';
        const icon = status === 'completed' ? '&#x2705;' : status === 'error' ? '&#x274C;' : '&#x23F3;';
        const toolName = part.tool || 'unknown';
        let preview = '';
        if (part.state.input) {
          const i = part.state.input;
          if (i.file_path) preview = i.file_path.split('\\').pop().split('/').pop();
          else if (i.command) preview = i.command.substring(0, 60);
        }
        summary.innerHTML = `${icon} <strong>${toolName}</strong>${preview ? ' ' + esc(preview) : ''}`;
      }
      // Update output
      if (part.state.output) {
        let detail = el.querySelector('.tool-detail');
        if (!detail) { detail = document.createElement('div'); detail.className = 'tool-detail'; el.appendChild(detail); }
        let outPre = detail.querySelector('.tool-output');
        if (!outPre) { outPre = document.createElement('pre'); outPre.className = 'tool-output'; detail.appendChild(outPre); }
        outPre.textContent = (typeof part.state.output === 'string' ? part.state.output : JSON.stringify(part.state.output, null, 2)).substring(0, 3000);
      }
    }
  }

  function startSSE(id) { if (id) window.mimo.startSSE(id); }
  function stopSSE() { window.mimo.stopSSE(); stopStreamingFetch(); }

  // Periodic fetch during streaming — backup sync (reduced frequency)
  function startStreamingFetch() {
    stopStreamingFetch();
    const mySessionId = currentSessionId;
    streamingFetchTimer = setInterval(async () => {
      if (!currentSessionId || currentSessionId !== mySessionId) { stopStreamingFetch(); return; }
      try {
        const msgs = await window.mimo.getMessages(mySessionId);
        const list = Array.isArray(msgs) ? msgs : [];
        messageCache[mySessionId] = list;
        // Only update existing message elements, don't re-render all
        for (const m of list) {
          const id = m.info?.id || '';
          const role = m.info?.role || 'assistant';
          // Skip user messages
          if (role === 'user' || userMsgIds.has(id)) {
            if (id) {
              const pending = messagesEl.querySelector('.message.user:not([data-msg-id])');
              if (pending) { pending.dataset.msgId = id; renderedMsgIds.add(id); }
            }
            continue;
          }
          const container = messagesEl.querySelector(`[data-msg-id="${id}"]`);
          if (!container) continue; // new messages handled by SSE
          // Update parts in existing container
          for (const part of m.parts || []) {
            if (part.type === 'step-start' || part.type === 'step-finish') continue;
            const partKey = `${part.type}-${part.id || part.callID || ''}`;
            const existing = container.querySelector(`[data-part-key="${partKey}"]`);
            if (existing) {
              updatePartElement(existing, part);
            }
          }
        }
        autoScroll();
      } catch {}
    }, 5000); // Reduced to 5 seconds as backup only
  }

  function stopStreamingFetch() {
    if (streamingFetchTimer) { clearInterval(streamingFetchTimer); streamingFetchTimer = null; }
  }

  function stopGeneration() {
    if (!isStreaming) return;

    stopRequested = true;
    // Send abort command to API
    if (currentSessionId) {
      window.mimo.abortMessage(currentSessionId).catch(() => {});
    }
    isStreaming = false;
    btnSend.disabled = false;
    // 不调用 stopSSE() - 保留 SSE 连接以接收 idle 事件
    stopStreamingFetch();
    // Mark all streaming thinking elements as done
    messagesEl.querySelectorAll('.thinking.streaming').forEach(el => {
      el.classList.remove('streaming');
      const summary = el.querySelector('summary');
      if (summary && summary.textContent === 'Thinking...') summary.textContent = 'Thought';
    });
    removeLoading();
    showNotification('已停止生成');
  }

  // 统一的发送函数，供 sendMessage 和 processMessageQueue 使用
  async function doSendMessage(content, images, userDiv, tempId) {
    isStreaming = true;
    stopRequested = false;
    delete messageCache[currentSessionId];
    startStreamingFetch();

    try {
      await window.mimo.sendMessage(currentSessionId, content, currentAgent, (images || []).map(i => ({ data: i.data, mime: i.mime })));
      // 获取真实消息 ID
      try {
        const msgs = await window.mimo.getMessages(currentSessionId);
        const list = Array.isArray(msgs) ? msgs : [];
        const userMsgs = list.filter(m => m.info?.role === 'user');
        const pendingDivs = messagesEl.querySelectorAll('.message.user[data-msg-id^="pending-"]');
        const idx = Array.from(pendingDivs).indexOf(userDiv);
        const match = idx >= 0 ? userMsgs[idx] : userMsgs[userMsgs.length - 1];
        if (match?.info?.id) {
          userMsgIds.delete(tempId);
          userMsgIds.add(match.info.id);
          userDiv.dataset.msgId = match.info.id;
        }
      } catch {}
    }
    catch (err) {
      removeLoading();
      if (err.message === 'busy') {
        userDiv.remove();
        userMsgIds.delete(tempId);
        // 如果发送失败，合并到队列中
        messageQueue.push(content);
        if (images?.length) queuedImages.push(...images);
        showNotification(`API 忙碌，合并到排队消息 (队列: ${messageQueue.length})`);
        updateQueueButton();
      } else {
        const e = document.createElement('div');
        e.className = 'message assistant';
        e.innerHTML = `<span style="color:var(--danger)">Error: ${esc(err.message)}</span>`;
        messagesEl.appendChild(e);
      }
    }
    finally {
      isStreaming = false;
    }
  }

  // Process message queue - 事件驱动，合并所有排队消息为一条
  async function processMessageQueue() {
    if (messageQueue.length === 0 || isStreaming) return;

    // 合并所有排队消息为一条
    const mergedContent = messageQueue.join('\n---\n');
    const mergedImages = [...queuedImages];
    messageQueue.length = 0;
    queuedImages.length = 0;
    updateQueueButton();

    // 如果合并后内容为空，直接返回
    if (!mergedContent.trim()) return;

    showNotification('正在发送合并消息...');

    // 创建用户消息 div
    const userDiv = document.createElement('div');
    userDiv.className = 'message user';
    const tempId = 'pending-' + Date.now();
    userDiv.dataset.msgId = tempId;
    userMsgIds.add(tempId);
    const textDiv = document.createElement('div');
    const lines = mergedContent.split('\n');
    textDiv.innerHTML = fmt(lines.map(l => `<div>${esc(l)}</div>`).join(''));
    userDiv.appendChild(textDiv);
    if (mergedImages.length) {
      for (const img of mergedImages) {
        const imgEl = document.createElement('img');
        imgEl.src = img.data;
        imgEl.style.maxWidth = '300px';
        imgEl.style.borderRadius = '8px';
        imgEl.style.marginTop = '8px';
        imgEl.addEventListener('click', () => openImageZoom(img.data, img.name));
        userDiv.appendChild(imgEl);
      }
    }

    messagesEl.appendChild(userDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    await doSendMessage(mergedContent, mergedImages, userDiv, tempId);
  }

  // Cancel queued messages
  function cancelQueue() {
    const count = messageQueue.length;
    messageQueue.length = 0;
    queuedImages.length = 0;
    updateQueueButton();
    if (count > 0) {
      showNotification(`已取消 ${count} 条排队消息`);
    }
  }

  // 立即插入：打断当前任务，发送排队消息
  let insertPending = false; // 等待 idle 事件后处理插入
  async function insertQueue() {
    if (messageQueue.length === 0 || !currentSessionId) return;
    showNotification('正在打断当前任务...');
    try {
      // v2 interrupt 被 MiMo Code 禁用，用 v1 abort 代替
      await window.mimo.abortMessage(currentSessionId);
      insertPending = true; // 设置标记，等待 session.idle 事件
      showNotification('已打断，等待任务停止后发送...');
    } catch (err) {
      showNotification('打断失败: ' + err.message);
    }
  }

  // 导出会话为 Markdown
  async function exportSession() {
    if (!currentSessionId) { showNotification('请先选择会话'); return; }
    try {
      const msgs = await window.mimo.getMessages(currentSessionId);
      const list = Array.isArray(msgs) ? msgs : [];
      if (!list.length) { showNotification('会话为空'); return; }

      const title = chatTitle.textContent || '会话';
      const lines = [`# ${title}`, ''];
      for (const m of list) {
        const role = m.info?.role === 'user' ? '**用户**' : '**助手**';
        lines.push(`## ${role}`);
        for (const part of m.parts || []) {
          if (part.type === 'text' && part.text?.trim()) lines.push(part.text.trim());
          else if (part.type === 'reasoning' && part.text?.trim()) lines.push(`> 思考: ${part.text.trim()}`);
          else if (part.type === 'tool' && part.state?.input?.command) lines.push(`\`\`\`\n${part.state.input.command}\n\`\`\``);
        }
        lines.push('');
      }
      const markdown = lines.filter(l => l !== undefined).join('\n');
      await navigator.clipboard.writeText(markdown);
      showNotification('已导出到剪贴板 (' + list.length + ' 条消息)');
    } catch (err) {
      showNotification('导出失败: ' + err.message);
    }
  }

  // Send
  async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content && !pendingImages.length) return;
    if (!content) return;

    // Handle slash commands
    if (content.startsWith('/')) {
      messageInput.value = '';
      executeSlashCommand(content);
      return;
    }

    // Delayed creation: create session on first send
    if (pendingNewChat) {
      try {
        const s = await window.mimo.createSession({});
        if (s?.id) {
          currentSessionId = s.id;
          pendingNewChat = false;
          await loadSessions();
          renderSessionList();
          renderedMsgIds.clear();
          chatTitle.textContent = '新对话';
          startSSE(s.id);
        } else { return; }
      } catch { return; }
    }

    if (!currentSessionId) return;

    messageInput.value = '';
    autoResizeInput();

    // Build message with images
    const images = [...pendingImages];
    pendingImages = [];
    clearImagePreview();

    const userDiv = document.createElement('div');
    userDiv.className = 'message user';
    const tempId = 'pending-' + Date.now();
    userDiv.dataset.msgId = tempId;
    userMsgIds.add(tempId);
    const textDiv = document.createElement('div');
    textDiv.innerHTML = fmt(content);
    userDiv.appendChild(textDiv);
    for (const img of images) {
      const imgEl = document.createElement('img');
      imgEl.src = img.data;
      imgEl.style.maxWidth = '300px';
      imgEl.style.borderRadius = '8px';
      imgEl.style.marginTop = '8px';
      imgEl.style.cursor = 'pointer';
      imgEl.addEventListener('click', () => {
        const w = window.open('', '_blank', 'width=800,height=600');
        if (!w) return;
        const style = w.document.createElement('style');
        style.textContent = 'body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a1a;}img{max-width:95vw;max-height:95vh;object-fit:contain;}';
        w.document.head.appendChild(style);
        const imgEl2 = w.document.createElement('img');
        imgEl2.src = img.data;
        w.document.body.appendChild(imgEl2);
      });
      userDiv.appendChild(imgEl);
    }
    // If already streaming, merge into queue (不创建独立消息 div)
    if (isStreaming) {
      messageQueue.push(content);
      if (images.length > 0) queuedImages.push(...images);
      showNotification(`消息已排队，将合并发送 (队列: ${messageQueue.length})`);
      updateQueueButton();
      return;
    }

    messagesEl.appendChild(userDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    await doSendMessage(content, images, userDiv, tempId);
  }

  // Update queue button visibility
  function updateQueueButton() {
    const queueInfo = $('#queue-info');
    const queueCount = $('#queue-count');
    const queuePreview = $('#queue-preview');
    const insertBtn = $('#btn-insert-queue');
    if (messageQueue.length > 0) {
      queueInfo.classList.remove('hidden');
      queueCount.textContent = messageQueue.length;
      // 预览最新一条排队消息
      const latest = messageQueue[messageQueue.length - 1];
      if (queuePreview && latest) {
        const preview = (typeof latest === 'string' ? latest : latest.content || '').replace(/\s+/g, ' ').trim();
        queuePreview.textContent = preview ? '「' + preview.substring(0, 30) + (preview.length > 30 ? '…' : '') + '」' : '';
        queuePreview.title = messageQueue.map(m => (typeof m === 'string' ? m : m.content || '')).join('\n---\n');
      }
      // 更新按钮提示
      if (insertBtn) insertBtn.title = '打断当前任务，立即发送 ' + messageQueue.length + ' 条排队消息';
    } else {
      queueInfo.classList.add('hidden');
      if (queuePreview) { queuePreview.textContent = ''; queuePreview.title = ''; }
    }
  }

  function removeLoading() { if (loadingEl?.parentNode) loadingEl.parentNode.removeChild(loadingEl); loadingEl = null; }

  // Config
  async function loadConfig() {
    try {
      config = await window.mimo.getConfig();
      if (config.model) {
        const name = config.model.replace('xiaomi/', '').replace('mimo-', 'MiMo ').replace('-pro', '').toUpperCase().replace('V2.5', '2.5');
        $('#chat-status').textContent = `Model: ${name}`;
        // Set model selector value
        const selector = $('#model-selector');
        if (selector && selector.options.length > 0) {
          // Find matching option
          for (let i = 0; i < selector.options.length; i++) {
            if (selector.options[i].value === config.model) {
              selector.selectedIndex = i;
              break;
            }
          }
        }
      }
      // Populate model selector from config if available, or use defaults
      const selector = $('#model-selector');
      if (selector) {
        selector.innerHTML = '';
        const models = config.models && Array.isArray(config.models) ? config.models : [
          { id: 'xiaomi/mimo-v2-pro', name: 'MiMo V2 Pro' },
          { id: 'xiaomi/mimo-v2-flash', name: 'MiMo V2 Flash' },
          { id: 'xiaomi/mimo-v2-lite', name: 'MiMo V2 Lite' },
        ];
        models.forEach(model => {
          const option = document.createElement('option');
          option.value = model.id || model;
          option.textContent = model.name || model.id || model;
          selector.appendChild(option);
        });
        // Select current model
        if (config.model) {
          selector.value = config.model;
          // If current model not in list, add it
          if (selector.value !== config.model) {
            const option = document.createElement('option');
            option.value = config.model;
            option.textContent = config.model;
            selector.appendChild(option);
            selector.value = config.model;
          }
        }
      }
    } catch {}
  }

  // Settings
  function applySettings() {
    const title = localStorage.getItem('mimo-app-title') || 'MiMo Code - Max';
    const theme = localStorage.getItem('mimo-theme') || 'light';
    const fontSize = localStorage.getItem('mimo-font-size') || '14';
    const msgWidth = localStorage.getItem('mimo-msg-width') || '80';
    const bgImage = localStorage.getItem('mimo-bg-image') || '';
    const customCss = localStorage.getItem('mimo-custom-css') || '';

    // 启动时同步保存的端口到 main 进程
    const savedPort = parseInt(localStorage.getItem('mimo-server-port')) || 4096;
    if ($('#setting-server-port')) {
      $('#setting-server-port').value = savedPort;
    }
    window.mimo.updateServerConfig({ port: savedPort }).catch(() => {});

    $('#titlebar-title').textContent = title;
    document.title = title;
    document.body.className = theme === 'dark' ? 'theme-dark' : '';

    // Apply font size
    document.documentElement.style.setProperty('--msg-font-size', fontSize + 'px');

    // Apply message width
    document.documentElement.style.setProperty('--msg-max-width', msgWidth + '%');

    // Apply background image
    if (bgImage) {
      document.body.style.backgroundImage = `url(${bgImage})`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
    } else {
      document.body.style.backgroundImage = '';
    }

    // Apply custom CSS
    let styleEl = document.getElementById('custom-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'custom-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = customCss;

    // Server settings
    const serverPort = localStorage.getItem('mimo-server-port') || '4096';
    const autoStartServer = localStorage.getItem('mimo-auto-start-server') !== 'false';
    const serverPortEl = $('#setting-server-port');
    const autoStartEl = $('#setting-auto-start-server');
    if (serverPortEl) serverPortEl.value = serverPort;
    if (autoStartEl) autoStartEl.checked = autoStartServer;

    // Version info from package.json
    const versionEl = document.getElementById('app-version');
    if (versionEl) versionEl.textContent = 'v1.0.0';
  }

  // Slash commands
  const slashCommands = [
    { name: '/help', description: '显示帮助' },
    { name: '/clear', description: '清空当前对话' },
    { name: '/model', description: '切换模型' },
    { name: '/agent', description: '切换代理模式' },
    { name: '/compact', description: '压缩对话' },
    { name: '/export', description: '导出对话' },
    { name: '/debug', description: '切换调试模式' },
    { name: '/parallel', description: '并行执行任务' },
    { name: '/tdd', description: '测试驱动开发' },
    { name: '/review', description: '代码审查' },
    { name: '/merge', description: '合并工作' },
  ];

  let commandPickerVisible = false;
  let commandPicker = null;

  function handleSlashCommand(input) {
    if (!commandPicker) {
      commandPicker = document.createElement('div');
      commandPicker.id = 'command-picker';
      commandPicker.className = 'command-picker hidden';
      document.getElementById('input-area').appendChild(commandPicker);
    }

    if (input.startsWith('/') && input.length > 0) {
      const query = input.toLowerCase();
      const filtered = slashCommands.filter(cmd =>
        cmd.name.toLowerCase().startsWith(query)
      );

      if (filtered.length > 0) {
        commandPicker.innerHTML = filtered.map(cmd =>
          `<div class="command-item" data-command="${cmd.name}">
            <span class="command-name">${cmd.name}</span>
            <span class="command-desc">${cmd.description}</span>
          </div>`
        ).join('');
        commandPicker.classList.remove('hidden');
        commandPickerVisible = true;

        // Add click handlers
        commandPicker.querySelectorAll('.command-item').forEach(item => {
          item.addEventListener('click', () => {
            messageInput.value = item.dataset.command + ' ';
            commandPicker.classList.add('hidden');
            commandPickerVisible = false;
            messageInput.focus();
          });
        });
        return;
      }
    }

    commandPicker.classList.add('hidden');
    commandPickerVisible = false;
  }

  function executeSlashCommand(command) {
    const cmd = command.trim().toLowerCase();

    switch (cmd) {
      case '/help':
        showNotification('Commands: /help, /clear, /model, /agent, /compact, /export, /debug');
        break;
      case '/clear':
        messagesEl.innerHTML = '<div class="empty-state"><div class="icon">&#x1F4AC;</div><div class="text">开始新对话</div></div>';
        renderedMsgIds.clear();
        break;
      case '/debug':
        const syncStatus = document.getElementById('sync-status');
        if (syncStatus) syncStatus.style.display = syncStatus.style.display === 'none' ? '' : 'none';
        break;
      default:
        showNotification(`Unknown command: ${cmd}`);
    }
  }

  function showNotification(message) {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
  }

  // Events
  function setupEventListeners() {
    $('#btn-new-chat').addEventListener('click', async () => {
      // Delayed creation: just clear UI, create on send
      pendingNewChat = true;
      currentSessionId = null;
      renderedMsgIds.clear();
      chatTitle.textContent = '新对话';
      messagesEl.innerHTML = '<div class="empty-state"><div class="icon">&#x1F4AC;</div><div class="text">输入消息开始新对话</div></div>';
      renderSessionList();
      messageInput.focus();
    });
    btnSend.addEventListener('click', sendMessage);
    btnStop.addEventListener('click', stopGeneration);
    $('#btn-cancel-queue').addEventListener('click', cancelQueue);
    $('#btn-insert-queue').addEventListener('click', insertQueue);
    $('#btn-export').addEventListener('click', exportSession);
    messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    messageInput.addEventListener('input', () => {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
      handleSlashCommand(messageInput.value);
    });
    messageInput.addEventListener('paste', handlePaste);
    document.addEventListener('drop', (e) => { e.preventDefault(); handleImageFiles(e.dataTransfer.files); });
    document.addEventListener('dragover', (e) => e.preventDefault());

    // Ctrl+A to select within a single block (thinking, code, etc.)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'a') {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;

        // Check if we're inside a thinking block, code block, tool detail, or message text
        const block = container.nodeType === 3 ? container.parentElement : container;
        const thinkingBlock = block.closest('.thinking-content');
        const codeBlock = block.closest('pre code') || block.closest('pre');
        const toolDetail = block.closest('.tool-detail');
        const msgText = block.closest('.msg-text');

        // Only handle if we're inside a specific block, not the whole document
        if (thinkingBlock || codeBlock || toolDetail || msgText) {
          e.preventDefault();
          e.stopPropagation();
          const target = thinkingBlock || codeBlock || toolDetail || msgText;
          const newRange = document.createRange();
          newRange.selectNodeContents(target);
          selection.removeAllRanges();
          selection.addRange(newRange);
          return false;
        }
      }
    });

    $('#btn-minimize').addEventListener('click', () => window.mimo.minimize());
    $('#btn-maximize').addEventListener('click', () => window.mimo.maximize());
    $('#btn-close').addEventListener('click', () => window.mimo.close());

    // Title editing (double-click to edit)
    chatTitle.addEventListener('dblclick', () => {
      if (!currentSessionId) return;
      const currentTitle = chatTitle.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentTitle;
      input.className = 'title-edit-input';
      chatTitle.replaceWith(input);
      input.focus();
      input.select();

      const saveTitle = async () => {
        const newTitle = input.value.trim() || currentTitle;
        chatTitle.textContent = newTitle;
        input.replaceWith(chatTitle);
        if (newTitle !== currentTitle) {
          try {
            await window.mimo.updateSession(currentSessionId, { title: newTitle });
            // Update session in local list
            const session = sessions.find(s => s.id === currentSessionId);
            if (session) session.title = newTitle;
            renderSessionList();
          } catch {}
        }
      };

      input.addEventListener('blur', saveTitle);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveTitle();
        else if (e.key === 'Escape') { chatTitle.textContent = currentTitle; input.replaceWith(chatTitle); }
      });
    });

    // Model selector
    const modelSelector = $('#model-selector');
    if (modelSelector) {
      modelSelector.addEventListener('change', async () => {
        const model = modelSelector.value;
        try {
          // Update config with new model
          await window.mimo.updateSession(currentSessionId, { model });
          // Update status display
          const name = model.replace('mimo-', 'MiMo ').replace('-pro', '').replace('-flash', '').replace('-lite', '').toUpperCase().replace('V2.5', '2.5');
          $('#chat-status').textContent = `Model: ${name}`;
        } catch {}
      });
    }

    // Settings panel
    const settingsPanel = $('#settings-panel');
    const btnSettings = $('#btn-settings');
    const btnSave = $('#btn-save-settings');
    const btnClose = $('#btn-close-settings');

    // Settings tab navigation
    document.querySelectorAll('.settings-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        // Remove active from all nav items and tabs
        document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        // Add active to clicked nav item and corresponding tab
        item.classList.add('active');
        const tabId = 'tab-' + item.dataset.tab;
        const tab = document.getElementById(tabId);
        if (tab) tab.classList.add('active');
      });
    });

    btnSettings.addEventListener('click', async () => {
      // Load current server URL
      try {
        const url = await window.mimo.getServerUrl();
        $('#setting-server-url').value = url || 'http://127.0.0.1:4096';
      } catch {}
      // Load saved settings
      $('#setting-app-title').value = localStorage.getItem('mimo-app-title') || 'MiMo Code - Max';
      $('#setting-theme').value = localStorage.getItem('mimo-theme') || 'light';
      $('#setting-font-size').value = localStorage.getItem('mimo-font-size') || '14';
      $('#setting-msg-width').value = localStorage.getItem('mimo-msg-width') || '80';
      $('#setting-show-timestamps').checked = localStorage.getItem('mimo-show-timestamps') !== 'false';
      $('#setting-bg-image').value = localStorage.getItem('mimo-bg-image') || '';
      $('#setting-logo-image').value = localStorage.getItem('mimo-logo-image') || '';
      $('#setting-custom-css').value = localStorage.getItem('mimo-custom-css') || '';
      settingsPanel.classList.remove('hidden');
    });

    btnSave.addEventListener('click', async () => {
      const serverUrl = $('#setting-server-url').value.trim();
      const serverPort = parseInt($('#setting-server-port').value) || 4096;
      const appTitle = $('#setting-app-title').value.trim() || 'MiMo Code - Max';
      const theme = $('#setting-theme').value;
      const fontSize = $('#setting-font-size').value;
      const msgWidth = $('#setting-msg-width').value;
      const showTimestamps = $('#setting-show-timestamps').checked;
      const bgImage = $('#setting-bg-image').value.trim();
      const logoImage = $('#setting-logo-image').value.trim();
      const customCss = $('#setting-custom-css').value;

      // 同步端口到 main 进程
      if (serverPort) {
        await window.mimo.updateServerConfig({ port: serverPort });
      }
      if (serverUrl) {
        await window.mimo.setServerUrl(serverUrl);
      }
      localStorage.setItem('mimo-app-title', appTitle);
      localStorage.setItem('mimo-theme', theme);
      localStorage.setItem('mimo-font-size', fontSize);
      localStorage.setItem('mimo-msg-width', msgWidth);
      localStorage.setItem('mimo-show-timestamps', showTimestamps.toString());
      localStorage.setItem('mimo-bg-image', bgImage);
      localStorage.setItem('mimo-logo-image', logoImage);
      localStorage.setItem('mimo-custom-css', customCss);
      localStorage.setItem('mimo-server-port', serverPort.toString());
      localStorage.setItem('mimo-auto-start-server', $('#setting-auto-start-server').checked.toString());

      applySettings();
      settingsPanel.classList.add('hidden');
      // Reload sessions with new server
      await loadSessions();
    });

    btnClose.addEventListener('click', () => {
      settingsPanel.classList.add('hidden');
    });

    // Log viewer
    const btnViewLogs = $('#btn-view-logs');
    const logViewer = $('#log-viewer');
    const logContent = $('#log-content');

    if (btnViewLogs) {
      btnViewLogs.addEventListener('click', async () => {
        if (logViewer.classList.contains('hidden')) {
          // Show loading state
          btnViewLogs.textContent = '加载中...';
          btnViewLogs.disabled = true;
          logContent.value = '加载日志中...';
          logViewer.classList.remove('hidden');

          // Load logs asynchronously
          try {
            const logs = await window.mimo.getLogs();
            logContent.value = logs || 'No logs available';
          } catch {
            logContent.value = 'Failed to load logs';
          }
          btnViewLogs.textContent = '隐藏日志';
          btnViewLogs.disabled = false;
        } else {
          logViewer.classList.add('hidden');
          btnViewLogs.textContent = '查看日志';
        }
      });
    }
  }

  function autoScroll() {
    // Always scroll during streaming, otherwise only if near bottom
    if (isStreaming || messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100) {
      messagesEl.scrollTo({
        top: messagesEl.scrollHeight,
        behavior: isStreaming ? 'smooth' : 'auto'
      });
    }
  }

  // Check connection status
  async function checkConnection() {
    const statusEl = $('#connection-status');
    if (!statusEl) return;
    try {
      await window.mimo.getSessions();
      statusEl.textContent = '已连接';
      statusEl.className = 'status-connected';
    } catch {
      statusEl.textContent = '未连接';
      statusEl.className = 'status-disconnected';
    }
  }

  // Check connection periodically
  setInterval(checkConnection, 30000);

  function autoResizeInput() { messageInput.style.height = 'auto'; messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px'; }
  function formatTime(ts) { const d = new Date(ts); return Date.now() - d < 86400000 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // Filter out system-level tags that shouldn't be displayed
  function fmt(s) {
    if (typeof s !== 'string') s = String(s);
    // Remove system-reminder blocks
    s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
    // Remove skill_content blocks
    s = s.replace(/<skill_content[\s\S]*?>[\s\S]*?<\/skill_content>/g, '');
    // Remove any remaining system-level XML tags
    s = s.replace(/<(?:system-reminder|skill_content|instructions|context|env)[^>]*>[\s\S]*?<\/(?:system-reminder|skill_content|instructions|context|env)>/g, '');
    let h = esc(s);
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/\n/g, '<br>');
    return h;
  }

  // Copy message functionality
  function handleCopyMessage(e) {
    const btn = e.currentTarget;
    const originalText = btn.dataset.originalText;
    if (!originalText) return;

    // Copy plain text to clipboard
    navigator.clipboard.writeText(originalText).then(() => {
      // Show feedback
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '&#x2714;';
      btn.style.color = 'var(--success)';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.style.color = '';
      }, 1500);
    }).catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = originalText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '&#x2714;';
        btn.style.color = 'var(--success)';
        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.style.color = '';
        }, 1500);
      } catch {}
      document.body.removeChild(textarea);
    });
  }

  // Image paste / drag-drop
  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImagePreview(file);
        break;
      }
    }
  }

  function handleImageFiles(files) {
    for (const file of files) {
      if (file.type.startsWith('image/')) addImagePreview(file);
    }
  }

  function addImagePreview(file) {
    const reader = new FileReader();
    reader.onload = () => {
      pendingImages.push({ name: file.name, data: reader.result, mime: file.type || 'image/png' });
      renderImagePreviews();
    };
    reader.readAsDataURL(file);
  }

  function renderImagePreviews() {
    let previewArea = document.getElementById('image-preview-area');
    if (!previewArea) {
      previewArea = document.createElement('div');
      previewArea.id = 'image-preview-area';
      document.getElementById('input-wrapper').before(previewArea);
    }
    previewArea.innerHTML = '';
    if (!pendingImages.length) { previewArea.style.display = 'none'; return; }
    previewArea.style.display = 'flex';
    pendingImages.forEach((img, i) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'image-preview-item';
      const imgEl = document.createElement('img');
      imgEl.src = img.data;
      imgEl.style.cursor = 'pointer';
      imgEl.addEventListener('click', () => openImageZoom(img.data, img.name));
      const removeBtn = document.createElement('button');
      removeBtn.className = 'image-preview-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = (e) => { e.stopPropagation(); pendingImages.splice(i, 1); renderImagePreviews(); };
      wrapper.appendChild(imgEl);
      wrapper.appendChild(removeBtn);
      previewArea.appendChild(wrapper);
    });
  }

  function clearImagePreview() {
    pendingImages = [];
    const previewArea = document.getElementById('image-preview-area');
    if (previewArea) { previewArea.innerHTML = ''; previewArea.style.display = 'none'; }
  }

  // Image zoom modal with scroll scaling
  function openImageZoom(src, name) {
    const modal = document.createElement('div');
    modal.className = 'image-zoom-modal';
    modal.innerHTML = `
      <div class="image-zoom-overlay"></div>
      <div class="image-zoom-content">
        <button class="image-zoom-close">&times;</button>
        <div class="image-zoom-container">
          <img src="${src}" alt="${name || 'image'}" class="image-zoom-img">
        </div>
        <div class="image-zoom-controls">
          <button class="image-zoom-btn" data-action="zoom-in">+</button>
          <button class="image-zoom-btn" data-action="zoom-out">-</button>
          <button class="image-zoom-btn" data-action="zoom-reset">1:1</button>
          <span class="image-zoom-level">100%</span>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const img = modal.querySelector('.image-zoom-img');
    const level = modal.querySelector('.image-zoom-level');
    let scale = 1;
    let isDragging = false;
    let startX, startY, translateX = 0, translateY = 0;

    function updateTransform() {
      img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      level.textContent = Math.round(scale * 100) + '%';
    }

    // Auto-scale image to fit viewport
    img.onload = () => {
      const viewportWidth = window.innerWidth * 0.8;
      const viewportHeight = window.innerHeight * 0.8;
      const imgWidth = img.naturalWidth;
      const imgHeight = img.naturalHeight;
      const scaleWidth = viewportWidth / imgWidth;
      const scaleHeight = viewportHeight / imgHeight;
      scale = Math.min(scaleWidth, scaleHeight, 1); // Don't scale up beyond 100%
      updateTransform();
    };

    // Zoom with scroll
    modal.querySelector('.image-zoom-container').addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      scale = Math.max(0.1, Math.min(10, scale + delta));
      updateTransform();
    });

    // Zoom buttons
    modal.querySelectorAll('.image-zoom-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'zoom-in') scale = Math.min(10, scale + 0.25);
        else if (action === 'zoom-out') scale = Math.max(0.1, scale - 0.25);
        else if (action === 'zoom-reset') { scale = 1; translateX = 0; translateY = 0; }
        updateTransform();
      });
    });

    // Drag to pan
    img.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
      img.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
      updateTransform();
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      img.style.cursor = 'grab';
    });

    // Close
    modal.querySelector('.image-zoom-overlay').addEventListener('click', () => modal.remove());
    modal.querySelector('.image-zoom-close').addEventListener('click', () => modal.remove());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') modal.remove();
    });
  }

  init();
})();
