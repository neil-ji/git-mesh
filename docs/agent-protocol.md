# Agent 协议

gitmesh 不实现 Agent — 它只定义 Agent 必须遵守的协议。调用方通过实现两个回调函数将 Agent 接入。

## 协议概览

gitmesh 和 Agent 之间只有两个通信点：

```
gitmesh                         调用方 / Agent
  │                                  │
  │ ── onReady(signal) ──→           │  1. 工作区就绪
  │                                  │     Agent 开始编码
  │                                  │     Agent 调用 signal.done()
  │ ←── signal.done() ────           │
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
  onReady: (signal: AgentWorkDoneSignal) => void | Promise<void>;
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

## onReady — 工作就绪信号

所有 Agent 工作的起点。gitmesh 在 worktree 创建成功、分支准备好之后调用此回调。

```typescript
onReady: async (signal: AgentWorkDoneSignal) => {
  // signal.agentName   — Agent 名称
  // signal.worktreePath — 工作区的绝对路径

  // 在这里启动你的 Agent
  await runYourAgent({ cwd: signal.worktreePath });

  // Agent 完成后，通知 gitmesh
  signal.done();
};
```

**重要规则**：

- `signal.done()` **必须被调用**，否则 gitmesh 永远等待这个 Agent，session 永远不会结束
- `signal.done()` 只能调用一次，重复调用会被忽略
- `onReady` 可以是 async 函数，gitmesh 会 await 它（但合并引擎独立运行，不等 `done()`）
- Agent 的 commit 需要在 worktree 内完成；gitmesh 不自动 commit

### 典型接入模式

#### 模式 1：Claude SDK

```typescript
import { query } from "@anthropic-ai/claude-code";

onReady: async (signal) => {
  await query({
    prompt: "修复 OAuth token 刷新逻辑",
    cwd: signal.worktreePath,
  });
  signal.done();
};
```

#### 模式 2：Shell 脚本

```typescript
import { exec } from "child_process";

onReady: async (signal) => {
  await new Promise<void>((resolve, reject) => {
    exec("bash ./agent-script.sh", { cwd: signal.worktreePath }, (err) => {
      if (err) reject(err);
      else {
        signal.done();
        resolve();
      }
    });
  });
};
```

#### 模式 3：HTTP 回调

```typescript
onReady: async (signal) => {
  // 通知远程 Agent 服务工作区路径
  await fetch("http://agent-service/start", {
    method: "POST",
    body: JSON.stringify({ worktreePath: signal.worktreePath }),
  });

  // 轮询等待远程 Agent 完成
  while (true) {
    const res = await fetch("http://agent-service/status");
    const { done } = await res.json();
    if (done) {
      signal.done();
      break;
    }
    await sleep(1000);
  }
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
