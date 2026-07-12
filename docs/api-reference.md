# API 参考

完整的 API 类型和函数文档。

## 入口函数

### `gitmesh(options)`

创建并启动一个 gitmesh session。

```typescript
function gitmesh(options: GitmeshOptions): Promise<Session>;
```

**参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `cwd` | `string` | 否 | `process.cwd()` | 仓库根目录 |
| `agents` | `AgentDefinition[]` | 是 | — | Agent 定义列表 |
| `strategy` | `"rebase-first"` \| `"sequential"` | 否 | `"rebase-first"` | 合并策略 |
| `maxRetries` | `number` | 否 | `3` | 每个 Agent 最大重试次数 |
| `conflictTimeout` | `number` | 否 | `600_000` | 冲突解决超时（毫秒） |
| `workspaceDir` | `string` | 否 | `"../.gitmesh-workspaces"` | worktree 存储目录 |
| `trunkBranch` | `string` | 否 | `"main"` | 主干分支名 |
| `branchPrefix` | `string` | 否 | `"mesh/"` | Agent 分支名前缀 |

**返回值**

返回 `Promise<Session>`，resolve 时 session 已启动（worktree 已创建，Agent 已开始工作）。

---

## GitmeshOptions

```typescript
interface GitmeshOptions {
  /** 仓库根目录，默认 process.cwd() */
  cwd?: string;
  /** Agent 定义 */
  agents: AgentDefinition[];
  /** 合并策略，默认 "rebase-first" */
  strategy?: "rebase-first" | "sequential";
  /** 每个 Agent 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 冲突解决超时（毫秒），默认 600_000（10 分钟） */
  conflictTimeout?: number;
  /** worktree 存储目录，默认 "../.gitmesh-workspaces" */
  workspaceDir?: string;
  /** 主干分支名，默认 "main" */
  trunkBranch?: string;
  /** Agent 分支名前缀，默认 "mesh/" */
  branchPrefix?: string;
}
```

---

## AgentDefinition

```typescript
interface AgentDefinition {
  /** 唯一名称，用作 worktree 目录名和分支名的一部分 */
  name: string;
  /** 基于哪个 ref 创建工作区，默认 trunkBranch */
  baseRef?: string;
  /** Agent 工作完成回调 */
  onReady: (signal: AgentWorkDoneSignal) => void | Promise<void>;
  /** 冲突解决回调 */
  onConflict: (conflict: ConflictInfo) => Promise<ResolutionResult>;
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 唯一标识，用于 worktree 目录和分支命名 |
| `baseRef` | `string` | 否 | 基于哪个 ref 创建工作区，默认使用 `trunkBranch` |
| `onReady` | 回调 | 是 | 工作区就绪时调用，Agent 完成编码后需调用 `signal.done()` |
| `onConflict` | 回调 | 是 | 冲突发生时调用，需返回 `ResolutionResult` |

---

## AgentWorkDoneSignal

```typescript
interface AgentWorkDoneSignal {
  /** Agent 名称 */
  agentName: string;
  /** worktree 的绝对路径 */
  worktreePath: string;
  /** 调用此方法通知 gitmesh：Agent 已完成，可以合并 */
  done: () => void;
}
```

---

## Session

```typescript
interface Session {
  on<E extends keyof SessionEvents>(event: E, handler: SessionEvents[E]): void;
  off<E extends keyof SessionEvents>(event: E, handler: SessionEvents[E]): void;
  done(): Promise<SessionSummary>;
  abort(reason?: string): Promise<void>;
}
```

### `session.on(event, handler)`

监听事件。返回 `void`。

### `session.off(event, handler)`

移除事件监听。返回 `void`。

### `session.done()`

等待所有 Agent 完成（或失败），返回结果摘要。

```typescript
const summary: SessionSummary = await session.done();
```

### `session.abort(reason?)`

中断 session。清理所有 worktree 和分支。

```typescript
await session.abort("用户取消");
```

---

## SessionSummary

```typescript
interface SessionSummary {
  /** 整体状态 */
  status: "success" | "partial" | "failed";
  /** 每个 Agent 的结果 */
  results: AgentResult[];
  /** 最终主干 HEAD commit hash */
  trunkHead: string;
}
```

| status | 说明 |
|--------|------|
| `"success"` | 所有 Agent 成功合并 |
| `"partial"` | 部分成功，部分失败 |
| `"failed"` | 所有 Agent 均失败 |

---

## AgentResult

```typescript
interface AgentResult {
  /** Agent 名称 */
  agentName: string;
  /** 合并结果 */
  status: "merged" | "failed" | "abandoned";
  /** 合并后的主干 commit（仅 merged 时有值） */
  mergeCommit?: string;
  /** 失败原因（仅 failed/abandoned 时有值） */
  reason?: string;
  /** worktree 是否已清理 */
  cleaned: boolean;
}
```

| status | 说明 |
|--------|------|
| `"merged"` | 成功合入主干 |
| `"failed"` | 合并失败（重试耗尽或 Agent 放弃） |
| `"abandoned"` | Agent 主动放弃 |

---

## ConflictInfo

```typescript
interface ConflictInfo {
  /** Agent 名称 */
  agentName: string;
  /** 发生冲突的文件列表 */
  files: ConflictFile[];
  /** 当前 rebase 尝试次数（从 1 开始） */
  attempt: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** rebase 的目标 commit（主干当前 HEAD） */
  targetCommit: string;
  /** Agent 分支的当前 commit */
  sourceCommit: string;
  /** worktree 路径，Agent 在此目录内解决冲突 */
  worktreePath: string;
}
```

---

## ConflictFile

```typescript
interface ConflictFile {
  /** 相对于仓库根目录的文件路径 */
  path: string;
  /** 冲突状态 */
  status:
    | "conflicted"
    | "deleted-by-us"
    | "deleted-by-them"
    | "deleted-by-both"
    | "added-by-both";
  /** 冲突内容（含 <<<<<<< ======= >>>>>>> 标记） */
  content: string;
  /** 主干侧改了什么 */
  incomingDiff: string;
  /** Agent 侧改了什么 */
  outgoingDiff: string;
}
```

| status | 说明 |
|--------|------|
| `"conflicted"` | 双方修改同一文件内容 |
| `"deleted-by-us"` | Agent 删除了文件，主干修改了它 |
| `"deleted-by-them"` | 主干删除了文件，Agent 修改了它 |
| `"deleted-by-both"` | 双方都删除了文件 |
| `"added-by-both"` | 双方都新增了同名文件 |

---

## ResolutionResult

```typescript
interface ResolutionResult {
  /** 是否已解决 */
  resolved: boolean;
  /** 如无法解决，说明原因 */
  reason?: string;
}
```

---

## WorktreeInfo

```typescript
interface WorktreeInfo {
  /** worktree 名称（即 Agent 名称） */
  name: string;
  /** worktree 目录的绝对路径 */
  path: string;
  /** 对应的 git 分支名 */
  branch: string;
  /** 当前 HEAD commit hash */
  head: string;
}
```

---

## SessionEvents

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

详见 [事件系统](./events.md)。

---

## 错误类型

所有错误均继承自 `GitmeshError`：

```
GitmeshError
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

详见 [错误处理](./error-handling.md)。

## 导出清单

```typescript
// 从 gitmesh 导出的所有公开符号

// 入口函数
export { gitmesh, default } from "gitmesh";

// 类型
export type {
  GitmeshOptions,
  AgentDefinition,
  AgentWorkDoneSignal,
  AgentResolveConflict,
  Session,
  SessionSummary,
  AgentResult,
  SessionEvents,
  ConflictInfo,
  ConflictFile,
  ResolutionResult,
  WorktreeInfo,
  WorktreeStatus,
  MergeStrategyName,
} from "gitmesh";

// 错误类
export {
  GitmeshError,
  WorktreeError,
  WorktreeCreateError,
  WorktreeRemoveError,
  MergeEngineError,
  RebaseError,
  MergeError,
  StrategyError,
  AgentError,
  AgentTimeoutError,
  AgentResolveError,
  AgentAbandonError,
  SessionError,
  SessionInterrupted,
} from "gitmesh";
```
