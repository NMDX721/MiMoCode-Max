# CLAUDE.md - MiMo Code Desktop 项目规则

## 项目概述

轻量级 MiMo Code 桌面客户端，基于 Electron 构建，支持 SSE 实时消息同步。

## AI 代理工作规则

### 任务流程

1. **理解需求** → 读取相关文件，确认理解
2. **创建分支** → 从 `main` 创建功能分支（如尚未在功能分支上）
3. **实施更改** → 最小化改动，不引入额外抽象
4. **验证** → 运行 `npm start` 确认应用可启动，无控制台报错
5. **提交** → 遵循提交规范（见下方）
6. **推送并创建 PR** → 如用户要求

### 禁止事项

- **不要**在未运行验证的情况下声称任务完成
- **不要**添加用户未要求的功能
- **不要**修改 `package.json` 的版本号（除非用户明确要求）
- **不要**引入新的 npm 依赖（除非用户明确要求）
- **不要**在 `main` 分支上直接提交
- **不要**提交包含 API key、token 等敏感信息的文件

### 代码变更原则

- 改动必须是最小化的，只解决用户提出的问题
- 如果改动超过任务复杂度的 3 倍，停下来重新评估
- 修改代码后必须运行验证（`npm start` 或相关测试）
- 保持现有代码风格一致

## Git 工作流

### 分支策略

采用 **GitHub Flow**（适用于个人项目和持续交付）：

```
main                    ← 生产分支，始终可部署
├── feat/xxx            ← 新功能
├── fix/xxx             ← Bug 修复
├── hotfix/xxx          ← 紧急修复（直接从 main 分出）
└── chore/xxx           ← 维护/配置
```

**规则**：
- 所有更改从 `main` 创建功能分支
- 开发完成后通过 PR 合并回 `main`
- 合并后删除功能分支
- `main` 始终保持可部署状态

### 提交与推送频率

**核心原则**：Commit often, push at logical checkpoints

| 阶段 | 频率 | 说明 |
|------|------|------|
| Commit | 每个逻辑单元完成时 | 30-60 分钟的工作量，或完成一个独立功能点 |
| Push | 功能完成或达到里程碑 | 不要每改一行就 push，也不要攒一天才 push |
| PR | 功能完全准备好时 | 所有测试通过，代码可审查 |

**具体规则**：
- **不要**频繁 push（每改一行就 push 会污染 git 历史）
- **不要**攒太多本地 commit 再 push（丢失风险）
- **推荐**：一个功能分支包含 3-10 个有意义的 commit
- **推荐**：每天至少 push 一次到远程分支（作为备份）
- **推荐**：功能完成后再创建 PR，而不是边做边创建

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
| style | 格式（不影响逻辑） | `style: fix indentation` |
| refactor | 重构（非新功能/非修复） | `refactor: extract API client` |
| test | 测试 | `test: add unit tests for cache` |
| chore | 构建/配置 | `chore: update electron to v41` |
| perf | 性能优化 | `perf: optimize message rendering` |

**规则**：
- 第一行 ≤50 字符，使用祈使语气
- body 说明 **为什么** 改，而不是 **改了什么**
- 重要变更关联 Issue（`Closes #123`）

### Pull Request 流程

```bash
# 1. 从 main 创建分支
git checkout -b feat/my-feature main

# 2. 开发并提交
git add .
git commit -m "feat: add new feature"

# 3. 推送并创建 PR
git push -u origin feat/my-feature

# 4. 在 GitHub 上创建 PR，合并后删除分支
```

**PR 要求**：
- 标题遵循 Conventional Commits
- 描述清楚改动内容和原因
- 关联相关 Issue
- 使用 **Squash and Merge** 保持历史整洁

### Release 管理

- 使用 Semantic Versioning: `v1.2.3`
- 通过 Git Tags 标记版本：`git tag v1.2.3`

## 代码风格

- 使用 4 空格缩进
- 避免不必要的注释
- 函数命名使用 PascalCase
- 变量命名使用 camelCase

## 文件组织

```
mimocode-desktop/
├── src/               # 源代码
│   ├── main.js        # Electron 主进程
│   ├── renderer.js    # 渲染进程
│   ├── preload.js     # 预加载脚本
│   ├── api.js         # API 客户端
│   ├── cache.js       # 本地缓存
│   ├── index.html     # 主页面
│   └── styles.css     # 样式
├── assets/            # 图标资源
├── docs/              # 文档
├── package.json
└── README.md
```

## .gitignore 规则

以下文件/目录**禁止提交**：

| 类别 | 路径模式 |
|------|---------|
| 依赖 | `node_modules/` |
| 构建产物 | `dist/`、`out/`、`build/` |
| 缓存 | `.cache/`、`*.log` |
| API 响应（调试用） | `api-response.json` |
| 环境配置 | `.env`、`.env.local` |
| IDE 配置 | `.vscode/`、`.idea/` |
| 系统文件 | `.DS_Store`、`Thumbs.db` |

## 开发环境

- Node.js 18+
- npm 或 yarn
- Git

## 运行与验证

```bash
# 启动应用
npm start

# 构建安装包
npm run build
```

验证标准：应用启动后无控制台报错，主窗口正常显示。
