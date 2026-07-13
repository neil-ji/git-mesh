# Agent 协议

gitmesh 不实现 Agent — 它只定义 Agent 必须遵守的协议。调用方通过实现两个回调函数将 Agent 接入。

> **gitmesh 不是 git SDK。** 它不封装 `git add`、`git commit`、`git config` 等操作。在 worktree 内部，你需要使用自己的 git 工具（simple-git、Node.js `child_process`、shell 脚本等）来完成编码和提交。gitmesh 只负责一件事：**把多个 Agent 的并行变更安全地合到一起。**

## 协议概览

gitmesh 和 Agent 之间只有两个通信点：

```
gitmesh                         调用方 / Agent
  │                                  │
  │ ── onReady(signal) ──→           │  1. 工作区就绪（fire-and-forget）
  │                                  │     Agent 开始编码（gitmesh 不等返回）
  │                                  │     Agent 完成后调用 signal.done()
  │ ←── signal.done() ────           │     → 返回 Promise<boolean>
  │                                  │
  │ ── rebase ──→                    │  2. 合并引擎工作
  │                                  │
  │ ── onConflict(info) ──→          │  3. 发生冲突（可选）
  │                                  │     Agent 解决冲突
  │ ←── ResolutionResult ───        │
  │                                  │
  │ ── merge ──→                     │  4. 合并到主干
```

## AgentDefinition

接入一个 Agent 需要提供以下信息：

```typescript
interface AgentDefinition {
  name: string;           // 唯一名称
  baseRef?: string;       // 基于哪个 ref 创建工作区，默认 trunkBranch
  onReady: (signal: AgentWorkDoneSignal) => void;  // fire-and-forget
  onConflict: (conflict: ConflictInfo) => Promise<ResolutionResult>;
}
```

### name

Agent 的唯一标识符。用于：
- worktree 目录命名
- git 分支命名（`mesh/<name>`）
- 事件中的 Agent 标识
- 结果摘要中的 Agent 标识

**约束**：必须唯一，建议使用有意义的名称（如 `"fix-oauth-bug"`）。

### baseRef

工作区的起点 ref。默认为 `trunkBranch`（通常是 `main`）。

如果 Agent 需要基于特定的 commit 或 tag 工作，可以通过此参数指定：

```typescript
const agent = {
  name: "hotfix",
  baseRef: "v2.1.0", // 基于 tag 创建工作区
  // ...
};
```

## onReady — 工作就绪信号（fire-and-forget）

所有 Agent 工作的起点。gitmesh 在 worktree 创建成功、分支准备好之后调用此回调。

```typescript
onReady: (signal: AgentWorkDoneSignal) => {
  // signal.agentName   — Agent 名称
  // signal.worktreePath — 工作区的绝对路径

  // 在这里启动你的 Agent（fire-and-forget）
  runYourAgent({ cwd: signal.worktreePath }).then(() => {
    // Agent 完成后，等待 gitmesh 返回合并结果
    signal.done().then((merged) => {
      if (merged) {
        console.log("代码已合入主干");
      } else {
        console.log("合并失败");
      }
    });
  });
};
```

**重要规则**：

- **`onReady` 是 fire-and-forget**：gitmesh 调用 `onReady` 后立即返回，不等待回调返回或 resolve。Agent 的生命周期完全由 `signal.done()` 控制
- **异常安全**：如果 `onReady` 抛出异常（同步或异步），gitmesh 会自动触发 `mesh:failed` 事件，Session 不会因此挂起。无需在 `onReady` 中自行 try/catch
- `signal.done()` **必须被调用**，否则 gitmesh 永远等待这个 Agent，session 永远不会结束
- `signal.done()` 只能调用一次，重复调用会被忽略
- `signal.done()` **返回 `Promise<boolean>`**：`true` 表示代码成功合入主干，`false` 表示合并失败
- Agent 的编码和提交完全由 Agent 自己完成 — gitmesh 不管理 worktree 内的 git 操作（add、commit、config 等）。如需 `user.name` / `user.email` 等 git 配置，请在 `onReady` 中自行设置。推荐使用 simple-git 等库处理 worktree 内的 git 操作

### 典型接入模式

#### 模式 1：Claude SDK

```typescript
import { query } from "@anthropic-ai/claude-code";

onReady: (signal) => {
  query({
    prompt: "修复 OAuth token 刷新逻辑",
    cwd: signal.worktreePath,
  }).then(() => signal.done());
};
```

#### 模式 2：Shell 脚本

```typescript
import { exec } from "child_process";

onReady: (signal) => {
  exec("bash ./agent-script.sh", { cwd: signal.worktreePath }, (err) => {
    if (!err) signal.done();
  });
};
```

#### 模式 3：HTTP 回调

```typescript
onReady: (signal) => {
  // 通知远程 Agent 服务工作区路径（fire-and-forget）
  fetch("http://agent-service/start", {
    method: "POST",
    body: JSON.stringify({ worktreePath: signal.worktreePath }),
  });

  // 轮询等待远程 Agent 完成
  const poll = async () => {
    while (true) {
      const res = await fetch("http://agent-service/status");
      const data = await res.json();
      if (data.done) {
        const merged = await signal.done();
        console.log(`远程 Agent 合并${merged ? "成功" : "失败"}`);
        return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  };
  poll();
};
```

## onConflict — 冲突解决

当 Agent 代码 rebase 到主干时发生冲突，gitmesh 调用此回调。

```typescript
onConflict: async (conflict: ConflictInfo): Promise<ResolutionResult> => {
  // conflict.agentName     — 哪个 Agent 遇到冲突
  // conflict.files          — 冲突文件列表
  // conflict.worktreePath   — 解决冲突的工作区路径
  // conflict.attempt        — 当前第几次尝试
  // conflict.maxRetries     — 最大重试次数
  // conflict.targetCommit   — 变基目标 commit
  // conflict.sourceCommit   — Agent 分支当前 commit

  // 让 Agent 解决冲突
  const ok = await runConflictResolver(conflict);

  return { resolved: ok, reason: ok ? undefined : "无法自动解决" };
};
```

### ConflictFile 详解

每个冲突文件提供三种信息帮助 Agent 解决冲突：

```typescript
interface ConflictFile {
  path: string;       // 文件路径
  status: string;     // 冲突类型
  content: string;    // 含冲突标记的完整文件内容（可直接编辑）
  incomingDiff: string; // 主干侧改了什么
  outgoingDiff: string; // Agent 侧改了什么
}
```

### 冲突解决流程

```
gitmesh 检测到冲突
    │
    ▼
构建 ConflictInfo，调用 onConflict()
    │
    ▼
Agent 在 worktreePath 内解决问题：
  - 编辑冲突文件，删除 <<<<<<< ======= >>>>>>> 标记
  - 删除不需要的版本
  - 合并双方修改
    │
    ▼
返回 ResolutionResult
    │
    ├─ { resolved: true }  → gitmesh 执行 git add + git rebase --continue
    │                         ├─ 成功 → 继续合并流程
    │                         └─ 又冲突 → 再次调用 onConflict（attempt + 1）
    │
    └─ { resolved: false } → 标记此 Agent 失败，跳过
                              记录 reason，保留 worktree 供人工介入
```

### 冲突解决提示词模板

当使用大模型 Agent 时，可以构建以下提示词：

```typescript
function buildConflictPrompt(conflict: ConflictInfo): string {
  const fileList = conflict.files.map((f) => {
    return `### ${f.path} (${f.status})\n\n` +
      `主干改动:\n\`\`\`diff\n${f.incomingDiff}\n\`\`\`\n\n` +
      `你的改动:\n\`\`\`diff\n${f.outgoingDiff}\n\`\`\`\n\n` +
      `当前文件（含冲突标记）:\n\`\`\`\n${f.content}\n\`\`\``;
  }).join("\n\n---\n\n");

  return `你在文件中有 git 冲突需要解决。\n\n${fileList}\n\n` +
    `请编辑这些文件解决冲突，删除 <<<<<<< ======= >>>>>>> 标记。`;
}

// 使用
onConflict: async (conflict) => {
  const ok = await runClaudeAgent({
    prompt: buildConflictPrompt(conflict),
    cwd: conflict.worktreePath,
  });
  return { resolved: ok };
};
```

## 超时控制

通过 `conflictTimeout` 控制冲突解决的最大时长：

```typescript
const session = await gitmesh({
  agents: [...],
  conflictTimeout: 300_000, // 5 分钟超时
});
```

超时后，gitmesh 抛出 `AgentTimeoutError`，该 Agent 标记为失败。

## 下一步

- [合并策略](./merge-strategies.md) — 理解合并引擎如何编排 Agent
- [冲突解决](./conflict-resolution.md) — 冲突检测和解决的完整流程
- [高级用法](./advanced-usage.md) — 更多接入模式
