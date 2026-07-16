/**
 * 冲突检测与 ConflictInfo 构建。
 *
 * 当 rebase 过程中遇到冲突时，此模块负责：
 * 1. 检测冲突文件列表及状态
 * 2. 读取冲突内容（含 git 冲突标记）
 * 3. 生成 incoming/outgoing diff
 * 4. 构建完整的 ConflictInfo 结构
 * 5. 构建人类/LLM 可读的冲突描述 prompt
 */

import * as path from "path";
import * as fs from "fs";
import { execGit, execGitFull } from "./git";
import type { ConflictFile, ConflictInfo, ConflictPromptOptions } from "./types";

// 默认 prompt 头部
const DEFAULT_CONFLICT_HEADER = [
  "你的分支在 rebase 到主干时产生了冲突。",
  "",
  "请在工作目录中编辑冲突文件，保留正确的合并结果：",
  "- 删除冲突标记 <<<<<<< / ======= / >>>>>>>",
  "- 确认最终内容是你期望的状态",
  "- 完成后不需要执行 git add 或 git commit",
  "",
].join("\n");

const DEFAULT_MAX_FILE_CONTENT = 8000;

/**
 * 检测冲突双方是否主要是追加新行（而非修改已有行）。
 * 用于在 prompt 中给出合并提示。
 */
function detectAppendPattern(file: ConflictFile): boolean {
  const outgoingLines = file.outgoingDiff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const incomingLines = file.incomingDiff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));

  // 两边的 diff 都只有新增行（没有删除行），则视为追加模式
  const hasRemovals =
    file.outgoingDiff.split("\n").some((l) => l.startsWith("-") && !l.startsWith("---")) ||
    file.incomingDiff.split("\n").some((l) => l.startsWith("-") && !l.startsWith("---"));

  return !hasRemovals && outgoingLines.length > 0 && incomingLines.length > 0;
}

/**
 * 检查是否有任何冲突文件符合追加模式
 */
function anyAppendPattern(files: ConflictFile[]): boolean {
  return files.some((f) => detectAppendPattern(f));
}

/**
 * 将 ConflictInfo 翻译为人类/LLM 可读的冲突描述 prompt。
 *
 * 纯数据转换函数 — 不依赖任何 Agent SDK。
 * 返回的字符串可直接作为 LLM prompt 或日志输出使用。
 *
 * @param conflict 冲突信息
 * @param options  自定义选项
 */
export function buildConflictPrompt(
  conflict: ConflictInfo,
  options?: ConflictPromptOptions
): string {
  const maxLen = options?.maxFileContent ?? DEFAULT_MAX_FILE_CONTENT;
  const includeHints = options?.hints !== false; // default true

  // 头部
  const header = options?.header ?? DEFAULT_CONFLICT_HEADER;

  // 元信息
  const meta = [
    `**Agent:** \`${conflict.agentName}\``,
    `**尝试次数:** ${conflict.attempt}/${conflict.maxRetries}`,
    `**目标 commit:** \`${conflict.targetCommit.slice(0, 7)}\``,
    `**工作目录:** \`${conflict.worktreePath}\``,
  ].join("  \n");

  // 策略提示
  let hintSection = "";
  if (includeHints && anyAppendPattern(conflict.files)) {
    hintSection = [
      "",
      "> 💡 **提示：** 检测到冲突双方都是追加新内容（没有删除或修改已有行）。",
      "> 你的任务是将两边的追加内容合并保留，去除冲突标记即可。",
      "> 不需要二选一。",
      "",
    ].join("\n");
  }

  // 文件详情
  const fileSections = conflict.files.map((f) => {
    const truncated = f.content.length > maxLen
      ? f.content.slice(0, maxLen) + `\n\n... (截断，原长度 ${f.content.length} 字符)`
      : f.content;

    return [
      `### \`${f.path}\` (${f.status})`,
      "",
      "**你的改动 (outgoing):**",
      "```diff",
      f.outgoingDiff || "(无)",
      "```",
      "",
      "**主干改动 (incoming):**",
      "```diff",
      f.incomingDiff || "(无)",
      "```",
      "",
      "**冲突内容 (含标记):**",
      "```",
      truncated,
      "```",
    ].join("\n");
  });

  return [header, "", meta, hintSection, "---", "", ...fileSections].join("\n");
}

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
 * 自动解决冲突：用 git checkout --ours/--theirs 选择版本。
 *
 * **rebase 上下文中的语义反转**：
 * - `git --ours`  = rebase onto 的目标分支（trunk）
 * - `git --theirs` = 被 rebase 的分支（agent）
 *
 * 所以：
 * - `accept-agent` → `--theirs`（保留 agent 版本）
 * - `accept-trunk` → `--ours`（保留 trunk 版本）
 *
 * 解决后自动 git add，调用方负责 continueRebase。
 */
export async function autoResolveConflicts(
  worktreePath: string,
  files: ConflictFile[],
  strategy: "accept-agent" | "accept-trunk"
): Promise<void> {
  // rebase 中 git 语义反转：accept-agent → theirs, accept-trunk → ours
  const flag = strategy === "accept-agent" ? "--theirs" : "--ours";

  for (const f of files) {
    await execGit(["checkout", flag, "--", f.path], {
      cwd: worktreePath,
      allowNonZero: true,
    });
    await execGit(["add", "--", f.path], {
      cwd: worktreePath,
      allowNonZero: true,
    });
  }
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
