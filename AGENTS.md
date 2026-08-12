# AGENTS.md

Entry point for coding agents working in this repository. Keep it short and operational.

## Repository Structure

Multi-project workspace. Each sub-project has its own `package.json`:

| Directory | Description | How to Run |
|-----------|-------------|------------|
| `mimocode-desktop/` | **Main project** - Electron GUI client for MiMo Code | `cd mimocode-desktop && npm start` |
| `mimocode-max-tauri/` | Tauri experiment (abandoned) | - |
| `clawd-on-desk/` | Electron desktop pet app | `cd clawd-on-desk && npm start` |
| `mimocode-web/` | Web client | - |
| `mimocode-nl/` | NLP related | - |
| `SillyTavern/` | SillyTavern integration | - |
| `paste-unlocker-desktop/` | Paste unlock tool | - |

## Main Project: mimocode-desktop

Electron GUI client for MiMo Code CLI. Connects to MiMo Code's headless API server.

### Architecture

```
Electron GUI ←→ HTTP API ←→ MiMo Code Server (mimo serve, port 4096)
```

### Key Files

| File | Role |
|------|------|
| `src/main.js` | Electron main process, IPC handlers, SSE connection |
| `src/renderer.js` | Frontend UI logic, message rendering, queue management |
| `src/api.js` | HTTP client for MiMo Code API |
| `src/preload.js` | Context bridge between main and renderer |
| `src/cache.js` | Local cache for sessions/messages |
| `src/server.js` | Auto-start headless server |

### Running

```bash
cd mimocode-desktop
npm start    # Start dev mode
npm run build  # Build installer
```

### API Server

Default: `http://127.0.0.1:4096`. Auto-starts `mimo serve` if not running.

Key API endpoints:
- `GET /session` - List sessions
- `POST /session` - Create session
- `POST /session/:id/message` - Send message (blocking, v1)
- `GET /session/:id/message` - Get messages
- `POST /session/:id/abort` - Stop generation
- `GET /event` - SSE event stream

### Known Issues

- **409 Busy**: API不支持并发。TUI和Max共享服务端时，Max消息排队。
- **Queue**: 合并排队消息在session idle后发送。支持"立即插入"按钮（abort+resend，会浪费token）。
- **v2 API禁用**: MiMo Code阉割了v2 prompt端点（delivery:steer），无法实现真正的mid-turn注入。

### Features

- ✅ 合并排队消息（不浪费token）
- ✅ 立即插入按钮（abort+resend）
- ✅ 队列预览（显示排队消息内容）
- ✅ 连接状态指示器
- ✅ 服务器配置面板（端口/自动启动）
- ✅ SSE指数退避重连
- ✅ 导出会话为Markdown
- ✅ 日志节流/旋转（5MB上限）

## Workspace Conventions

### Git Workflow

- **Branch**: GitHub Flow from `main`
- **Commits**: Conventional Commits format (e.g., `feat:`, `fix:`, `chore:`)
- **Current branch**: `feat/desktop-enhancements` (active development)

### Code Style

- 4-space indentation, PascalCase functions, camelCase variables
- Minimal comments, no unnecessary abstractions

### Verification

After changes, run:
```bash
cd mimocode-desktop && npm start
```
Confirm: app launches, no console errors, main window displays.

## Development Tips

1. **MiMo Code must be installed** (`mimo` command in PATH)
2. **Port 4096** is the default API port; configurable in Settings
3. **SSE events** power real-time message updates
4. **Cache** (`src/cache.js`) provides offline fallback
5. **Always `git add && git commit` before destructive/experimental operations**
