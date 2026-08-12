# MiMo Code - Max

一个轻量级的 MiMo Code 桌面客户端，基于 Electron 构建，支持 SSE 实时消息同步。

## 功能特性

- 🚀 **轻量快速** - 基于 Electron，启动迅速
- 💬 **实时同步** - SSE 事件驱动，消息即时更新
- 🖼️ **图片支持** - 支持粘贴和拖拽上传图片
- 🎨 **主题切换** - 支持浅色/深色主题
- 📱 **响应式设计** - 适配不同屏幕尺寸

## 安装

### 从源码安装

```bash
# 克隆仓库
git clone https://github.com/NMDX721/MiMoCode-Max.git
cd MiMoCode-Max

# 安装依赖
npm install

# 启动应用
npm start
```

### 构建安装包

```bash
# 构建 Windows 安装包
npm run build
```

## 使用方法

1. 启动 MiMo Code 服务（默认端口 4096）
2. 运行 `npm start` 启动桌面客户端
3. 在设置中配置服务器地址（默认 `http://127.0.0.1:4096`）
4. 开始对话！

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
│   ├── index.html       # 主页面
│   └── styles.css       # 样式
├── assets/              # 图标资源
├── package.json
└── README.md
```

### 开发命令

```bash
# 启动开发模式
npm start

# 构建安装包
npm run build

# 构建特定架构
npm run build:win:x64
```

## 贡献

欢迎贡献代码！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

## 许可证

MIT License
