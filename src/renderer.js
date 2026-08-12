(() => {
  let sessions = [];
  let currentSessionId = null;
  let currentAgent = 'compose';
  let config = {};
  let isStreaming = false;
  let renderedMsgIds = new Set();
  let messageCache = {};
  let fetchDebounce = null;
  let loadingEl = null;
  let pendingNewChat = false;
  let pendingImages = [];
  let streamingFetchTimer = null;
  const userMsgIds = new Set(); // Track client-sent message IDs to prevent SSE duplicates

  const $ = (s) => document.querySelector(s);
  const sessionList = $('#session-list');
  const chatTitle = $('#chat-title');
  const messagesEl = $('#messages');
  const messageInput = $('#message-input');
  const btnSend = $('#btn-send');

  async function init() {
    await loadSessions();
    await loadConfig();
    setupEventListeners();
    setupSSEListeners();
    applySettings();
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
    for (const part of msg.parts) {
      switch (part.type) {
        case 'text': if (part.text?.trim()) { const d = document.createElement('div'); d.className = 'msg-text'; d.innerHTML = fmt(part.text); container.appendChild(d); } break;
        case 'reasoning': if (part.text?.trim()) container.appendChild(createThinking(part.text, false)); break;
        case 'tool': container.appendChild(createTool(part)); break;
        case 'file': { container.appendChild(createFilePart(part)); } break;
      }
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
      img.addEventListener('click', () => {
        const w = window.open('', '_blank', 'width=800,height=600');
        if (!w) return;
        const style = w.document.createElement('style');
        style.textContent = 'body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a1a;}img{max-width:95vw;max-height:95vh;object-fit:contain;}';
        w.document.head.appendChild(style);
        w.document.title = part.filename || 'image';
        const imgEl = w.document.createElement('img');
        imgEl.src = part.url;
        w.document.body.appendChild(imgEl);
      });
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
      const syncStatus = document.getElementById('sync-status');

      // Render directly from SSE event data
      const part = event.part;
      const info = event.info;
      const messageID = event.messageID || part?.messageID;

      console.log('[SSE-EVENT] msgID:', messageID, 'role:', info?.role, 'partType:', part?.type, 'existing:', !!messagesEl.querySelector(`[data-msg-id="${messageID}"]`));

      if (part && messageID) {
        renderPartFromEvent(messageID, info, part);
        autoScroll();
        if (syncStatus) syncStatus.textContent = '实时同步';
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
      messagesEl.querySelectorAll('.thinking.streaming').forEach(el => el.classList.remove('streaming'));
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
            // Adopt pending userDiv if it lacks data-msg-id
            if (id) {
              const pending = messagesEl.querySelector('.message.user:not([data-msg-id])');
              if (pending) { pending.dataset.msgId = id; renderedMsgIds.add(id); }
            }
            continue;
          }
          if (messagesEl.querySelector(`[data-msg-id="${id}"]`)) continue; // already in DOM
          const container = document.createElement('div');
          container.className = `message ${role}`;
          container.dataset.msgId = id;
          for (const part of m.parts || []) {
            if (part.type === 'text' && part.text?.trim()) { const d = document.createElement('div'); d.className = 'msg-text'; d.innerHTML = fmt(part.text); container.appendChild(d); }
            else if (part.type === 'reasoning' && part.text?.trim()) container.appendChild(createThinking(part.text, false));
            else if (part.type === 'tool') container.appendChild(createTool(part));
            else if (part.type === 'file') container.appendChild(createFilePart(part));
          }
          if (container.children.length) messagesEl.appendChild(container);
        }
        autoScroll();
      } catch {}
      const syncStatus = document.getElementById('sync-status');
      if (syncStatus) syncStatus.textContent = '回复完成';
    });
  }

  // Render a single part from SSE event directly into DOM
  function renderPartFromEvent(messageID, info, part) {
    // Skip if this is a client-sent user message
    if (userMsgIds.has(messageID)) return;

    // Find existing message container by messageID
    let container = messagesEl.querySelector(`[data-msg-id="${messageID}"]`);

    if (!container) {
      // Check if there's a pending user message (no data-msg-id yet) — adopt it
      const pending = messagesEl.querySelector('.message.user:not([data-msg-id])');
      if (pending) {
        pending.dataset.msgId = messageID;
        renderedMsgIds.add(messageID);
        userMsgIds.add(messageID);
        return;
      }
      // Skip user messages explicitly marked
      if (info?.role === 'user') return;
      // Create container for new messages (assistant or unknown role)
      const role = info?.role || 'assistant';
      container = document.createElement('div');
      container.className = `message ${role}`;
      container.dataset.msgId = messageID;
      messagesEl.appendChild(container);
      renderedMsgIds.add(messageID);
    }

    // Skip step-start/step-finish
    if (part.type === 'step-start' || part.type === 'step-finish') return;

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
      el.innerHTML = fmt(part.text);
    } else if (part.type === 'reasoning') {
      // Update thinking content if text arrived
      if (part.text) {
        const content = el.querySelector('.thinking-content');
        if (content) content.innerHTML = fmt(part.text);
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

  // Periodic fetch during streaming — updates existing messages (断点续传)
  function startStreamingFetch() {
    stopStreamingFetch();
    const mySessionId = currentSessionId;
    streamingFetchTimer = setInterval(async () => {
      if (!currentSessionId || currentSessionId !== mySessionId) { stopStreamingFetch(); return; }
      try {
        const msgs = await window.mimo.getMessages(mySessionId);
        const list = Array.isArray(msgs) ? msgs : [];
        messageCache[mySessionId] = list;
        // Update existing message elements, don't re-render all
        for (const m of list) {
          const id = m.info?.id || '';
          const role = m.info?.role || 'assistant';
          // Skip user messages — already rendered client-side
          if (role === 'user' || userMsgIds.has(id)) {
            // But adopt pending userDiv if it lacks data-msg-id
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
            } else if (part.type === 'text' && part.text?.trim()) {
              // New text part arrived — append
              const div = document.createElement('div');
              div.className = 'msg-text';
              div.dataset.partKey = partKey;
              div.innerHTML = fmt(part.text);
              container.appendChild(div);
            } else if (part.type === 'reasoning') {
              if (existing) {
                // Update existing thinking — fill in content if arrived
                if (part.text?.trim()) updatePartElement(existing, part);
              } else {
                // No existing thinking block — create one (even if empty, to show progress)
                const thinking = createThinking(part.text || '', true);
                thinking.dataset.partKey = partKey;
                container.appendChild(thinking);
              }
            }
          }
        }
        autoScroll();
      } catch {}
    }, 3000);
  }

  function stopStreamingFetch() {
    if (streamingFetchTimer) { clearInterval(streamingFetchTimer); streamingFetchTimer = null; }
  }

  // Send
  async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content && !pendingImages.length) return;
    if (isStreaming) return;
    if (!content) return;

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
    messagesEl.appendChild(userDiv);

    loadingEl = document.createElement('div');
    loadingEl.className = 'message assistant loading-indicator';
    loadingEl.innerHTML = '<div class="loading"><div class="spinner"></div>Thinking...</div>';
    messagesEl.appendChild(loadingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    isStreaming = true;
    btnSend.disabled = true;
    delete messageCache[currentSessionId];
    startStreamingFetch();
    try {
      await window.mimo.sendMessage(currentSessionId, content, currentAgent, images.map(i => ({ data: i.data, mime: i.mime })));
      // Fetch real message ID and update — match by position (N-th pending = N-th user msg)
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
    catch (err) { removeLoading(); const e = document.createElement('div'); e.className = 'message assistant'; e.innerHTML = `<span style="color:var(--danger)">Error: ${esc(err.message)}</span>`; messagesEl.appendChild(e); }
    finally { isStreaming = false; btnSend.disabled = false; }
  }

  function removeLoading() { if (loadingEl?.parentNode) loadingEl.parentNode.removeChild(loadingEl); loadingEl = null; }

  // Config
  async function loadConfig() {
    try {
      config = await window.mimo.getConfig();
      if (config.model) {
        const name = config.model.replace('xiaomi/', '').replace('mimo-', 'MiMo ').replace('-pro', '').toUpperCase().replace('V2.5', '2.5');
        $('#chat-status').textContent = `Model: ${name}`;
      }
    } catch {}
  }

  // Settings
  function applySettings() {
    const title = localStorage.getItem('mimo-app-title') || 'MiMo Code - Max';
    const theme = localStorage.getItem('mimo-theme') || 'light';
    $('#titlebar-title').textContent = title;
    document.title = title;
    document.body.className = theme === 'dark' ? 'theme-dark' : '';
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
    messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    messageInput.addEventListener('input', () => { messageInput.style.height = 'auto'; messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px'; });
    messageInput.addEventListener('paste', handlePaste);
    document.addEventListener('drop', (e) => { e.preventDefault(); handleImageFiles(e.dataTransfer.files); });
    document.addEventListener('dragover', (e) => e.preventDefault());
    $('#btn-minimize').addEventListener('click', () => window.mimo.minimize());
    $('#btn-maximize').addEventListener('click', () => window.mimo.maximize());
    $('#btn-close').addEventListener('click', () => window.mimo.close());
  }

  function autoScroll() { const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100; if (atBottom) messagesEl.scrollTop = messagesEl.scrollHeight; }
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
      const removeBtn = document.createElement('button');
      removeBtn.className = 'image-preview-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = () => { pendingImages.splice(i, 1); renderImagePreviews(); };
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

  init();
})();
