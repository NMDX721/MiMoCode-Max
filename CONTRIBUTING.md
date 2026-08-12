# Contributing to MiMo Code - Max

感谢你对 MiMo Code - Max 的关注！本文档将帮助你快速上手开发。

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn
- Git

### 安装

```bash
# 克隆仓库
git clone https://github.com/NMDX721/MiMoCode-Max.git
cd MiMoCode-Max

# 安装依赖
npm install

# 启动开发
npm start
```

## 开发工作流

### 分支策略

我们使用 **GitHub Flow**：

```
main                    ← 生产分支，始终可部署
├── feat/xxx            ← 新功能
├── fix/xxx             ← Bug 修复
├── hotfix/xxx          ← 紧急修复
└── chore/xxx           ← 维护/配置
```

### 分支命名规范

格式：`type/scope-description`

| 类型 | 命名示例 |
|------|---------|
| feat | `feat/sse-reconnect` |
| fix | `fix/duplicate-messages` |
| hotfix | `hotfix/crash-on-startup` |
| chore | `chore/update-deps` |

scope 可选，仅在改动涉及特定模块时添加：
- `feat/api/add-timeout`
- `fix/ui/scroll-position`

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)，统一使用**英文小写**：

```
<type>(<scope>): <subject>

[body]
```

| 类型 | 用途 | 示例 |
|------|------|------|
| feat | 新功能 | `feat: add SSE auto-reconnect` |
| fix | Bug 修复 | `fix: prevent duplicate user messages` |
| docs | 文档 | `docs: update README` |
| style | 格式 | `style: fix indentation` |
| refactor | 重构 | `refactor: extract API client` |
| test | 测试 | `test: add unit tests for cache` |
| chore | 构建/配置 | `chore: update electron to v41` |
| perf | 性能优化 | `perf: optimize message rendering` |

**提交规则**：
- 第一行 ≤50 字符，使用祈使语气
- body 说明 **为什么** 改，而不是 **改了什么**
- 重要变更关联 Issue（`Closes #123`）

### Pull Request 流程

1. **创建分支**
   ```bash
   git checkout -b feat/my-feature main
   ```

2. **开发并提交**
   ```bash
   git add .
   git commit -m "feat: 添加新功能"
   ```

3. **推送并创建 PR**
   ```bash
   git push -u origin feat/my-feature
   ```

4. **PR 要求**
   - 标题遵循 Conventional Commits
   - 描述清楚改动内容和原因
   - 关联相关 Issue（`Closes #123`）
   - 使用 **Squash and Merge** 保持历史整洁

### 代码风格

- 使用 4 空格缩进
- 避免不必要的注释
- 函数命名使用 PascalCase
- 变量命名使用 camelCase

### 测试

```bash
# 运行测试
npm test

# 运行 lint（如已配置）
npm run lint
```

## 问题报告

使用 [GitHub Issues](https://github.com/NMDX721/MiMoCode-Max/issues) 报告问题，请包含：

1. **问题描述**：清晰简洁地描述问题
2. **复现步骤**：详细的复现步骤
3. **期望行为**：描述期望的行为
4. **实际行为**：描述实际的行为
5. **环境信息**：操作系统、Node.js 版本等

## 功能请求

使用 [GitHub Issues](https://github.com/NMDX721/MiMoCode-Max/issues) 提交功能请求，请包含：

1. **问题描述**：清晰简洁地描述问题
2. **解决方案**：你期望的解决方案
3. **替代方案**：你考虑过的替代方案
4. **额外信息**：其他相关的信息

## 行为准则

- 尊重他人
- 接受建设性批评
- 关注最有利于社区的事情
- 对其他社区成员表示同理心

## 许可证

通过贡献代码，你同意你的贡献将在 MIT 许可证下授权。
