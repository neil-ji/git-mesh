# 事件系统

gitmesh 提供完整的 typed 事件系统，让你可以观测 session 的每一步进展。

## 事件类型

```typescript
type SessionEvents = {
  "worktree:ready": (info: WorktreeInfo) => void;
  "agent:done": (name: string) => void;
  "mesh:rebase": (name: string) => void;
  "mesh:conflict": (info: ConflictInfo) => void;
  "mesh:retry": (name: string, attempt: number) => void;
  "mesh:merged": (name: string, commit: string) => void;
  "mesh:failed": (name: string, reason: string) => void;
  "session:done": (summary: SessionSummary) => void;
};
```

## 事件详解

### worktree:ready

worktree 创建完成，Agent 可以开始工作。

```typescript
session.on("worktree:ready", (info: WorktreeInfo) => {
  // info.name   — Agent 名称
  // info.path   — worktree 目录路径
  // info.branch — git 分支名
  // info.head   — 初始 HEAD commit

  console.log(`[${info.name}] 工作区就绪: ${info.path}`);
});
```

**触发时机**：每个 Agent 的 worktree 创建成功后立即触发。

### agent:done

Agent 完成编码工作，通知 gitmesh 可以开始合并。

```typescript
session.on("agent:done", (name: string) => {
  console.log(`[${name}] 编码完成，进入合并队列`);
});
```

**触发时机**：Agent 调用 `signal.done()` 后触发。

### mesh:rebase

开始对 Agent 分支执行 rebase。

```typescript
session.on("mesh:rebase", (name: string) => {
  console.log(`[${name}] 开始 rebase 到主干...`);
});
```

**触发时机**：合并引擎开始执行 rebase 时。

### mesh:conflict

rebase 过程中发生冲突。

```typescript
session.on("mesh:conflict", (info: ConflictInfo) => {
  console.log(`[${info.agentName}] 冲突！${info.files.length} 个文件`);
  console.log(`  第 ${info.attempt}/${info.maxRetries} 次尝试`);

  for (const f of info.files) {
    console.log(`  - ${f.path} (${f.status})`);
  }
});
```

**触发时机**：`git rebase` 返回冲突状态时。

### mesh:retry

Agent 解决了冲突，重试 rebase。

```typescript
session.on("mesh:retry", (name: string, attempt: number) => {
  console.log(`[${name}] 冲突已解决，重试 rebase（第 ${attempt} 次）`);
});
```

**触发时机**：Agent 返回 `{ resolved: true }` 后，gitmesh 重新执行 rebase。

### mesh:merged

Agent 代码成功合入主干。

```typescript
session.on("mesh:merged", (name: string, commit: string) => {
  console.log(`[${name}] ✅ 已合并, commit: ${commit.slice(0, 7)}`);
});
```

**触发时机**：rebase 成功后 fast-forward 合入主干，返回主干的新 commit hash。

### mesh:failed

Agent 合并失败。

```typescript
session.on("mesh:failed", (name: string, reason: string) => {
  console.log(`[${name}] ❌ 合并失败: ${reason}`);
  // reason 可能是:
  //   "Agent 放弃解决冲突: 需要人工介入"
  //   "重试次数耗尽（3/3）"
  //   "冲突解决超时"
  //   "rebase 失败: <git error>"
});
```

**触发时机**：
- Agent 返回 `{ resolved: false }`
- 重试次数达到 `maxRetries`
- 冲突解决超时
- 合并写入主干失败

### session:done

所有 Agent 处理完毕。

```typescript
session.on("session:done", (summary: SessionSummary) => {
  console.log(`全部完成: ${summary.status}`);
  console.log(`主干 HEAD: ${summary.trunkHead}`);

  const merged = summary.results.filter(r => r.status === "merged");
  const failed = summary.results.filter(r => r.status !== "merged");

  console.log(`成功: ${merged.length}, 失败: ${failed.length}`);
});
```

**触发时机**：最后一个 Agent 完成（成功或失败）后触发。

## 典型用法

### 进度追踪

```typescript
const progress = new Map<string, string>();

session.on("worktree:ready", (info) =>
  progress.set(info.name, "编码中"));

session.on("agent:done", (name) =>
  progress.set(name, "等待合并"));

session.on("mesh:rebase", (name) =>
  progress.set(name, "变基中"));

session.on("mesh:conflict", (info) =>
  progress.set(info.agentName, `解决冲突 (${info.attempt}/${info.maxRetries})`));

session.on("mesh:merged", (name) =>
  progress.set(name, "已完成"));

session.on("mesh:failed", (name) =>
  progress.set(name, "失败"));

// 定期打印进度
const timer = setInterval(() => {
  console.clear();
  for (const [name, status] of progress) {
    console.log(`${name}: ${status}`);
  }
}, 1000);

session.on("session:done", () => clearInterval(timer));
```

### 通知系统

```typescript
session.on("mesh:merged", async (name, commit) => {
  await sendSlackMessage(`✅ ${name} 已合并`);
});

session.on("mesh:failed", async (name, reason) => {
  await sendSlackMessage(`❌ ${name} 合并失败: ${reason}`);
});

session.on("mesh:conflict", async (info) => {
  if (info.attempt === info.maxRetries) {
    await sendSlackMessage(`⚠️ ${info.agentName} 冲突解决已达上限，即将失败`);
  }
});
```

### 日志记录

```typescript
const log = fs.createWriteStream("gitmesh.log", { flags: "a" });

session.on("worktree:ready", (info) =>
  log.write(`${Date.now()} worktree:ready ${info.name} ${info.path}\n`));

session.on("mesh:merged", (name, commit) =>
  log.write(`${Date.now()} mesh:merged ${name} ${commit}\n`));

session.on("mesh:failed", (name, reason) =>
  log.write(`${Date.now()} mesh:failed ${name} ${reason}\n`));

session.on("session:done", () => log.end());
```

## 事件生命周期

```
worktree:ready  ───  每个 Agent 一次
    │
    ▼
  (Agent 工作中...)
    │
    ▼
agent:done      ───  每个 Agent 一次
    │
    ▼
mesh:rebase     ───  每次尝试 rebase 时
    │
    ├── mesh:conflict  ───  发生冲突时（可能多次）
    │       │
    │       └── mesh:retry   ───  冲突解决后重试
    │              │
    │              └── 循环回到 mesh:rebase 或到 mesh:failed
    │
    ├── mesh:merged    ───  成功合并（一次）
    │
    └── mesh:failed    ───  合并失败（一次）
         │
         ▼
session:done    ───  全部完成（一次）
```

**一个正常的 Agent 流程**：
```
worktree:ready → agent:done → mesh:rebase → mesh:merged
```

**一个遇到一次冲突的 Agent 流程**：
```
worktree:ready → agent:done → mesh:rebase → mesh:conflict → mesh:retry → mesh:rebase → mesh:merged
```

**一个失败的 Agent 流程**：
```
worktree:ready → agent:done → mesh:rebase → mesh:conflict → mesh:retry → mesh:rebase → mesh:conflict → ... → mesh:failed
```

## 下一步

- [错误处理](./error-handling.md) — 错误类型和处理方式
- [API 参考](./api-reference.md) — 完整的事件类型定义
