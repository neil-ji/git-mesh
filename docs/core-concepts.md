# 核心概念

理解 gitmesh 的三个核心概念：Worktree、Agent 协议、合并引擎。

## 整体架构

```
                        主干 (main)
                          │
             ┌────────────┼────────────┐
             │            │            │
          agent-A      agent-B      agent-C     ← 各自独立 worktree，并行工作
             │            │            │
             ▼            ▼            ▼
           完成          完成          完成
             │            │            │
             └────────────┼────────────┘
                          │
                     Merge Engine         ← 排序、rebase、合并、冲突路由
                          │
                          ▼
                       主干更新
```

gitmesh 管理从「Agent 开始工作」到「所有 Agent 代码合入主干」的完整流程。

## Worktree

gitmesh 使用 git 原生的 `git worktree` 机制为每个 Agent 创建独立工作区。每个 worktree：

- 有自己独立的文件系统目录
- 有自己独立的分支（默认命名 `mesh/<agent-name>`）
- 可以独立执行 git 操作（add、commit、rebase 等）
- 基于主干分支创建（可通过 `baseRef` 指定其他起点）

```
仓库根目录 (.git)
├── ...                ← 主干工作区
└── ../.gitmesh-workspaces/
    ├── fix-auth/      ← Agent "fix-auth" 的 worktree
    └── refactor-db/   ← Agent "refactor-db" 的 worktree
```

Worktree 层是 gitmesh 内部使用的，不暴露为公开 API。调用方通过 `onReady` 回调拿到 worktree 路径即可。

> **Worktree 内的 git 操作不属于 gitmesh 的职责。** gitmesh 创建 worktree 后，Agent 获得一个独立的 git 工作目录。Agent 在这个目录内的行为 — 编码、`git add`、`git commit`、`git config` 等 — 完全由 Agent 自己管理。gitmesh 只介入 rebase 和 merge 阶段，即「把变更合入主干」的环节。

## Agent 协议

gitmesh 不实现 Agent。它只定义两个信号：

| 信号 | 方向 | 模式 | 说明 |
|------|------|------|------|
| `onReady(signal)` | gitmesh → 调用方 → Agent | fire-and-forget | 工作区就绪，Agent 可以开始编码；gitmesh 不等返回 |
| `signal.done()` | Agent → gitmesh | 返回 `Promise<boolean>` | Agent 通知 gitmesh 工作完成，`true` = 合入成功，`false` = 合并失败 |
| `onConflict(conflict)` | gitmesh → 调用方 → Agent | 异步 | 发生冲突，需要 Agent 解决 |

Agent 可以是任何东西 — Claude SDK、shell 脚本、HTTP 服务、甚至手工操作。gitmesh 只关心「干完了吗」和「冲突怎么解决」。

调用方的职责：
1. 在 `onReady` 中启动 Agent（fire-and-forget），Agent 完成后调用 `signal.done()`
2. `signal.done()` 返回的 `Promise<boolean>` 告知合并结果
3. 在 `onConflict` 中桥接 Agent 解决冲突，返回 `{ resolved: true/false }`

详细说明见 [Agent 协议](./agent-protocol.md)。

## 合并引擎

合并引擎是 gitmesh 的核心。它负责：

1. **维护合并队列** — 按策略决定 Agent 的合并顺序
2. **执行 rebase** — 将 Agent 分支变基到当前主干 HEAD
3. **检测冲突** — rebase 失败时收集冲突信息
4. **路由冲突** — 将冲突信息传给对应 Agent 解决
5. **执行合并** — rebase 成功后 fast-forward 合入主干
6. **管理重试** — 冲突后重试，直到成功或超过上限

### 合并流程

```
Agent 完成
    │
    ▼
┌──────────────┐
│ rebase worktree │  ← 在 worktree 内 rebase 到主干 HEAD
└──────┬───────┘
       │
  ┌────┴────┐
  │ 冲突？   │
  └────┬────┘
  无冲突│   有冲突
       │      │
       ▼      ▼
  ┌────────┐ ┌──────────────────┐
  │ 合并    │ │ 通知 Agent 解决   │
  └───┬────┘ └────────┬─────────┘
      │               │
      ▼               ▼
  ┌────────┐    ┌──────────────┐
  │ 清理    │    │ 解决后重 rebase│
  │worktree │    └──────┬───────┘
  └────────┘           │
                   重试直到成功或超限
```

### Rebase-First 策略

默认策略。Agent 完成后立即 rebase 到当前主干 HEAD：

- **并发 rebase**：多个 Agent 可以同时 rebase（各自 worktree 独立）
- **串行合并**：写入主干必须串行（git 约束），通过文件锁保护
- **先成功先合并**：不阻塞在慢 Agent 上

注意：每次主干更新后，仍在 rebase 中的 Agent 需要**重新 rebase 到新主干**，避免「基于旧主干 rebase 成功，合并时发现新冲突」。

## Session 状态机

```
              ┌─────────┐
              │  IDLE   │
              └────┬────┘
                   │ gitmesh()
                   ▼
              ┌─────────┐
              │  INIT   │  创建 worktree，验证环境
              └────┬────┘
                   │
                   ▼
              ┌─────────┐
              │ WORKING │  Agent 并行编码
              └────┬────┘
                   │ Agent 完成
                   ▼
              ┌─────────┐
              │ MERGING │  rebase → merge 循环
              └────┬────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │  DONE  │ │PARTIAL │ │ FAILED │
   └────────┘ └────────┘ └────────┘
```

## 下一步

- [Agent 协议](./agent-protocol.md) — 如何接入你自己的 Agent
- [合并策略](./merge-strategies.md) — 深入理解 rebase-first 和 sequential
- [冲突解决](./conflict-resolution.md) — 冲突检测和解决流程
