<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo.svg">
    <img alt="gitmesh" src="docs/logo.svg" width="80">
  </picture>
</p>

<h1 align="center">gitmesh</h1>

<p align="center">
  <strong>多 Agent 并行编码的 Git 编排层</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/gitmesh"><img alt="npm" src="https://img.shields.io/npm/v/gitmesh?color=%2306b6d4"></a>
  <a href="https://github.com/neil-ji/git-mesh/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/neil-ji/git-mesh/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-10b981"></a>
</p>

<p align="center">
  <a href="https://neil-ji.github.io/git-mesh/"><strong>🌐 落地页</strong></a>
  &nbsp;·&nbsp;
  <a href="https://neil-ji.github.io/git-mesh/sdk.html"><strong>📖 SDK 文档</strong></a>
  &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/gitmesh"><strong>📦 npm</strong></a>
</p>

---

在单仓库内为多个 AI Agent 创建隔离的 git worktree，Agent 各自完成编码后，自动 rebase → merge 回主干。遇冲突时路由回对应 Agent 自行解决，循环直到全部合并成功。

**不是 CI，不是 Agent 框架 — 只管多 Agent 的 git 操作。**

## 安装

```bash
npm install gitmesh
```

要求 Node.js ≥ 18，Git ≥ 2.30。

## 10 秒上手

```typescript
import { gitmesh } from "gitmesh";

const session = await gitmesh({
  cwd: "/path/to/your/repo",
  agents: [
    {
      name: "fix-auth",
      // onReady 是 fire-and-forget —— gitmesh 不等待它返回。
      // Agent 生命周期以 signal.done() 为准。
      onReady: (signal) => {
        runClaudeAgent({ cwd: signal.worktreePath }).then(() => signal.done());
      },
      onConflict: async (conflict) => {
        return runConflictResolver(conflict);
      },
    },
  ],
  // 构造函数回调避免了 session.on() 的时序竞争
  onMerged: (name, commit) => console.log(`✅ ${name} → ${commit.slice(0, 7)}`),
  onFailed: (name, reason, worktreePath) => console.error(`${name} failed: ${reason}`),
});

// signal.done() 返回 Promise<boolean>:
//   true  = 成功合入主干
//   false = 合并失败（冲突无解、重试耗尽等）
const summary = await session.done();
```

## 解决的问题

| 痛点 | gitmesh 怎么做 |
|------|---------------|
| 多 Agent 共享目录，文件互相踩踏 | 每个 Agent 独立 git worktree，并行编码互不干扰 |
| 完成时间不可预测，合并顺序混乱 | Rebase-First 策略，先完成先合并，不阻塞 |
| 改同一文件产生冲突，无人解决 | 自动检测冲突，携带完整上下文路由回 Agent 解决 |

## 核心概念

```
                    主干 (main)
                      │
         ┌────────────┼────────────┐
         │            │            │
      agent-A      agent-B      agent-C     ← 独立 worktree，并行工作
         │            │            │
         └────────────┼────────────┘
                      │
                 Merge Engine               ← rebase → merge → 冲突路由
                      │
                      ▼
                   主干更新
```

- **[Agent 协议](https://neil-ji.github.io/git-mesh/sdk.html#agent-protocol)** — 两个信号：`onReady`（fire-and-forget，`signal.done()` 为生命周期锚点） + `onConflict`（解决冲突），协议无关实现
- **[Rebase-First 合并](https://neil-ji.github.io/git-mesh/sdk.html#merge-strategies)** — 线性 git 历史，冲突在 worktree 内解决，不污染主干
- **[冲突路由](https://neil-ji.github.io/git-mesh/sdk.html#conflict-resolution)** — 检测 → 通知 Agent → 解决 → 重试，循环直到成功或超限

> **gitmesh 不是 git SDK。** 它不封装 `git add`、`git commit`、`git config` 等操作。worktree 内的编码和 git 操作由 Agent 自行管理（推荐使用 [simple-git](https://github.com/steveukx/git-js) 等库）。gitmesh 只做一件事：**把并行变更安全地合到一起。**
- **[事件系统](https://neil-ji.github.io/git-mesh/sdk.html#events)** — 8 个 typed 事件覆盖从 worktree 创建到合并完成的全流程；也可通过构造函数 `onMerged` / `onFailed` / `onConflict` / `onDone` 回调监听，免去事件注册的时序问题

## API 概览

### `gitmesh(options)` → `Promise<Session>`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents` | `AgentDefinition[]` | 必填 | Agent 定义列表 |
| `strategy` | `"rebase-first"` \| `"sequential"` | `"rebase-first"` | 合并策略 |
| `maxRetries` | `number` | `3` | 冲突重试上限 |
| `conflictTimeout` | `number` | `600_000` | 冲突解决超时 (ms) |
| `cwd` | `string` | `process.cwd()` | 仓库路径 |
| `trunkBranch` | `string` | `"main"` | 主干分支名 |
| `onMerged` | `(name: string, commit: string) => void` | — | Agent 成功合并回调，免去事件注册的时序问题 |
| `onFailed` | `(name: string, reason: string, worktreePath: string) => void` | — | Agent 合并失败回调 |
| `onConflict` | `(info: ConflictInfo) => void` | — | 检测到冲突时回调 |
| `onDone` | `(summary: SessionSummary) => void` | — | Session 完成回调 |

### AgentDefinition

```typescript
interface AgentDefinition {
  name: string;                                                  // 唯一名称
  baseRef?: string;                                              // worktree 起点 ref
  onReady: (signal: AgentWorkDoneSignal) => void | Promise<void>;// fire-and-forget，以 signal.done() 为生命周期锚点
  onConflict: (info: ConflictInfo) => Promise<ResolutionResult>; // 冲突解决回调
}
```

### AgentWorkDoneSignal

```typescript
interface AgentWorkDoneSignal {
  agentName: string;
  worktreePath: string;
  done: () => Promise<boolean>; // true = 成功合入主干，false = 合并失败
}
```

### Session 事件

高频通知（`mesh:merged`、`mesh:failed`、`mesh:conflict`、`session:done`）推荐通过构造函数 `onMerged` / `onFailed` / `onConflict` / `onDone` 回调注册，避免时序竞争。事件系统仍可用于其他场景：

| 事件 | 说明 |
|------|------|
| `worktree:ready` | worktree 已创建 |
| `agent:done` | Agent 完成编码 |
| `mesh:rebase` | 开始 rebase |
| `mesh:conflict` | 检测到冲突 |
| `mesh:retry` | 重试 rebase |
| `mesh:merged` | 成功合并 |
| `mesh:failed` | 合并失败 |
| `session:done` | 全流程结束 |

完整 API 文档见 **[SDK 文档](https://neil-ji.github.io/git-mesh/sdk.html#api-reference)**。

## 文档

- **[落地页](https://neil-ji.github.io/git-mesh/)** — 产品介绍和交互式工作流程演示
- **[SDK 文档](https://neil-ji.github.io/git-mesh/sdk.html)** — 完整 API 参考和使用指南
  - 快速开始 · 核心概念 · Agent 协议 · 合并策略 · 冲突解决 · API 参考 · 事件系统 · 错误处理 · 高级用法

## License

MIT
