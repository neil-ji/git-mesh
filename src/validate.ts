/**
 * 参数校验和环境检查
 */

import * as fs from "fs";
import * as path from "path";
import { execGit } from "./git";
import type { GitmeshOptions } from "./types";
import {
  SessionError,
  WorktreeCreateError,
} from "./errors";

/**
 * 校验 gitmesh 入参并填充默认值
 */
export type ResolvedGitmeshOptions = Required<Pick<GitmeshOptions, 'cwd' | 'strategy' | 'maxRetries' | 'conflictTimeout' | 'workspaceDir' | 'trunkBranch' | 'branchPrefix'>> & Pick<GitmeshOptions, 'agents' | 'onMerged' | 'onFailed' | 'onConflict' | 'onDone' | 'onBeforeMerge' | 'mergeMode'>;

export function resolveOptions(
  options: GitmeshOptions
): ResolvedGitmeshOptions {
  if (!options.agents || options.agents.length === 0) {
    throw new SessionError("At least one agent is required");
  }

  const names = new Set<string>();
  for (const agent of options.agents) {
    if (!agent.name || typeof agent.name !== "string") {
      throw new SessionError("Each agent must have a unique name");
    }
    if (names.has(agent.name)) {
      throw new SessionError(`Duplicate agent name: "${agent.name}"`);
    }
    names.add(agent.name);
    if (typeof agent.onReady !== "function") {
      throw new SessionError(
        `Agent "${agent.name}" must have an onReady callback`
      );
    }
    if (typeof agent.onConflict !== "function" && typeof agent.resolveConflict !== "function") {
      throw new SessionError(
        `Agent "${agent.name}" must have an onConflict or resolveConflict callback`
      );
    }
  }

  const cwd = path.resolve(options.cwd ?? process.cwd());

  return {
    cwd,
    agents: options.agents,
    strategy: options.strategy ?? "rebase-first",
    maxRetries: options.maxRetries ?? 3,
    conflictTimeout: options.conflictTimeout ?? 600_000,
    workspaceDir: path.resolve(
      options.workspaceDir ?? path.join(cwd, "..", ".gitmesh-workspaces")
    ),
    trunkBranch: options.trunkBranch ?? "main",
    branchPrefix: options.branchPrefix ?? "mesh/",
    onMerged: options.onMerged,
    onFailed: options.onFailed,
    onConflict: options.onConflict,
    onDone: options.onDone,
    onBeforeMerge: options.onBeforeMerge,
    mergeMode: options.mergeMode ?? "full",
  };
}

/**
 * 验证 git 环境是否可用
 */
export async function validateGitEnv(cwd: string): Promise<void> {
  // 检查 cwd 是否存在
  try {
    fs.accessSync(cwd, fs.constants.R_OK);
  } catch {
    throw new SessionError(`Directory not accessible: ${cwd}`);
  }

  // 检查是否为 git 仓库
  try {
    await execGit(["rev-parse", "--git-dir"], { cwd });
  } catch (err) {
    throw new SessionError(
      `Not a git repository: ${cwd}`,
      err
    );
  }

  // 检查是否在 worktree 内（不能在 worktree 内启动 gitmesh）
  try {
    // 用 git rev-parse --git-dir 获取实际的 .git 路径
    const gitDir = await execGit(["rev-parse", "--git-dir"], { cwd });
    const gitDirPath = path.resolve(cwd, gitDir);
    // 如果解析后的路径不是以 cwd/.git 开头，说明在 worktree 中
    // 或者 .git 是一个文件（worktree 的 .git 是文件，指向主仓库）
    const dotGitPath = path.join(cwd, ".git");
    try {
      const dotGitStat = fs.statSync(dotGitPath);
      if (dotGitStat.isFile()) {
        throw new SessionError(
          "Cannot run gitmesh inside a git worktree. Run it from the main repository."
        );
      }
    } catch (err) {
      if (err instanceof SessionError) throw err;
      // .git doesn't exist at all — unexpected but let it pass to version check
    }
  } catch (err) {
    if (err instanceof SessionError) throw err;
    // Other errors from stat are unexpected but not fatal
  }

  // 检查 git 版本
  try {
    const version = await execGit(["version"]);
    const match = version.match(/git version (\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major < 2 || (major === 2 && minor < 20)) {
        throw new SessionError(
          `Git version 2.20+ required, found ${match[1]}.${match[2]}`
        );
      }
    }
  } catch (err) {
    if (err instanceof SessionError) throw err;
    throw new SessionError("Failed to detect git version", err);
  }
}

/**
 * 确保 worktree 存储目录存在
 */
export function ensureWorkspaceDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 检查主干分支是否存在
 */
export async function validateTrunkBranch(
  cwd: string,
  trunkBranch: string
): Promise<void> {
  try {
    await execGit(["rev-parse", "--verify", trunkBranch], { cwd });
  } catch {
    // Check if it exists as a remote branch
    try {
      await execGit(["rev-parse", "--verify", `refs/heads/${trunkBranch}`], {
        cwd,
      });
    } catch {
      throw new SessionError(
        `Trunk branch "${trunkBranch}" does not exist`
      );
    }
  }
}
