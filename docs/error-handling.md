# 错误处理

gitmesh 提供了一组结构化错误类，让你可以精确捕获和处理不同类型的错误。

## 错误类层次

所有 gitmesh 错误均继承自基础错误类 `GitmeshError`：

```
GitmeshError（继承自 Error）
├── WorktreeError
│   ├── WorktreeCreateError
│   └── WorktreeRemoveError
├── MergeEngineError
│   ├── RebaseError
│   ├── MergeError
│   └── StrategyError
├── AgentError
│   ├── AgentTimeoutError
│   ├── AgentResolveError
│   └── AgentAbandonError
└── SessionError
    └── SessionInterrupted
```

所有错误携带 `cause` 属性，保留原始错误链（通常是 git 命令的错误输出）。

## 错误详解

### GitmeshError

基类，所有 gitmesh 错误的根。

```typescript
class GitmeshError extends Error {
  name: "GitmeshError";
  cause?: unknown; // 原始错误
}
```

---

### WorktreeError

worktree 操作失败。

```typescript
class WorktreeError extends GitmeshError {
  name: "WorktreeError";
}

class WorktreeCreateError extends WorktreeError {
  // 创建 worktree 失败
  // 常见原因：磁盘空间不足、权限问题、git 版本过低
}

class WorktreeRemoveError extends WorktreeError {
  // 删除 worktree 失败
  // 常见原因：worktree 中有未保存的更改、路径被占用
}
```

**处理方式**：

```typescript
import { WorktreeCreateError } from "gitmesh";

try {
  await gitmesh({ agents: [...] });
} catch (err) {
  if (err instanceof WorktreeCreateError) {
    console.error("创建 worktree 失败:", err.message);
    console.error("原因:", err.cause);
  }
}
```

---

### MergeEngineError

合并引擎错误。

```typescript
class MergeEngineError extends GitmeshError {}

class RebaseError extends MergeEngineError {
  // rebase 失败（冲突以外的原因）
  // 例如：rebase 过程中遇到意外的 git 状态
}

class MergeError extends MergeEngineError {
  // 合并写入主干失败
  // 例如：主干被其他进程修改、文件锁异常
}

class StrategyError extends MergeEngineError {
  // 策略执行异常
  // 例如：未知策略名、策略内部状态错误
}
```

**处理方式**：

```typescript
import { RebaseError, MergeError } from "gitmesh";

session.on("mesh:failed", (name, reason) => {
  // reason 是字符串，包含错误描述
  console.error(`${name} 失败: ${reason}`);
});

// SessionSummary 中也包含失败原因
const summary = await session.done();
for (const r of summary.results) {
  if (r.status === "failed") {
    console.log(`${r.agentName}: ${r.reason}`);
  }
}
```

---

### AgentError

Agent 侧错误。

```typescript
class AgentError extends GitmeshError {}

class AgentTimeoutError extends AgentError {
  // Agent 解决冲突超时
  // 超时时间由 conflictTimeout 参数控制
}

class AgentResolveError extends AgentError {
  // Agent 返回了异常结果
  // 例如：onConflict 抛出未捕获的异常
}

class AgentAbandonError extends AgentError {
  // Agent 主动放弃解决冲突
  // 即 onConflict 返回 { resolved: false }
}
```

**处理方式**：

```typescript
import { AgentTimeoutError, AgentAbandonError } from "gitmesh";

session.on("mesh:failed", (name, reason) => {
  console.error(`${name} 失败: ${reason}`);
  // "Agent 放弃解决冲突: 需要人工介入"
  // "冲突解决超时 (600s)"
});
```

---

### SessionError

Session 级别错误。

```typescript
class SessionError extends GitmeshError {}

class SessionInterrupted extends SessionError {
  // 外部中断（SIGINT 等）
  // 或调用 session.abort() 后仍有 Agent 未完成
}
```

**处理方式**：

```typescript
import { SessionError, SessionInterrupted } from "gitmesh";

try {
  const session = await gitmesh({ agents: [...] });
  const summary = await session.done();
} catch (err) {
  if (err instanceof SessionInterrupted) {
    console.log("Session 被中断");
    // 可能需要手动清理
  } else if (err instanceof SessionError) {
    console.error("Session 错误:", err.message);
  }
}
```

## 捕获模式

### 启动阶段错误

`gitmesh()` 调用本身会验证 git 环境和参数，这个阶段的错误直接 throw：

```typescript
try {
  const session = await gitmesh({
    cwd: "/path/to/non-existent-repo",
    agents: [...],
  });
} catch (err) {
  // git 环境验证失败
  // 参数校验失败
  // worktree 创建失败
  console.error("启动失败:", err);
}
```

### 运行阶段

Session 启动后的错误通过事件和 `SessionSummary` 暴露，不会 throw：

```typescript
const session = await gitmesh({ agents: [...] });

// 方式 1：通过事件
session.on("mesh:failed", (name, reason) => {
  console.error(`${name}: ${reason}`);
});

// 方式 2：通过结果摘要
const summary = await session.done();
for (const r of summary.results) {
  if (r.status !== "merged") {
    console.error(`${r.agentName}: ${r.reason}`);
  }
}
```

### 中断处理

```typescript
// 监听 SIGINT
process.on("SIGINT", async () => {
  console.log("\n正在清理...");
  await session.abort("用户中断");
  process.exit(1);
});
```

## 错误恢复

### 单个 Agent 失败不影响其他

gitmesh 的核心设计之一：单个 Agent 失败不阻塞其他 Agent。你不需要额外处理。

### 从失败中恢复

Agent 失败后，worktree 和分支保留。你可以：

```typescript
const summary = await session.done();

for (const r of summary.results) {
  if (r.status === "failed") {
    // 方案 1：人工进入 worktree 手动合并
    console.log(`${r.agentName} 失败，请手动处理`);

    // 方案 2：重新启动一个新的 session，仅包含失败的 Agent
    // （在原始仓库中，失败的 Agent 分支仍然存在）
  }
}

// 确认不需要 worktree 后，清理
await session.abort();
```

## 最佳实践

### 1. 始终监听 mesh:failed

```typescript
session.on("mesh:failed", (name, reason) => {
  // 记录失败信息，用于后续排查
  logger.error({ agent: name, reason }, "Agent 合并失败");
});
```

### 2. 设置合理的超时

```typescript
const session = await gitmesh({
  agents: [...],
  conflictTimeout: 120_000, // 2 分钟 — 大模型 Agent 可能需要更长时间
  maxRetries: 3,
});
```

### 3. 检查 SessionSummary

不要只依赖事件，`session.done()` 的返回值是最终的权威结果：

```typescript
const summary = await session.done();

if (summary.status === "failed") {
  // 所有 Agent 都失败了 — 可能是系统性问题
  console.error("所有 Agent 均失败，请检查 git 环境和仓库状态");
}

if (summary.status === "partial") {
  // 部分失败 — 检查具体哪些 Agent 失败
  const failed = summary.results.filter(r => r.status !== "merged");
  console.warn(`${failed.length} 个 Agent 失败`);
}
```

## 下一步

- [API 参考](./api-reference.md) — 所有错误类的完整定义
- [高级用法](./advanced-usage.md) — 错误恢复和重试模式
