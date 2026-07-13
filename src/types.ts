// === 入口 ===

export type MergeStrategyName = "rebase-first" | "sequential";

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
}

export interface AgentDefinition {
  /** 唯一名称，用作 worktree 目录名和分支名的一部分 */
  name: string;
  /** 基于哪个 ref 创建工作区，默认 trunkBranch */
  baseRef?: string;
  /** Agent 工作完成回调，调用方在此通知 gitmesh */
  onReady: (signal: AgentWorkDoneSignal) => void | Promise<void>;
  /** 冲突解决回调，调用方在此桥接 Agent 解决冲突 */
  onConflict: AgentResolveConflict;
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
}
