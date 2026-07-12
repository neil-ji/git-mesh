/**
 * rebase 操作封装。
 * 在 Agent 的 worktree 内执行 rebase，检测冲突状态。
 */

import { execGit, execGitFull } from "./git";
import { detectConflicts } from "./conflict";
import type { ConflictFile } from "./types";

export interface RebaseSuccess {
  success: true;
}

export interface RebaseConflict {
  success: false;
  files: ConflictFile[];
}

export type RebaseResult = RebaseSuccess | RebaseConflict;

/**
 * 在 worktree 内将当前分支 rebase 到目标分支
 */
export async function rebaseBranch(
  worktreePath: string,
  targetBranch: string
): Promise<RebaseResult> {
  const result = await execGitFull(
    ["rebase", targetBranch],
    { cwd: worktreePath }
  );

  if (result.exitCode === 0) {
    return { success: true };
  }

  // rebase 失败，检测冲突
  const files = await detectConflicts(worktreePath);

  if (files.length > 0) {
    return { success: false, files };
  }

  // rebase 失败但没有冲突文件（可能是其他错误）
  // 抛出原始错误
  throw new Error(`Rebase failed: ${result.stderr}`);
}

/**
 * 继续 rebase（Agent 解决冲突后调用）
 */
export async function continueRebase(
  worktreePath: string
): Promise<RebaseResult> {
  // git add 所有已解决的文件
  await execGit(["add", "."], { cwd: worktreePath });

  // 尝试 continue
  const result = await execGitFull(
    ["rebase", "--continue"],
    { cwd: worktreePath }
  );

  if (result.exitCode === 0) {
    return { success: true };
  }

  // 又遇到冲突
  const files = await detectConflicts(worktreePath);
  if (files.length > 0) {
    return { success: false, files };
  }

  throw new Error(`Rebase continue failed: ${result.stderr}`);
}

/**
 * 放弃 rebase
 */
export async function abortRebase(worktreePath: string): Promise<void> {
  await execGit(["rebase", "--abort"], {
    cwd: worktreePath,
    allowNonZero: true,
  });
}

/**
 * 检查是否正在 rebase 中
 */
export async function isRebasing(worktreePath: string): Promise<boolean> {
  try {
    const result = await execGitFull(
      ["rev-parse", "--verify", "REBASE_HEAD"],
      { cwd: worktreePath }
    );
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
