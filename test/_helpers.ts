/**
 * 测试辅助工具：创建临时 git 仓库
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execGit } from "../src/git";

export interface TempRepo {
  /** 仓库根目录 */
  cwd: string;
  /** 初始文件路径 */
  initialFile: string;
  /** 清除临时仓库 */
  cleanup: () => void;
}

/**
 * 创建临时 git 仓库，包含初始 commit
 */
export async function createTempRepo(): Promise<TempRepo> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitmesh-test-"));
  const cwd = dir;

  // git init
  await execGit(["init", "-b", "main"], { cwd });
  // 设置 user 信息（测试需要）
  await execGit(["config", "user.email", "test@gitmesh.local"], { cwd });
  await execGit(["config", "user.name", "Gitmesh Test"], { cwd });

  // 创建初始文件并 commit
  const initialFile = path.join(cwd, "README.md");
  fs.writeFileSync(initialFile, "# Test Repo\n\nTest repository for gitmesh.\n");
  await execGit(["add", "README.md"], { cwd });
  await execGit(["commit", "-m", "initial commit"], { cwd });

  return {
    cwd,
    initialFile,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 在仓库中创建第二个 commit（模拟「主干前进了」）
 */
export async function advanceTrunk(cwd: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(cwd, fileName);
  fs.writeFileSync(filePath, content);
  await execGit(["add", fileName], { cwd });
  await execGit(["commit", "-m", `Add ${fileName}`], { cwd });
  return execGit(["rev-parse", "HEAD"], { cwd });
}

/**
 * 在 worktree 中模拟 Agent 工作：修改文件并 commit
 */
export async function simulateAgentWork(
  worktreePath: string,
  fileName: string,
  content: string,
  commitMsg: string
): Promise<void> {
  const filePath = path.join(worktreePath, fileName);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
  await execGit(["add", fileName], { cwd: worktreePath });
  await execGit(["commit", "-m", commitMsg], { cwd: worktreePath });
}

/**
 * 获取仓库的当前 trunk HEAD
 */
export async function getHead(cwd: string, branch: string = "main"): Promise<string> {
  return execGit(["rev-parse", branch], { cwd });
}
