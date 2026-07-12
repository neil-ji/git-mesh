/**
 * 冲突检测与 ConflictInfo 构建。
 *
 * 当 rebase 过程中遇到冲突时，此模块负责：
 * 1. 检测冲突文件列表及状态
 * 2. 读取冲突内容（含 git 冲突标记）
 * 3. 生成 incoming/outgoing diff
 * 4. 构建完整的 ConflictInfo 结构
 */

import * as path from "path";
import * as fs from "fs";
import { execGit, execGitFull } from "./git";
import type { ConflictFile, ConflictInfo } from "./types";

/**
 * 检测 worktree 中的冲突文件
 */
export async function detectConflicts(
  worktreePath: string
): Promise<ConflictFile[]> {
  // git diff --name-only --diff-filter=U 列出所有未合并的文件
  const output = await execGit(
    ["diff", "--name-only", "--diff-filter=U"],
    { cwd: worktreePath, allowNonZero: true }
  );

  if (!output) return [];

  const filePaths = output.split("\n").filter(Boolean);
  const files: ConflictFile[] = [];

  for (const filePath of filePaths) {
    const fullPath = path.join(worktreePath, filePath);

    // 读取文件内容（含冲突标记）
    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      content = "[unable to read file]";
    }

    // 检测冲突状态
    const status = await detectConflictStatus(filePath, worktreePath);

    // 获取 incoming diff（主干侧改了什么）
    let incomingDiff = "";
    try {
      // HEAD (during rebase) is the incoming version (theirs)
      incomingDiff = await execGit(
        ["diff", "--merge-base", "HEAD", "--", filePath],
        { cwd: worktreePath, allowNonZero: true }
      );
    } catch {
      incomingDiff = "";
    }

    // 获取 outgoing diff（Agent 侧改了什么）
    let outgoingDiff = "";
    try {
      // During rebase, we can compare the working tree vs the original
      outgoingDiff = await execGit(
        ["diff", "MERGE_HEAD", "--", filePath],
        { cwd: worktreePath, allowNonZero: true }
      );
    } catch {
      // MERGE_HEAD might not exist; try ORIG_HEAD
      try {
        outgoingDiff = await execGit(
          ["diff", "ORIG_HEAD", "--", filePath],
          { cwd: worktreePath, allowNonZero: true }
        );
      } catch {
        outgoingDiff = "";
      }
    }

    files.push({
      path: filePath,
      status,
      content,
      incomingDiff,
      outgoingDiff,
    });
  }

  return files;
}

/**
 * 检测单个文件的冲突状态
 */
async function detectConflictStatus(
  filePath: string,
  worktreePath: string
): Promise<ConflictFile["status"]> {
  // 使用 git status --porcelain 判断状态
  const result = await execGitFull(
    ["status", "--porcelain", "--", filePath],
    { cwd: worktreePath }
  );

  const line = result.stdout;

  if (!line) return "conflicted";

  // git status --porcelain 格式: XY path
  // 对于冲突文件，X 和 Y 表示 index 和 worktree 的状态
  if (line.startsWith("DD")) return "deleted-by-both";
  if (line.startsWith("DU")) return "deleted-by-us";
  if (line.startsWith("UD")) return "deleted-by-them";
  if (line.startsWith("AA")) return "added-by-both";
  if (line.startsWith("AU")) return "added-by-both";
  if (line.startsWith("UA")) return "added-by-both";

  // 检查文件是否包含冲突标记
  const fullPath = path.join(worktreePath, filePath);
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    if (content.includes("<<<<<<<") && content.includes(">>>>>>>")) {
      return "conflicted";
    }
  } catch {
    // file might have been deleted
  }

  return "conflicted";
}

/**
 * 构建 ConflictInfo 结构
 */
export function buildConflictInfo(params: {
  agentName: string;
  files: ConflictFile[];
  attempt: number;
  maxRetries: number;
  targetCommit: string;
  sourceCommit: string;
  worktreePath: string;
}): ConflictInfo {
  return {
    agentName: params.agentName,
    files: params.files,
    attempt: params.attempt,
    maxRetries: params.maxRetries,
    targetCommit: params.targetCommit,
    sourceCommit: params.sourceCommit,
    worktreePath: params.worktreePath,
  };
}

/**
 * 检查是否存在冲突
 */
export function hasConflicts(files: ConflictFile[]): boolean {
  return files.some(
    (f) =>
      f.status === "conflicted" ||
      f.status === "deleted-by-us" ||
      f.status === "deleted-by-them" ||
      f.status === "added-by-both"
  );
}
