# MiMo Code - Max

一个轻量级的 MiMo Code 桌面客户端，基于 Electron 构建，支持 SSE 实时消息同步。

## 功能特性

- 🚀 **轻量快速** - 基于 Electron，启动迅速
- 💬 **实时同步** - SSE 事件驱动，消息即时更新
- 🤝 **智能排队** - API 忙碌时消息自动合并排队，不浪费 token
- ⚡ **立即插入** - 打断当前任务，立即发送排队消息
- 👁️ **队列预览** - 显示排队消息内容
- 🔌 **连接状态** - 实时显示服务器连接状态
- 🖼️ **图片支持** - 支持粘贴和拖拽上传图片
- 🎨 **主题切换** - 支持浅色/深色主题
- 📤 **导出对话** - 一键导出会话为 Markdown
- 🗑️ **右键删除** - 右键会话可删除
- 🔄 **自动重启** - 自动启动 MiMo Code 服务器

## 安装

### 从源码安装

```bash
git clone https://github.com/NMDX721/MiMoCode-Max.git
cd MiMoCode-Max

npm install
npm start
```

### 构建安装包

```bash
npm run build
```

## 使用方法

1. 双击快捷方式（或运行 `npm start`），Max 会自动启动 MiMo Code 服务器
2. 在设置中配置服务器端口（默认 4096）
3. 开始对话！

### 排队机制

- **自动合并**：API 忙碌时，新消息自动合并排队，空闲后一次发送（零 token 浪费）
- **立即插入**：点击"立即插入"按钮可打断当前任务，立即发送排队消息（会浪费部分 token）

### 已知限制

- **409 Busy**：MiMo Code API 不支持并发请求。TUI 和 Max 共享服务端时，Max 消息会排队等待
- **v2 API 禁用**：MiMo Code 阉割了 v2 prompt 端点（delivery:steer），无法实现真正的 mid-turn 注入

## 开发

### 项目结构

```
mimocode-desktop/
├── src/
│   ├── main.js          # Electron 主进程
│   ├── renderer.js      # 渲染进程
│   ├── preload.js       # 预加载脚本
│   ├── api.js           # API 客户端
│   ├── cache.js         # 本地缓存
│   ├── server.js        # 服务器管理
│   ├── index.html       # 主页面
│   └── styles.css       # 样式
├── assets/              # 图标资源
├── package.json
└── README.md
```

### 开发命令

```bash
npm start            # 启动开发模式
npm run build        # 构建安装包
npm run build:win:x64  # 构建 x64 安装包
```

## 许可证

MIT License