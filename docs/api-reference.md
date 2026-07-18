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
| `workspaceDir` | `string` | 否 | `"../.gitmesh-workspaces"` | worktree 存储目录（相对于 `cwd` 的绝对路径）。每个 Agent 的 worktree 路径为 `{workspaceDir}/{agentName}` |
| `trunkBranch` | `string` | 否 | `"main"` | 主干分支名 |
| `branchPrefix` | `string` | 否 | `"mesh/"` | Agent 分支名前缀 |
| `workspaceDir` | `string` | 否 | `"../.gitmesh-workspaces"` | worktree 存储目录。相对于 `cwd` 解析为绝对路径。每个 Agent 的 worktree 路径为 `{workspaceDir}/{agentName}`。默认为仓库父目录下的 `.gitmesh-workspaces/` |
| `onMerged` | `(name: string, commit: string) => void` | 否 | — | Agent 合并成功回调 |
| `onFailed` | `(name: string, reason: string, worktreePath: string) => void` | 否 | — | Agent 合并失败回调 |
| `onConflict` | `(info: ConflictInfo) => void` | 否 | — | 冲突通知回调 |
| `onDone` | `(summary: SessionSummary) => void` | 否 | — | Session 结束回调 |
| `onBeforeRebase` | `(agentName: string, worktreePath: string) => void \| Promise<void>` | 否 | — | 首次 rebase 前调用（仅一次），允许调用方清理 worktree |
| `onBeforeMerge` | `() => void \| Promise<void>` | 否 | — | 每次 merge 前调用，允许调用方清理 working tree |
| `mergeMode` | `"full"` \| `"ref-only"` | 否 | `"full"` | 合并模式：`"full"` 执行完整 git merge；`"ref-only"` 仅更新 ref，不碰 working tree |

**返回值**

返回 `Promise<Session>`，resolve 时 session 已启动（worktree 已创建，Agent 已开始工作）。

**示例**

```typescript
const session = await gitmesh({
  cwd: "/path/to/repo",
  agents: [
    {
      name: "fix-auth",
      onReady: (signal) => {
        runAgent({ cwd: signal.worktreePath }).then((ok) => {
          if (ok) signal.done().then((merged) => {
            console.log(merged ? "已合并" : "合并失败");
          });
        });
      },
      onConflict: async (conflict) => {
        return { resolved: true };
      },
    },
  ],
  onMerged: (name, commit) => {
    console.log(`${name} 已合并: ${commit}`);
  },
  onFailed: (name, reason, worktreePath) => {
    console.log(`${name} 失败: ${reason}`);
  },
  onDone: (summary) => {
    console.log(`Session 完成: ${summary.status}`);
  },
});
```

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
  /** Agent 合并成功时调用 */
  onMerged?: (name: string, commit: string) => void;
  /** Agent 合并失败时调用 */
  onFailed?: (name: string, reason: string, worktreePath: string) => void;
  /** 发生冲突时调用 */
  onConflict?: (info: ConflictInfo) => void;
  /** Session 结束时调用 */
  onDone?: (summary: SessionSummary) => void;
  /**
   * 每次 rebase 前调用，允许调用方清理 worktree。
   *
   * 在首次 git rebase 尝试之前触发（仅调用一次，后续重试不触发）。
   * 适用于 Agent 修改了文件但未 commit 的场景（如 auto-commit）。
   *
   * 注意：此回调在每个 agent 的生命周期中恰好调用一次。
   * 如果 rebase 因 trunk 变更或错误而重试，不会再次调用。
   *
   * @param agentName  触发 rebase 的 Agent 名称
   * @param worktreePath Agent 的 worktree 路径
   */
  onBeforeRebase?: (agentName: string, worktreePath: string) => void | Promise<void>;
  /**
   * 每次 merge 前调用，允许调用方清理 working tree。
   *
   * 在获取 merge lock 之后、执行 git merge 之前触发。
   * 适用于主仓库有编译产物、编辑器临时文件等脏文件需要清理的场景。
   */
  onBeforeMerge?: () => void | Promise<void>;
  /**
   * 合并模式。
   *
   * - `'full'`（默认）：git checkout + git merge --ff-only，会更新 working tree
   * - `'ref-only'`：仅通过 git update-ref 更新 ref，不触及 working tree 或 index。
   *   调用方需自行负责同步 working tree（如 git checkout / git reset）。
   */
  mergeMode?: "full" | "ref-only";
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
  /** Agent 工作回调（fire-and-forget：gitmesh 启动后立即返回，不等待 resolve） */
  onReady: (signal: AgentWorkDoneSignal) => void;
  /** 冲突解决回调（完全自定义模式，优先级最高） */
  onConflict?: (conflict: ConflictInfo) => Promise<ResolutionResult>;
  /** 自动冲突解决回调（内建循环模式）。gitmesh 自动构建 prompt、管理重试 */
  resolveConflict?: (params: ConflictResolutionParams) => Promise<void>;
  /** 向 agent session 发送后续消息，复用现有 session 而不是启动新进程 */
  runPrompt?: (prompt: string) => Promise<RunPromptResult>;
  /** resolveConflict 模式下的 prompt 自定义选项 */
  conflictPromptOptions?: ConflictPromptOptions;
  /**
   * 冲突策略。默认 "route-to-agent"。
   *
   * - `"route-to-agent"`：冲突时路由回 agent 回调解决（默认）
   * - `"accept-agent"`：冲突时保留 agent 版本，跳过回调
   * - `"accept-trunk"`：冲突时保留主干版本，跳过回调
   */
  conflictStrategy?: "route-to-agent" | "accept-agent" | "accept-trunk";
  /**
   * 合并策略。默认 "ff-only"。
   *
   * - `"ff-only"`：fast-forward merge，保留 agent 的所有 commits
   * - `"squash"`：将所有 agent commits 压缩为一条 commit
   */
  mergeStrategy?: "ff-only" | "squash";
  /** squash merge 的 commit message。mergeStrategy 为 "squash" 时必填 */
  squashMessage?: string;
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 唯一标识，用于 worktree 目录和分支命名 |
| `baseRef` | `string` | 否 | 基于哪个 ref 创建工作区，默认使用 `trunkBranch` |
| `onReady` | `(signal) => void` | 是 | 工作区就绪时调用（fire-and-forget），Agent 完成编码后需调用 `signal.done()` |
| `onConflict` | 回调 | 否 | 冲突发生时调用（优先级最高），需返回 `ResolutionResult` |
| `resolveConflict` | 回调 | 否 | 自动冲突解决（内建循环），仅在未设置 `onConflict` 时生效 |
| `runPrompt` | 回调 | 否 | 设置后被透传到 `resolveConflict` 的 params 中，可复用 agent session |
| `conflictPromptOptions` | 对象 | 否 | `resolveConflict` 模式下的 prompt 自定义选项 |
| `conflictStrategy` | `"route-to-agent"` \| `"accept-agent"` \| `"accept-trunk"` | 否 | 冲突策略。默认路由回 agent；可设为直接选择版本，跳过回调 |
| `mergeStrategy` | `"ff-only"` \| `"squash"` | 否 | 合并策略。默认 fast-forward；squash 将 commits 压缩为一条 |
| `squashMessage` | `string` | 条件必填 | `mergeStrategy` 为 `"squash"` 时的 commit message |

---

## AgentWorkDoneSignal

```typescript
interface AgentWorkDoneSignal {
  /** Agent 名称 */
  agentName: string;
  /** worktree 的绝对路径 */
  worktreePath: string;
  /** 调用此方法通知 gitmesh：Agent 已完成，开始合并
   *  @returns Promise<boolean> — true 表示成功合入主干，false 表示合并失败 */
  done: () => Promise<boolean>;
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

中断 session。清理所有 worktree 和分支，将未完成的 Agent 标记为失败，并触发 `session:done` 事件。

**`abort()` 和 `done()` 互斥**：调用一个后，另一个会立即返回缓存结果（不再执行实际操作）。可以安全地在 `done()` 等待期间调用 `abort()` 来中断 session——`done()` 会正常返回而不会挂起。

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
  /** worktree 所在路径 */
  worktreePath: string;
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

## ConflictResolutionParams

`resolveConflict` 回调收到的参数对象。

```typescript
interface ConflictResolutionParams {
  /** Agent 应在哪个目录内解决冲突（worktree 路径） */
  worktreePath: string;
  /** 人类/LLM 可读的冲突描述，由 gitmesh 根据 ConflictInfo 自动生成 */
  prompt: string;
  /** 原始结构化冲突信息，供程序化处理 */
  conflict: ConflictInfo;
  /**
   * 向原始 agent session 发送后续消息，复用现有 session。
   * 仅在 AgentDefinition.runPrompt 已设置时可用。
   */
  runPrompt?: (prompt: string) => Promise<RunPromptResult>;
}
```

---

## RunPromptResult

`runPrompt` 函数的返回值。

```typescript
interface RunPromptResult {
  /** 是否成功 */
  success: boolean;
  /** Agent 输出文本 */
  output: string;
}
```

---

## ConflictPromptOptions

`resolveConflict` 模式下 prompt 生成的自定义选项。

```typescript
interface ConflictPromptOptions {
  /** 自定义 prompt 头部文本，覆盖默认的冲突描述头 */
  header?: string;
  /** 是否包含追加策略提示（如检测到双发都是追加新行时提示合并）。默认 true */
  hints?: boolean;
  /** 单个文件内容的最大字符数，超过则截断。默认 8000 */
  maxFileContent?: number;
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
  "mesh:failed": (name: string, reason: string, worktreePath: string) => void;
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

// 工具函数
export {
  buildConflictPrompt,
  autoResolveConflicts,
  checkWorkingTreeClean,
  fastForwardMerge,
  refOnlyMerge,
  canFastForward,
  squashMerge,
} from "gitmesh";

// 类型
export type {
  GitmeshOptions,
  AgentDefinition,
  AgentWorkDoneSignal,
  AgentResolveConflict,
  ConflictResolutionParams,
  ConflictPromptOptions,
  RunPromptResult,
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
  ConflictStrategy,
  MergeStrategyType,
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
