/**
 * 裸 git 命令封装。
 * 所有 git 操作通过此模块执行，统一错误处理和输出截取。
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 120_000; // 2 minutes for most operations
const REBASE_TIMEOUT = 300_000; // 5 minutes for rebase operations

export interface GitExecOptions {
  /** 工作目录 */
  cwd?: string;
  /** 超时毫秒 */
  timeout?: number;
  /** 允许非零退出码（不抛异常） */
  allowNonZero?: boolean;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 执行 git 命令
 */
export async function execGit(
  args: string[],
  options: GitExecOptions = {}
): Promise<string> {
  const { cwd, timeout = DEFAULT_TIMEOUT, allowNonZero = false } = options;

  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    // git often outputs informational messages to stderr
    // We return stdout trimmed
    return stdout.trim();
  } catch (err: any) {
    if (allowNonZero) {
      return err.stdout?.trim() ?? "";
    }
    const stderr = err.stderr?.trim() ?? err.message;
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

/**
 * 执行 git 命令并返回完整结果（含 exit code）
 */
export async function execGitFull(
  args: string[],
  options: GitExecOptions = {}
): Promise<GitResult> {
  const { cwd, timeout = DEFAULT_TIMEOUT } = options;

  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.trim() ?? "",
      stderr: err.stderr?.trim() ?? err.message,
      exitCode: err.code ?? 1,
    };
  }
}

/**
 * 执行可能耗时较长的 git 命令（如 rebase）
 */
export async function execGitLong(
  args: string[],
  options: GitExecOptions = {}
): Promise<string> {
  return execGit(args, { ...options, timeout: REBASE_TIMEOUT });
}
