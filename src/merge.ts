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
 * 检查 working tree 是否干净。
 * 返回脏文件列表（git status --porcelain 的每一行），干净时返回空数组。
 */
export async function checkWorkingTreeClean(cwd: string): Promise<string[]> {
  const result = await execGitFull(["status", "--porcelain"], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(
      `git status failed in ${cwd}: ${result.stderr || "unknown error"}`
    );
  }
  if (!result.stdout) return [];
  return result.stdout.split("\n").filter(Boolean);
}

/**
 * fast-forward 合并 Agent 分支到主干
 * @returns 新的主干 HEAD commit hash
 */
export async function fastForwardMerge(
  branch: string,
  trunkBranch: string,
  cwd: string
): Promise<string> {
  // 1. 检查 working tree 是否干净
  const dirtyFiles = await checkWorkingTreeClean(cwd);
  if (dirtyFiles.length > 0) {
    const fileList = dirtyFiles.map((f) => `  ${f}`).join("\n");
    throw new MergeError(
      branch,
      `Working tree is not clean. Cannot fast-forward merge.\nDirty files:\n${fileList}\nCommit or stash changes before merging.`
    );
  }

  // 2. 切换到主干分支
  await execGit(["checkout", trunkBranch], { cwd });

  // 3. 尝试 fast-forward merge
  const result = await execGitFull(
    ["merge", "--ff-only", branch],
    { cwd }
  );

  if (result.exitCode !== 0) {
    // merge 失败 — 可能是分支不是 fast-forwardable，或其他 git 错误
    throw new MergeError(
      branch,
      `Fast-forward merge failed: ${result.stderr.trim()}`
    );
  }

  // 4. 获取新的 HEAD
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
 * ref-only 合并：仅通过 git update-ref 更新 trunk 的 ref，
 * 不触及 working tree 或 index。
 *
 * 适用于主仓库有脏文件且无法清理的场景。
 * 调用方需自行负责同步 working tree（如 git checkout / git reset）。
 *
 * @returns 新的主干 HEAD commit hash
 */
export async function refOnlyMerge(
  branch: string,
  trunkBranch: string,
  cwd: string
): Promise<string> {
  // 1. 验证分支是 trunk 的后代（fast-forwardable）
  const canFF = await canFastForward(branch, trunkBranch, cwd);
  if (!canFF) {
    throw new MergeError(
      branch,
      `Branch is not a descendant of ${trunkBranch}, cannot fast-forward. ` +
        `Use mergeMode: 'full' if you need a merge commit.`
    );
  }

  // 2. 获取分支 HEAD
  const branchHead = await execGit(["rev-parse", branch], { cwd });

  // 3. 仅更新 ref，不触碰 working tree 和 index
  await execGit(["update-ref", `refs/heads/${trunkBranch}`, branchHead], { cwd });

  return branchHead;
}

/**
 * squash 合并 Agent 分支到主干。
 *
 * 将所有 agent commits 压缩为一条 commit，保持主干历史干净。
 *
 * @param branch      Agent 分支名
 * @param trunkBranch 主干分支名
 * @param cwd         仓库根目录
 * @param message     squash commit 的 message
 * @returns 新的主干 HEAD commit hash
 */
export async function squashMerge(
  branch: string,
  trunkBranch: string,
  cwd: string,
  message: string
): Promise<string> {
  // 1. 检查 working tree 干净
  const dirtyFiles = await checkWorkingTreeClean(cwd);
  if (dirtyFiles.length > 0) {
    const fileList = dirtyFiles.map((f) => `  ${f}`).join("\n");
    throw new MergeError(
      branch,
      `Working tree is not clean. Cannot squash merge.\nDirty files:\n${fileList}\nCommit or stash changes before merging.`
    );
  }

  // 2. 切换到主干
  await execGit(["checkout", trunkBranch], { cwd });

  // 3. squash merge — 把所有改动放到工作区但不 commit
  const result = await execGitFull(["merge", "--squash", branch], { cwd });
  if (result.exitCode !== 0) {
    throw new MergeError(
      branch,
      `Squash merge failed: ${result.stderr.trim()}`
    );
  }

  // 4. commit
  await execGit(["commit", "-m", message], { cwd });

  // 5. 获取新的 HEAD
  return getTrunkHead(cwd, trunkBranch);
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
