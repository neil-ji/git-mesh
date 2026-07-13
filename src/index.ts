/**
 * gitmesh — Agent 并行编码时的 git 管道工。
 *
 * @packageDocumentation
 */

import { SessionImpl } from "./session";
import { resolveOptions, validateGitEnv, ensureWorkspaceDir, validateTrunkBranch } from "./validate";
import { SessionError } from "./errors";
import type { GitmeshOptions, Session } from "./types";

// 导出所有公开类型
export type {
  GitmeshOptions,
  AgentDefinition,
  AgentWorkDoneSignal,
  AgentResolveConflict,
  ConflictResolutionParams,
  ConflictPromptOptions,
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
} from "./types";

// 导出工具函数
export { buildConflictPrompt } from "./conflict";

// 导出错误类
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
} from "./errors";

/**
 * 创建 gitmesh session。
 *
 * 在单仓库内为多个 Agent 创建隔离 worktree，
 * Agent 各自完成编码后，自动将变更合回主干。
 *
 * @example
 * ```typescript
 * import { gitmesh } from "gitmesh";
 *
 * const session = await gitmesh({
 *   cwd: "/path/to/repo",
 *   agents: [
 *     {
 *       name: "fix-auth",
 *       onReady: (signal) => {
 *         // fire-and-forget: Agent 在 signal.worktreePath 中工作
 *         // gitmesh 不等待 onReady 返回，生命周期以 signal.done() 为准
 *         runAgent({ cwd: signal.worktreePath }).then(() => signal.done());
 *       },
 *       onConflict: async (conflict) => {
 *         return runConflictResolver(conflict);
 *       },
 *     },
 *   ],
 *   strategy: "rebase-first",
 *   onMerged: (name, commit) => console.log(`${name} merged: ${commit}`),
 *   onFailed: (name, reason, worktreePath) => console.error(`${name} failed: ${reason}`),
 * });
 *
 * const summary = await session.done();
 * ```
 */
export async function gitmesh(options: GitmeshOptions): Promise<Session> {
  // 1. 校验并填充默认参数
  const resolvedOpts = resolveOptions(options);

  // 2. 验证 git 环境
  await validateGitEnv(resolvedOpts.cwd);

  // 3. 确保主干分支存在
  await validateTrunkBranch(resolvedOpts.cwd, resolvedOpts.trunkBranch);

  // 4. 确保 worktree 存储目录存在
  ensureWorkspaceDir(resolvedOpts.workspaceDir);

  // 5. 创建 session
  const session = new SessionImpl(resolvedOpts);

  // 6. 启动 session（创建 worktree，启动 agent）
  try {
    await session.start();
  } catch (err) {
    throw new SessionError(
      `Failed to start session: ${
        err instanceof Error ? err.message : String(err)
      }`,
      err
    );
  }

  return session;
}

// 默认导出
export default gitmesh;
