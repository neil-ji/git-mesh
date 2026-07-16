// === 入口 ===

export type MergeStrategyName = "rebase-first" | "sequential";

/** 冲突策略 */
export type ConflictStrategy = "route-to-agent" | "accept-agent" | "accept-trunk";

/** 合并策略类型 */
export type MergeStrategyType = "ff-only" | "squash";

export interface GitmeshOptions {
  /** 仓库根目录，默认 process.cwd() */
  cwd?: string;
  /** Agent 定义 */
  agents: AgentDefinition[];
  /** 合并策略，默认 "rebase-first" */
  strategy?: MergeStrategyName;
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
  /** Agent 成功合并回调，免去事件注册的时序问题 */
  onMerged?: (name: string, commit: string) => void;
  /** Agent 合并失败回调 */
  onFailed?: (name: string, reason: string, worktreePath: string) => void;
  /** 检测到冲突时回调 */
  onConflict?: (info: ConflictInfo) => void;
  /** Session 完成回调 */
  onDone?: (summary: SessionSummary) => void;
  /**
   * 每次 rebase 前调用，允许调用方清理 worktree。
   *
   * 在 worktree 内执行 git rebase 之前触发。
   * 适用于 Agent 修改了文件但未 commit 的场景（如 linter 自动修复）。
   */
  onBeforeRebase?: () => void | Promise<void>;
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
   *   适用于主仓库有脏文件且无法或不方便清理的场景。
   */
  mergeMode?: "full" | "ref-only";
}

// === 冲突解决（resolveConflict 模式） ===

/**
 * 冲突描述 prompt 的可自定义选项。
 * 仅用于 resolveConflict 模式，不适用于 onConflict（用户手写 prompt）。
 */
export interface ConflictPromptOptions {
  /** 自定义 prompt 头部文本，覆盖默认的冲突描述头 */
  header?: string;
  /** 是否包含追加策略提示（如检测到双发都是追加新行时提示合并）。默认 true */
  hints?: boolean;
  /** 单个文件内容的最大字符数，超过则截断。默认 8000 */
  maxFileContent?: number;
}

/**
 * runPrompt 的返回值。
 * 在 resolveConflict 中使用 runPrompt 向原始 agent session 发送消息时返回。
 */
export interface RunPromptResult {
  /** 是否成功 */
  success: boolean;
  /** Agent 输出文本 */
  output: string;
}

/**
 * resolveConflict 回调的参数。
 * gitmesh 自动构建 prompt 后传入，Agent 只需关注解决冲突本身。
 */
export interface ConflictResolutionParams {
  /** Agent 应在哪个目录内解决冲突（worktree 路径） */
  worktreePath: string;
  /** 人类/LLM 可读的冲突描述，由 gitmesh 根据 ConflictInfo 自动生成 */
  prompt: string;
  /** 原始结构化冲突信息，供程序化处理 */
  conflict: ConflictInfo;
  /**
   * 向原始 agent session 发送后续消息，复用现有 session 而不是启动新进程。
   * 仅在 AgentDefinition.runPrompt 已设置时可用。
   *
   * 对比每次冲突都 fork 新进程：
   * - 无冷启动开销（~500ms）
   * - Agent 记住自己的改动，无需重新注入项目背景
   * - 只需增量 prompt，不消耗完整背景 token
   */
  runPrompt?: (prompt: string) => Promise<RunPromptResult>;
}

// === Agent ===

export interface AgentDefinition {
  /** 唯一名称，用作 worktree 目录名和分支名的一部分 */
  name: string;
  /** 基于哪个 ref 创建工作区，默认 trunkBranch */
  baseRef?: string;
  /** Agent 工作完成回调，调用方在此通知 gitmesh */
  onReady: (signal: AgentWorkDoneSignal) => void | Promise<void>;
  /**
   * 冲突解决回调（完全自定义模式，优先级最高）。
   *
   * 如果同时设置 onConflict 和 resolveConflict，onConflict 优先生效。
   * 返回 { resolved: true } 通知 gitmesh 继续 rebase；
   * 返回 { resolved: false } 放弃本次合并。
   */
  onConflict?: AgentResolveConflict;
  /**
   * 自动冲突解决回调（内建循环模式）。
   *
   * gitmesh 在检测到冲突时自动：
   * 1. 调用 buildConflictPrompt() 构建冲突描述
   * 2. 调用此函数，传入 { worktreePath, prompt, conflict }
   * 3. Agent 解决冲突后 return（不需要 git add，gitmesh 自动处理）
   * 4. gitmesh 执行 git rebase --continue
   * 5. 如果还有后续冲突，自动重试（循环），最多 maxRetries 次
   *
   * 仅在未设置 onConflict 时生效。
   */
  resolveConflict?: (params: ConflictResolutionParams) => Promise<void>;
  /** resolveConflict 模式下的 prompt 自定义选项 */
  conflictPromptOptions?: ConflictPromptOptions;
  /**
   * 向 agent session 发送后续消息的函数。
   * 设置后，此函数会被透传到 resolveConflict 的 params.runPrompt，
   * 使冲突解决可以复用原始 agent session，而无需每次重试都启动新进程。
   *
   * @example
   * ```typescript
   * runPrompt: async (prompt) => {
   *   // 向已在运行的 agent session 发送消息
   *   const response = await agentSession.sendMessage(prompt);
   *   return { success: true, output: response.text };
   * }
   * ```
   */
  runPrompt?: (prompt: string) => Promise<RunPromptResult>;
  /**
   * 冲突策略。默认 "route-to-agent"。
   *
   * - `"route-to-agent"`：冲突时路由回 agent 回调解决（默认）
   * - `"accept-agent"`：冲突时保留 agent 版本，跳过回调，直接 `git checkout --theirs`
   *   （rebase 中 git 语义反转：--theirs = 被 rebase 的分支 = agent）
   * - `"accept-trunk"`：冲突时保留主干版本，跳过回调，直接 `git checkout --ours`
   *
   * 注意：此策略仅影响冲突文件的处理方式。非冲突文件始终被正常合并。
   */
  conflictStrategy?: ConflictStrategy;
  /**
   * 合并策略。默认 "ff-only"。
   *
   * - `"ff-only"`：fast-forward merge，保留 agent 的所有 commits
   * - `"squash"`：将所有 agent commits 压缩为一条 commit
   */
  mergeStrategy?: MergeStrategyType;
  /**
   * squash merge 的 commit message。mergeStrategy 为 "squash" 时必填。
   */
  squashMessage?: string;
}

export interface AgentWorkDoneSignal {
  agentName: string;
  worktreePath: string;
  /**
   * 通知 gitmesh 编码完成，返回 merge 结果的 Promise。
   *
   * - `true`  — 成功合入主干
   * - `false` — 合并失败（冲突无解、重试耗尽等）
   */
  done: () => Promise<boolean>;
}

export type AgentResolveConflict = (
  conflict: ConflictInfo
) => Promise<ResolutionResult>;

// === Session ===

export interface Session {
  /** 事件监听 */
  on<E extends keyof SessionEvents>(event: E, handler: SessionEvents[E]): void;
  /** 移除监听 */
  off<E extends keyof SessionEvents>(event: E, handler: SessionEvents[E]): void;
  /** 等待全部完成，返回结果摘要 */
  done(): Promise<SessionSummary>;
  /** 中断 session */
  abort(reason?: string): Promise<void>;
}

// === 结果摘要 ===

export interface SessionSummary {
  status: "success" | "partial" | "failed";
  results: AgentResult[];
  /** 最终主干 HEAD */
  trunkHead: string;
}

export interface AgentResult {
  agentName: string;
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

// === 冲突 ===

export interface ConflictInfo {
  /** Agent 名称 */
  agentName: string;
  /** 发生冲突的文件列表 */
  files: ConflictFile[];
  /** 当前 rebase 尝试次数 */
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

export interface ConflictFile {
  /** 相对于 repo root 的文件路径 */
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

export interface ResolutionResult {
  /** 是否已解决 */
  resolved: boolean;
  /** 如无法解决，说明原因 */
  reason?: string;
}

// === Worktree ===

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  head: string;
}

export interface WorktreeStatus {
  dirty: boolean;
  head: string;
  branch: string;
}

// === Session 事件 ===

export type SessionEvents = {
  "worktree:ready": (info: WorktreeInfo) => void;
  "agent:done": (name: string) => void;
  "mesh:rebase": (name: string) => void;
  "mesh:conflict": (info: ConflictInfo) => void;
  "mesh:retry": (name: string, attempt: number) => void;
  "mesh:merged": (name: string, commit: string) => void;
  "mesh:failed": (name: string, reason: string, worktreePath: string) => void;
  "session:done": (summary: SessionSummary) => void;
};

// === 内部队列项 ===

export interface QueueItem {
  agentName: string;
  worktreePath: string;
  branch: string;
  onConflict: AgentResolveConflict;
  retries: number;
  /** 冲突策略，默认 "route-to-agent" */
  conflictStrategy: ConflictStrategy;
  /** 合并策略，默认 "ff-only" */
  mergeStrategy: MergeStrategyType;
  /** squash merge 的 commit message */
  squashMessage?: string;
}
