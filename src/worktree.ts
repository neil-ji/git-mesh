/**
 * git worktree CRUD（内部使用，不暴露为公开 API）。
 *
 * 对标 treefork 的核心能力，但仅供 session 内部调用。
 * - 无 checkpoint 机制
 * - 无 remote 模式
 * - 无 config 文件
 * - 无 tmux 集成
 */

import * as path from "path";
import * as fs from "fs";
import { execGit } from "./git";
import { WorktreeError, WorktreeCreateError, WorktreeRemoveError } from "./errors";
import type { WorktreeInfo, WorktreeStatus } from "./types";

export interface WorktreeOptions {
  /** 主仓库根目录 */
  cwd: string;
  /** worktree 存储目录 */
  workspaceDir: string;
  /** 分支名前缀 */
  branchPrefix: string;
}

/**
 * 创建 worktree + 分支
 */
export async function createWorktree(
  name: string,
  baseRef: string,
  opts: WorktreeOptions
): Promise<WorktreeInfo> {
  const branch = `${opts.branchPrefix}${name}`;
  const worktreePath = path.join(opts.workspaceDir, name);

  // 确保存储目录存在
  if (!fs.existsSync(opts.workspaceDir)) {
    fs.mkdirSync(opts.workspaceDir, { recursive: true });
  }

  // 删除已存在的路径（可能是上次失败的残留）
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  // 删除可能存在的同名分支
  try {
    await execGit(["branch", "-D", branch], { cwd: opts.cwd, allowNonZero: true });
  } catch {
    // 分支不存在，忽略
  }

  try {
    // git worktree add -b <branch> <path> <base-ref>
    await execGit(["worktree", "add", "-b", branch, worktreePath, baseRef], {
      cwd: opts.cwd,
    });
  } catch (err) {
    throw new WorktreeCreateError(
      name,
      `Failed to create worktree at "${worktreePath}"`,
      err
    );
  }

  const head = await execGit(["rev-parse", "HEAD"], { cwd: worktreePath });

  return {
    name,
    path: worktreePath,
    branch,
    head,
  };
}

/**
 * 删除 worktree + 分支
 */
export async function removeWorktree(
  name: string,
  opts: WorktreeOptions,
  force: boolean = false
): Promise<void> {
  const worktreePath = path.join(opts.workspaceDir, name);
  const branch = `${opts.branchPrefix}${name}`;

  // 删除 worktree
  if (fs.existsSync(worktreePath)) {
    try {
      const args = ["worktree", "remove", worktreePath];
      if (force) {
        args.push("--force");
      }
      await execGit(args, { cwd: opts.cwd });
    } catch (err) {
      // 如果 worktree remove 失败，尝试直接删除目录
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        await execGit(["worktree", "prune"], { cwd: opts.cwd });
      } catch {
        throw new WorktreeRemoveError(
          name,
          `Failed to remove worktree at "${worktreePath}"`,
          err
        );
      }
    }
  }

  // 删除分支
  try {
    await execGit(["branch", "-D", branch], { cwd: opts.cwd, allowNonZero: true });
  } catch {
    // 分支可能已被删除，忽略
  }
}

/**
 * 列出当前 session 管理的 worktree
 */
export async function listWorktrees(opts: WorktreeOptions): Promise<WorktreeInfo[]> {
  try {
    const output = await execGit(["worktree", "list", "--porcelain"], {
      cwd: opts.cwd,
    });

    const worktrees: WorktreeInfo[] = [];
    const lines = output.split("\n");
    let current: Partial<WorktreeInfo> = {};

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          // Only include worktrees in our workspace dir
          if (current.path.startsWith(opts.workspaceDir)) {
            worktrees.push({
              name: path.basename(current.path),
              path: current.path,
              branch: current.branch ?? "detached",
              head: current.head ?? "",
            });
          }
        }
        current = { path: line.slice("worktree ".length) };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      }
    }

    // Don't forget the last entry
    if (current.path && current.path.startsWith(opts.workspaceDir)) {
      worktrees.push({
        name: path.basename(current.path),
        path: current.path,
        branch: current.branch ?? "detached",
        head: current.head ?? "",
      });
    }

    return worktrees;
  } catch (err) {
    throw new WorktreeError("Failed to list worktrees", err);
  }
}

/**
 * 获取 worktree 的状态（dirty/clean、当前 HEAD）
 */
export async function getWorktreeStatus(
  name: string,
  opts: WorktreeOptions
): Promise<WorktreeStatus> {
  const worktreePath = path.join(opts.workspaceDir, name);

  if (!fs.existsSync(worktreePath)) {
    throw new WorktreeError(`Worktree path does not exist: ${worktreePath}`);
  }

  const head = await execGit(["rev-parse", "HEAD"], { cwd: worktreePath });
  const branch = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: worktreePath,
  });
  const statusOutput = await execGit(["status", "--porcelain"], {
    cwd: worktreePath,
  });
  const dirty = statusOutput.length > 0;

  return { dirty, head, branch };
}

/**
 * 获取主仓库当前 trunk HEAD
 */
export async function getTrunkHead(
  cwd: string,
  trunkBranch: string
): Promise<string> {
  return execGit(["rev-parse", trunkBranch], { cwd });
}
