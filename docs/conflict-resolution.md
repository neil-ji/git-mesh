# 冲突解决

gitmesh 在 rebase 过程中自动检测冲突，将冲突信息路由给对应的 Agent 解决，并管理重试循环。

## 冲突何时发生

在 rebase-first 策略下，冲突发生在 Agent 的分支 rebase 到主干 HEAD 时：

```
Agent 分支       主干
  │               │
  A --- B --- C   D --- E
  │               │
  └─── rebase ────┘
        │
        ├─ commit A 能干净应用到 E 上 → 继续
        ├─ commit B 和 D 修改了同一文件 → 冲突！
        └─ ...
```

## 冲突检测

gitmesh 不实现冲突检测算法 — 它使用 git 原生的 rebase 机制。当 `git rebase` 返回冲突状态时，gitmesh 解析冲突信息并构建 `ConflictInfo`。

## ConflictInfo 结构

```typescript
interface ConflictInfo {
  agentName: string;       // 哪个 Agent 遇到冲突
  files: ConflictFile[];   // 冲突文件列表
  attempt: number;         // 当前第几次尝试（从 1 开始）
  maxRetries: number;      // 最大重试次数
  targetCommit: string;    // 变基目标（主干 HEAD）
  sourceCommit: string;    // Agent 分支 HEAD
  worktreePath: string;    // 解决冲突的工作目录
}
```

### ConflictFile 字段

每个冲突文件提供三类信息帮助 Agent 理解冲突：

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 相对于仓库根的文件路径 |
| `status` | `ConflictStatus` | 冲突类型 |
| `content` | `string` | 含 `<<<<<<<` `=======` `>>>>>>>` 标记的完整内容 |
| `incomingDiff` | `string` | 主干侧做了什么改动 |
| `outgoingDiff` | `string` | Agent 侧做了什么改动 |

### 冲突状态

| status | 说明 | 解决方式 |
|--------|------|---------|
| `conflicted` | 双方修改了同一文件内容 | 编辑文件，选择保留的内容 |
| `deleted-by-us` | Agent 删了文件，主干修改了它 | 决定删除还是恢复文件 |
| `deleted-by-them` | 主干删了文件，Agent 修改了它 | 决定删除还是恢复文件 |
| `deleted-by-both` | 双方都删了文件 | 通常无需处理 |
| `added-by-both` | 双方新增了同名文件 | 决定用哪个版本或合并 |

## 冲突解决循环

gitmesh 将冲突解决封装为一个标准的交互式循环。有两种使用方式：

### 方式一：`onConflict`（完全自定义，优先级最高）

适合需要完全控制冲突处理流程的场景。

```
发生冲突
    │
    ▼
构建 ConflictInfo
    │
    ▼
调用 Agent.onConflict(conflict)        ← 你的 Agent 完全控制
    │
    ├─ { resolved: true }
    │       │
    │       ▼
    │   git add（标记已解决）
    │   git rebase --continue
    │       │
    │       ├─ 成功 → 进入合并流程
    │       │
    │       └─ 又冲突 → 再次 onConflict (attempt + 1)
    │                   │
    │                   ├─ attempt < maxRetries → 继续重试
    │                   └─ attempt = maxRetries → 标记失败
    │
    └─ { resolved: false }
            │
            └─ 标记此 Agent 失败，记录 reason
               跳过，保留 worktree 供人工介入
```

### 方式二：`resolveConflict`（内建循环，新增）

gitmesh 自动构建 prompt、管理重试循环，Agent 只需关注解决冲突本身。

```
发生冲突
    │
    ▼
buildConflictPrompt(conflict)   ← gitmesh 自动生成 prompt
    │
    ▼
resolveConflict({              ← 你的 Agent 收到封装好的参数
  worktreePath,                ← 在哪解决
  prompt,                      ← LLM/人类可读的冲突描述
  conflict,                    ← 原始结构化数据
  runPrompt,                   ← 复用原始 session 的函数（需在 AgentDefinition 中设置）
})
    │
    ├─ return（成功）→ { resolved: true }
    │       │
    │       ▼
    │   git add . && git rebase --continue ← gitmesh 自动执行
    │       │
    │       ├─ 成功 → 合并
    │       └─ 又冲突 → 再次 resolveConflict（自动循环）
    │
    └─ throw（失败）→ { resolved: false, reason: ... }
            │
            └─ 标记失败，保留 worktree
```

**优先级规则**：如果同时设置 `onConflict` 和 `resolveConflict`，`onConflict` 生效。

**prompt 自定义**：通过 `conflictPromptOptions` 控制 prompt 生成：

```typescript
{
  resolveConflict: async ({ worktreePath, prompt, conflict, runPrompt }) => {
    // 方式 A：每次都启动新 agent 进程
    await runAgent(worktreePath, prompt);

    // 方式 B：复用 onReady 中创建的 agent session（推荐）
    if (runPrompt) {
      const result = await runPrompt(prompt);
      console.log(`Agent 输出: ${result.output}`);
    }
  },
  conflictPromptOptions: {
    header: "自定义提示头...",   // 覆盖默认头部
    hints: true,                 // 包含追加策略提示（默认 true）
    maxFileContent: 4000,        // 单文件内容截断长度（默认 8000）
  },
}
```

### 手动使用 `buildConflictPrompt()`

`buildConflictPrompt` 也作为公开 API 导出，可在 `onConflict` 模式中手动调用：

```typescript
import { buildConflictPrompt } from "gitmesh";

onConflict: async (conflict) => {
  const prompt = buildConflictPrompt(conflict, {
    header: "你是一个 TypeScript 专家...",
  });
  await runAgent(conflict.worktreePath, prompt);
  return { resolved: true };
}
```

### 复用 Agent Session（`runPrompt`）

默认情况下，每次 `resolveConflict` 触发时，调用方需要启动新的 agent 进程（fork），这会带来冷启动开销和上下文丢失。通过设置 `AgentDefinition.runPrompt`，可以让冲突解决复用 `onReady` 中创建的原始 agent session：

```typescript
// 在 AgentDefinition 中设置 runPrompt
const agent = {
  name: "fix-auth",
  onReady: async (signal) => {
    // 创建并保持 agent session 存活
    const session = createAgentSession({ cwd: signal.worktreePath });
    await session.run(prompt);
    // 不退出 session —— 等待可能的冲突解决
    signal.done();
  },
  // 提供复用 session 的函数
  runPrompt: async (prompt) => {
    const result = await session.sendMessage(prompt);
    return { success: true, output: result.text };
  },
  // resolveConflict 中直接使用 runPrompt
  resolveConflict: async ({ worktreePath, prompt, conflict, runPrompt }) => {
    if (runPrompt) {
      const result = await runPrompt(prompt);
      // result.output 包含 agent 的响应
    }
  },
};
```

**对比**

|                        | 每次 fork 新进程                      | 复用 session（runPrompt）     |
|------------------------|--------------------------------------|------------------------------|
| 进程启动               | fork 新进程（~500ms）                | 使用已有进程                 |
| 上下文                 | 需重新注入项目背景                    | Agent 记住自己的改动          |
| Token 消耗             | 每次重试消耗完整背景 token           | 仅增量 prompt                 |
| 调用方复杂度           | 需管理 ChatAgentOptions + 子进程     | 零配置，一个回调函数          |

> **注意**：`runPrompt` 仅在 `AgentDefinition.runPrompt` 已设置时才能在 `resolveConflict` 的 params 中获取。如果未设置，`params.runPrompt` 为 `undefined`。

## 重试控制

通过 `maxRetries` 控制冲突解决的最大尝试次数：

```typescript
const session = await gitmesh({
  agents: [...],
  maxRetries: 5, // 最多重试 5 次
});
```

每次冲突解决后重试 rebase，如果继续冲突则 attempt 递增。达到上限后，该 Agent 标记为 `failed`。

## 超时控制

冲突解决不是无限等待的。通过 `conflictTimeout` 控制，支持全局和 Agent 级别覆盖：

```typescript
const session = await gitmesh({
  agents: [
    {
      name: "fast-fix",
      conflictTimeout: 180_000, // 此 Agent 专属 3 分钟超时
      // ...
    },
  ],
  conflictTimeout: 120_000, // 全局默认 2 分钟
});
```

超时后抛出 `AgentTimeoutError`，Agent 标记为失败。

> **防御性超时**：`resolveConflict` 模式下，传给 `runPrompt` 的函数会自动包装 5 分钟防御性超时。如果调用方的 `runPrompt` 实现阻塞（如 `sendMessage` 被拒绝后 promise 永久不 resolve），5 分钟内会强制返回 `{ success: false }`，避免空等整个 `conflictTimeout`。

## 失败后的处理

Agent 合并失败后，其 worktree 和分支**不会立即删除**。这允许：

1. **人工介入** — 进入 worktree 手动完成合并
2. **查看 diff** — 检查 Agent 的改动和冲突内容
3. **调试** — 理解为什么自动解决失败

```typescript
const summary = await session.done();

// 查看失败的 Agent
for (const r of summary.results) {
  if (r.status === "failed") {
    console.log(`${r.agentName} 失败: ${r.reason}`);
    // worktree 和分支仍在，可以手动处理
  }
}

// 如果需要清理所有 worktree
await session.abort();
```

## 最佳实践

### 1. 给 Agent 足够的上下文

在 `onConflict` 中构建好的提示词，让 Agent 理解的不仅是冲突标记，还有业务含义：

```typescript
onConflict: async (conflict) => {
  const prompt = `
你正在解决 git rebase 冲突。这是第 ${conflict.attempt}/${conflict.maxRetries} 次尝试。

你的原始任务是：修复 OAuth token 刷新逻辑。
主干的改动来自其他 Agent 的并行修改。

${conflict.files.map(f => `
文件: ${f.path}
- 你的改动: ${f.outgoingDiff}
- 主干改动: ${f.incomingDiff}
- 请编辑文件解决冲突，保留双方有意义的改动。
`).join('\n')}
  `;

  const ok = await runAgent({ prompt, cwd: conflict.worktreePath });
  return { resolved: ok };
};
```

### 2. 实现降级策略

Agent 可能无法自动解决所有冲突。实现降级策略：

```typescript
onConflict: async (conflict) => {
  // 先尝试自动解决
  let ok = await tryAutoResolve(conflict);

  if (!ok && conflict.attempt < conflict.maxRetries) {
    // 再尝试用更强大的模型解决
    ok = await tryWithBetterModel(conflict);
  }

  if (!ok) {
    // 放弃，等待人工介入
    await notifyHuman(conflict);
    return { resolved: false, reason: "需要人工解决" };
  }

  return { resolved: true };
};
```

### 3. 记录冲突日志

```typescript
import fs from "fs";

session.on("mesh:conflict", (info) => {
  fs.appendFileSync("conflicts.log", JSON.stringify({
    time: new Date().toISOString(),
    agent: info.agentName,
    files: info.files.map(f => f.path),
    attempt: info.attempt,
  }) + "\n");
});
```

## 下一步

- [Agent 协议](./agent-protocol.md) — Agent 接入的完整说明
- [事件系统](./events.md) — 通过事件监控冲突解决进度
- [错误处理](./error-handling.md) — 错误类型和处理方式
