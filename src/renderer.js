(() => {
  // ---------- State ----------
  let sessions = [];
  let currentSessionId = null;
  let currentAgent = 'compose';
  let config = {};
  let isStreaming = false;
  let refreshTimer = null;
  let renderedMsgIds = new Set();

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const sessionList = $('#session-list');
  const chatTitle = $('#chat-title');
  const chatStatus = $('#chat-status');
  const messagesEl = $('#messages');
  const messageInput = $('#message-input');
  const btnSend = $('#btn-send');
  const btnNewChat = $('#btn-new-chat');
  const btnSettings = $('#btn-settings');
  const settingsPanel = $('#settings-panel');
  const btnSaveSettings = $('#btn-save-settings');
  const btnCloseSettings = $('#btn-close-settings');

  // ---------- Init ----------
  async function init() {
    await loadSessions();
    await loadConfig();
    setupEventListeners();
    setupTitlebar();
    applySettings();
    startAutoRefresh();
  }

  // ---------- Sessions ----------
  async function loadSessions() {
    try {
      sessions = await window.mimo.getSessions();
      renderSessionList();
    } catch {
      sessionList.innerHTML = '<div class="empty-state"><div class="text">Cannot connect to server</div></div>';
    }
  }

  function renderSessionList() {
    const filtered = sessions.filter(s => !s.title?.toLowerCase().includes('checkpoint'));
    if (!filtered.length) {
      sessionList.innerHTML = '<div class="empty-state"><div class="text">No conversations yet</div></div>';
      return;
    }
    sessionList.innerHTML = filtered.map(s => {
      const time = s.time?.updated ? formatTime(s.time.updated) : '';
      const active = s.id === currentSessionId ? ' active' : '';
      return `<div class="session-item${active}" data-id="${s.id}">
        <div class="title">${escapeHtml(s.title || 'Untitled')}</div>
        <div class="time">${time}</div>
      </div>`;
    }).join('');
    sessionList.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => selectSession(el.dataset.id));
    });
  }

  async function selectSession(id) {
    currentSessionId = id;
    renderedMsgIds.clear();
    const session = sessions.find(s => s.id === id);
    chatTitle.textContent = session?.title || 'Untitled';
    renderSessionList();
    if (refreshTimer) clearInterval(refreshTimer);
    // 重置同步状态，从头开始同步
    await window.mimo.resetSync(id);
    await loadMessages(id);
    startAutoRefresh();
  }

  // ---------- Messages ----------
  async function loadMessages(sessionId) {
    messagesEl.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
    try {
      const data = await window.mimo.getMessages(sessionId);
      const list = Array.isArray(data) ? data : [];
      const lastUserMsg = list.filter(m => m.info?.role === 'user').pop();
      if (lastUserMsg?.info?.agent) currentAgent = lastUserMsg.info.agent;
      renderMessages(list, false);
    } catch {
      messagesEl.innerHTML = '<div class="empty-state"><div class="text">Failed to load</div></div>';
    }
  }

  function renderMessages(msgs, incremental = false) {
    if (!msgs.length) {
      messagesEl.innerHTML = '<div class="empty-state"><div class="icon">&#x1F4AC;</div><div class="text">Start a conversation</div></div>';
      renderedMsgIds.clear();
      return;
    }
    if (!incremental) {
      const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
      messagesEl.innerHTML = '';
      renderedMsgIds.clear();
      for (const m of msgs) {
        const msgId = m.info?.id || '';
        if (renderedMsgIds.has(msgId)) continue;
        renderedMsgIds.add(msgId);
        renderMessageParts(m);
      }
      if (wasAtBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    } else {
      for (const m of msgs) {
        const msgId = m.info?.id || '';
        if (renderedMsgIds.has(msgId)) continue;
        renderedMsgIds.add(msgId);
        renderMessageParts(m);
      }
      autoScroll(true);
    }
  }

  function renderMessageParts(msg) {
    const role = msg.info?.role || 'assistant';
    if (!msg.parts || !Array.isArray(msg.parts)) {
      console.log('[Render] Skipping message with no parts:', msg.info?.id);
      return;
    }

    const container = document.createElement('div');
    container.className = `message ${role}`;

    for (const part of msg.parts) {
      switch (part.type) {
        case 'text':
          if (part.text?.trim()) {
            const textDiv = document.createElement('div');
            textDiv.className = 'msg-text';
            textDiv.innerHTML = formatContent(part.text);
            container.appendChild(textDiv);
          }
          break;
        case 'reasoning':
          if (part.text?.trim()) {
            container.appendChild(createThinking(part.text));
          }
          break;
        case 'tool':
          container.appendChild(createTool(part));
          break;
        case 'file':
          container.appendChild(createFile(part));
          break;
        case 'step-start':
        case 'step-finish':
          // 跳过步骤标记，不创建DOM元素
          break;
        default:
          console.log('[Render] Unknown part type:', part.type);
      }
    }

    if (container.children.length > 0) {
      console.log('[Render] Appending message:', msg.info?.id, 'role:', role, 'children:', container.children.length);
      messagesEl.appendChild(container);
    } else {
      console.log('[Render] Container empty, not appending:', msg.info?.id);
    }
  }

  // ---------- Thinking ----------
  function createThinking(text) {
    const details = document.createElement('details');
    details.className = 'thinking';
    const summary = document.createElement('summary');
    summary.textContent = 'Thinking...';
    const content = document.createElement('div');
    content.className = 'thinking-content';
    content.innerHTML = formatContent(text);
    details.appendChild(summary);
    details.appendChild(content);
    // Auto-collapse after a delay (simulates "Thought")
    setTimeout(() => {
      if (details.open) {
        summary.textContent = 'Thought';
      }
    }, 500);
    details.addEventListener('toggle', () => {
      if (!details.open) summary.textContent = 'Thought';
      else summary.textContent = 'Thinking...';
    });
    return details;
  }

  // ---------- Tool ----------
  function createTool(part) {
    const tool = part.tool || 'unknown';
    const state = part.state || {};
    const status = state.status || 'pending';

    const wrapper = document.createElement('details');
    wrapper.className = 'tool-call';

    // Summary line: compact single line
    const summary = document.createElement('summary');
    const statusIcon = status === 'completed' ? '&#x2705;' : status === 'error' ? '&#x274C;' : '&#x23F3;';
    const icons = { read: '&#x1F4C4;', edit: '&#x270F;', write: '&#x1F4DD;', bash: '&#x1F4BB;', glob: '&#x1F4C1;', grep: '&#x1F50D;' };
    const icon = icons[tool] || '&#x1F527;';

    let preview = '';
    if (state.input) {
      const input = state.input;
      if (input.file_path) preview = input.file_path.split('\\').pop().split('/').pop();
      else if (input.command) preview = input.command.substring(0, 60);
      else if (input.pattern) preview = input.pattern;
    }

    summary.innerHTML = `${statusIcon} ${icon} <strong>${tool}</strong>${preview ? ' ' + escapeHtml(preview) : ''}`;
    wrapper.appendChild(summary);

    // Detail content
    const detail = document.createElement('div');
    detail.className = 'tool-detail';

    if (state.input?.command) {
      const cmdPre = document.createElement('pre');
      cmdPre.className = 'tool-cmd';
      cmdPre.textContent = state.input.command;
      detail.appendChild(cmdPre);
    }

    if (state.output) {
      const output = typeof state.output === 'string' ? state.output : JSON.stringify(state.output, null, 2);
      const outPre = document.createElement('pre');
      outPre.className = 'tool-output';
      outPre.textContent = output.substring(0, 3000);
      detail.appendChild(outPre);
    }

    if (state.input?.new_string && state.input?.old_string) {
      const diffDiv = document.createElement('div');
      diffDiv.className = 'tool-diff';
      diffDiv.innerHTML = `<div class="diff-remove">- ${escapeHtml(state.input.old_string.substring(0, 200))}</div><div class="diff-add">+ ${escapeHtml(state.input.new_string.substring(0, 200))}</div>`;
      detail.appendChild(diffDiv);
    }

    if (detail.children.length > 0) wrapper.appendChild(detail);
    return wrapper;
  }

  // ---------- File ----------
  function createFile(part) {
    const div = document.createElement('div');
    div.className = 'file-attachment';
    if (part.mime?.startsWith('image/') && part.url) {
      const img = document.createElement('img');
      img.src = part.url;
      img.alt = part.filename || '';
      img.style.maxWidth = '400px';
      img.style.borderRadius = '8px';
      div.appendChild(img);
    } else {
      div.textContent = `📎 ${part.filename || 'file'}`;
    }
    return div;
  }

  // ---------- Auto-refresh (lightweight polling) ----------
  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    let lastMsgId = '';
    let pollCount = 0;
    const syncStatus = document.getElementById('sync-status');
    refreshTimer = setInterval(async () => {
      if (!currentSessionId || isStreaming) return;
      pollCount++;
      try {
        // 使用 getMessagesLight 检测变化（只获取最后1条）
        const lightMsgs = await window.mimo.getMessagesLight(currentSessionId);
        const lightList = Array.isArray(lightMsgs) ? lightMsgs : [];
        if (lightList.length === 0) return;

        const latestId = lightList[lightList.length - 1].info?.id || '';
        if (!latestId || latestId === lastMsgId) {
          if (syncStatus) syncStatus.textContent = '监听中 #' + pollCount + ' (总计: ' + renderedMsgIds.size + ')';
          return;
        }

        // 检测到变化，获取完整列表
        lastMsgId = latestId;
        if (syncStatus) syncStatus.textContent = '检测到变化 #' + pollCount + ': ' + latestId.substring(0, 15) + '...';

        const fullMsgs = await window.mimo.getMessages(currentSessionId);
        const fullList = Array.isArray(fullMsgs) ? fullMsgs : [];
        const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;

        // 增量追加新消息（只渲染不在 renderedMsgIds 中的）
        let newCount = 0;
        for (const msg of fullList) {
          const msgId = msg.info?.id;
          if (msgId && !renderedMsgIds.has(msgId)) {
            renderMessageParts(msg);
            renderedMsgIds.add(msgId);
            newCount++;
          }
        }

        if (newCount > 0) {
          if (syncStatus) syncStatus.textContent = '已渲染 ' + newCount + ' 条新消息 #' + pollCount + ' (总计: ' + renderedMsgIds.size + ')';
        } else {
          if (syncStatus) syncStatus.textContent = '无新消息 #' + pollCount + ' (总计: ' + renderedMsgIds.size + ')';
        }

        if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
      } catch (e) {
        if (syncStatus) syncStatus.textContent = '错误: ' + e.message;
      }
    }, 3000);
  }

  // ---------- Send Message ----------
  async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !currentSessionId || isStreaming) return;
    messageInput.value = '';
    autoResizeInput();
    const userDiv = document.createElement('div');
    userDiv.className = 'message user';
    userDiv.innerHTML = formatContent(content);
    messagesEl.appendChild(userDiv);

    const loadingEl = document.createElement('div');
    loadingEl.className = 'message assistant loading-indicator';
    loadingEl.innerHTML = '<div class="loading"><div class="spinner"></div>Thinking...</div>';
    messagesEl.appendChild(loadingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    isStreaming = true;
    btnSend.disabled = true;
    try {
      await window.mimo.sendMessage(currentSessionId, content, currentAgent);
      await pollForResponse(currentSessionId, loadingEl);
    } catch (err) {
      loadingEl.innerHTML = `<span style="color:var(--danger)">Error: ${escapeHtml(err.message)}</span>`;
    } finally {
      isStreaming = false;
      btnSend.disabled = false;
    }
  }

  async function pollForResponse(sessionId, loadingEl) {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const msgs = await window.mimo.getMessagesLight(sessionId);
        const list = Array.isArray(msgs) ? msgs : [];
        const lastMsg = list[list.length - 1];
        if (lastMsg?.info?.role === 'assistant' && lastMsg.parts?.length) {
          await loadMessages(sessionId);
          return;
        }
      } catch {}
    }
    await loadMessages(sessionId);
  }

  // ---------- Config ----------
  async function loadConfig() {
    try {
      config = await window.mimo.getConfig();
      if (config.model) {
        const modelName = config.model.replace('xiaomi/', '').replace('mimo-', 'MiMo ').replace('-pro', '').toUpperCase().replace('V2.5', '2.5');
        chatStatus.textContent = `Model: ${modelName}`;
      }
    } catch {}
  }

  // ---------- Settings ----------
  function openSettings() {
    $('#setting-server-url').value = localStorage.getItem('mimo-server-url') || 'http://127.0.0.1:4096';
    $('#setting-bg-image').value = localStorage.getItem('mimo-bg-image') || '';
    $('#setting-logo-image').value = localStorage.getItem('mimo-logo-image') || '';
    $('#setting-app-title').value = localStorage.getItem('mimo-app-title') || 'MiMo Code - Max';
    $('#setting-theme').value = localStorage.getItem('mimo-theme') || 'light';
    $('#setting-custom-css').value = localStorage.getItem('mimo-custom-css') || '';
    settingsPanel.classList.remove('hidden');
  }

  async function saveSettings() {
    const serverUrl = $('#setting-server-url').value.trim() || 'http://127.0.0.1:4096';
    localStorage.setItem('mimo-server-url', serverUrl);
    localStorage.setItem('mimo-bg-image', $('#setting-bg-image').value.trim());
    localStorage.setItem('mimo-logo-image', $('#setting-logo-image').value.trim());
    localStorage.setItem('mimo-app-title', $('#setting-app-title').value.trim() || 'MiMo Code - Max');
    localStorage.setItem('mimo-theme', $('#setting-theme').value);
    localStorage.setItem('mimo-custom-css', $('#setting-custom-css').value);
    await window.mimo.setServerUrl(serverUrl);
    applySettings();
    settingsPanel.classList.add('hidden');
    await loadSessions();
  }

  function applySettings() {
    const bgImage = localStorage.getItem('mimo-bg-image');
    const appTitle = localStorage.getItem('mimo-app-title') || 'MiMo Code - Max';
    const theme = localStorage.getItem('mimo-theme') || 'light';
    const customCss = localStorage.getItem('mimo-custom-css');
    $('#titlebar-title').textContent = appTitle;
    document.title = appTitle;
    document.body.className = theme === 'dark' ? 'theme-dark' : '';
    document.body.style.backgroundImage = bgImage ? `url(${bgImage})` : '';
    if (bgImage) { document.body.style.backgroundSize = 'cover'; document.body.style.backgroundPosition = 'center'; }
    let styleEl = document.getElementById('custom-style');
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'custom-style'; document.head.appendChild(styleEl); }
    styleEl.textContent = customCss || '';
  }

  // ---------- Titlebar ----------
  function setupTitlebar() {
    $('#btn-minimize').addEventListener('click', () => window.mimo.minimize());
    $('#btn-maximize').addEventListener('click', () => window.mimo.maximize());
    $('#btn-close').addEventListener('click', () => window.mimo.close());
  }

  // ---------- Events ----------
  function setupEventListeners() {
    btnNewChat.addEventListener('click', async () => {
      try {
        const session = await window.mimo.createSession({});
        if (session?.id) { await loadSessions(); await selectSession(session.id); messageInput.focus(); }
      } catch {}
    });
    btnSend.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    messageInput.addEventListener('input', autoResizeInput);
    btnSettings.addEventListener('click', openSettings);
    btnSaveSettings.addEventListener('click', saveSettings);
    btnCloseSettings.addEventListener('click', () => settingsPanel.classList.add('hidden'));
    settingsPanel.addEventListener('click', (e) => { if (e.target === settingsPanel) settingsPanel.classList.add('hidden'); });

    // Stream events
    window.mimo.onStreamChunk(({ sessionId, data }) => {
      if (sessionId === currentSessionId) {
        // Real-time update via SSE
        loadMessages(sessionId);
      }
    });
  }

  function autoResizeInput() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
  }

  function autoScroll(incremental) {
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
    if (nearBottom || !incremental) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------- Helpers ----------
  function formatTime(ts) {
    const d = new Date(ts);
    const diff = Date.now() - d;
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatDuration(createdTs) {
    // Approximate - actual duration needs end timestamp
    return '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatContent(content) {
    if (typeof content !== 'string') {
      try { content = JSON.stringify(content); } catch { content = String(content); }
    }
    let html = escapeHtml(content);
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ---------- Boot ----------
  init();
})();
