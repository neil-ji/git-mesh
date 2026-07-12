/**
 * 合并操作封装 + 文件锁协调。
 *
 * 将 Agent 分支 fast-forward 合入主干。
 * 合并前需要获取 merge lock（由 merge-engine 管理），
 * 此模块只负责纯粹的 git merge 操作。
 */

import { execGit, execGitFull } from "./git";
import { getTrunkHead } from "./worktree";
import { MergeError, RebaseError } from "./errors";

/**
 * fast-forward 合并 Agent 分支到主干
 * @returns 新的主干 HEAD commit hash
 */
export async function fastForwardMerge(
  branch: string,
  trunkBranch: string,
  cwd: string
): Promise<string> {
  // 1. 切换到主干分支
  await execGit(["checkout", trunkBranch], { cwd });

  // 2. 尝试 fast-forward merge
  const result = await execGitFull(
    ["merge", "--ff-only", branch],
    { cwd }
  );

  if (result.exitCode !== 0) {
    // merge 失败，可能是因为分支不是 fast-forwardable
    // 回退并报错
    throw new MergeError(
      branch,
      `Fast-forward merge failed. The branch is not a descendant of ${trunkBranch}: ${result.stderr}`
    );
  }

  // 3. 获取新的 HEAD
  const newHead = await getTrunkHead(cwd, trunkBranch);

  return newHead;
}

/**
 * 检查分支是否可以 fast-forward 到 trunk
 */
export async function canFastForward(
  branch: string,
  trunkBranch: string,
  cwd: string
): Promise<boolean> {
  const result = await execGitFull(
    ["merge-base", "--is-ancestor", trunkBranch, branch],
    { cwd }
  );
  return result.exitCode === 0;
}

/**
 * 删除已合并的分支
 */
export async function deleteMergedBranch(
  branch: string,
  cwd: string
): Promise<void> {
  await execGit(["branch", "-d", branch], {
    cwd,
    allowNonZero: true,
  });
}

/**
 * Force delete a branch
 */
export async function forceDeleteBranch(
  branch: string,
  cwd: string
): Promise<void> {
  await execGit(["branch", "-D", branch], {
    cwd,
    allowNonZero: true,
  });
}
