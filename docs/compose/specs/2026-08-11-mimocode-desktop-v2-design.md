# MiMo Code Desktop v2 — 重构设计

## [S1] 问题

当前版本存在：
- 会话切换加载慢（全量21MB）
- 消息类型不完整（缺少tool/step/file渲染）
- 无本地缓存（每次重新拉取）
- 无流式传输（轮询延迟高）
- 自动刷新不可靠

## [S2] 架构

```
main.js
├── api.js      — HTTP客户端（重试、超时）
├── cache.js    — 本地JSON缓存
├── stream.js   — SSE流式连接
└── tray.js     — 托盘

renderer.js
├── app.js      — 状态管理
├── render.js   — 消息渲染（全类型）
├── thinking.js — Thinking折叠组件
└── settings.js — 设置面板
```

## [S3] 消息类型

| 类型 | 结构 | 渲染 |
|------|------|------|
| text | `{text}` | Markdown正文 |
| reasoning | `{text}` | Thinking折叠（默认收起） |
| tool | `{tool, state}` | 工具预览+展开详情 |
| step-start | `{id}` | 步骤分隔线 |
| step-finish | `{id}` | 步骤结束 |
| file | `{mime, filename, url}` | 图片内联/文件名 |

## [S4] 缓存策略

- 位置：`~/.mimocode_home/data/desktop-cache/`
- 会话列表：`sessions.json`
- 消息：`messages/<session-id>.json`
- 流程：启动读缓存 → 后台API刷新 → 增量更新DOM

## [S5] 流式传输

- SSE连接到 `mimo serve`
- 事件：message.start/chunk/end, session.update
- 主进程接收 → 转发渲染进程 → 实时更新DOM

## [S6] 工具调用预览

```
📄 edit src/main.js (replace)
├── 展开：old_string → new_string diff
```

状态图标：✅ completed / ❌ error / ⏳ pending
