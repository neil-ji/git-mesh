# 快速开始

5 分钟跑通第一个 gitmesh session。

## 安装

```bash
npm install gitmesh
```

## 前置条件

- Node.js ≥ 18
- Git ≥ 2.30（支持 `git worktree`）
- 一个已有的 git 仓库

## 第一个 Session

下面是最小可运行的例子。假设你有一个已有的 git 仓库，两个 Agent 各自修改不同文件：

```typescript
import { gitmesh } from "gitmesh";

const session = await gitmesh({
  cwd: "/path/to/your/repo",
  agents: [
    {
      name: "fix-auth",
      onReady: async (signal) => {
        // Agent 在 signal.worktreePath 中工作
        // 这里可以是 Claude SDK、shell 脚本、或任何其他 Agent 实现
        console.log(`Agent 工作区: ${signal.worktreePath}`);
        signal.done(); // 通知 gitmesh：我完成了，可以合并
      },
      onConflict: async (conflict) => {
        // 冲突时由 Agent 自行解决
        console.log(`发现 ${conflict.files.length} 个冲突文件`);
        return { resolved: true };
      },
    },
    {
      name: "refactor-db",
      onReady: async (signal) => {
        console.log(`Agent 工作区: ${signal.worktreePath}`);
        signal.done();
      },
      onConflict: async (conflict) => {
        return { resolved: true };
      },
    },
  ],
});

// 等待全部完成
const summary = await session.done();
console.log(summary);
// { status: "success", results: [...], trunkHead: "abc1234..." }
```

## 发生了什么

1. gitmesh 为每个 Agent 创建了独立的 git worktree（基于主干分支）
2. 在每个 worktree 中创建了独立分支（`mesh/<agent-name>`）
3. 调用每个 Agent 的 `onReady` 回调，传入工作区路径
4. Agent 在各自的 worktree 中完成编码，调用 `signal.done()`
5. gitmesh 将每个 Agent 的分支 rebase 到主干 HEAD，然后合入主干
6. 全部完成后返回摘要

## 监听进度

```typescript
session.on("worktree:ready", (info) => {
  console.log(`✅ ${info.name} 工作区已就绪: ${info.path}`);
});

session.on("mesh:merged", (name, commit) => {
  console.log(`✅ ${name} 已合并，commit: ${commit.slice(0, 7)}`);
});

session.on("mesh:failed", (name, reason) => {
  console.log(`❌ ${name} 合并失败: ${reason}`);
});

session.on("session:done", (summary) => {
  console.log(`完成: ${summary.status}, 主干 HEAD: ${summary.trunkHead}`);
});
```

## 配置选项

```typescript
await gitmesh({
  cwd: "/path/to/repo",        // 仓库路径，默认 process.cwd()
  agents: [...],                // Agent 定义列表（必填）
  strategy: "rebase-first",     // 合并策略，默认 "rebase-first"
  maxRetries: 3,                // 冲突重试上限，默认 3
  conflictTimeout: 600_000,     // 冲突解决超时 (ms)，默认 10 分钟
  workspaceDir: "../.gitmesh-workspaces", // worktree 存储目录
  trunkBranch: "main",          // 主干分支名
  branchPrefix: "mesh/",        // Agent 分支名前缀
});
```

## 下一步

- [核心概念](./core-concepts.md) — 深入理解 gitmesh 的工作方式
- [Agent 协议](./agent-protocol.md) — 如何接入你自己的 Agent
- [合并策略](./merge-strategies.md) — rebase-first vs sequential
