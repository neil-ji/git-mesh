/**
 * Git 命令封装测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execGit, execGitFull, execGitLong } from "../src/git";
import { execFileSync } from "child_process";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

let repoDir: string;

describe("git command wrapper", () => {
  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitmesh-git-test-"));
    git(["init", "-b", "main"], repoDir);
    git(["config", "user.email", "test@t"], repoDir);
    git(["config", "user.name", "Test"], repoDir);
    fs.writeFileSync(path.join(repoDir, "file.txt"), "hello");
    git(["add", "file.txt"], repoDir);
    git(["commit", "-m", "init"], repoDir);
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe("execGit", () => {
    it("should execute git command and return stdout", async () => {
      const result = await execGit(["rev-parse", "HEAD"], { cwd: repoDir });
      expect(result).toMatch(/^[a-f0-9]{40}$/);
    });

    it("should respect cwd option", async () => {
      const result = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repoDir,
      });
      expect(result).toBe("main");
    });

    it("should throw on git error with non-zero exit", async () => {
      await expect(
        execGit(["rev-parse", "nonexistent-branch"], { cwd: repoDir })
      ).rejects.toThrow(/git rev-parse nonexistent-branch failed/);
    });

    it("should return stdout on allowNonZero", async () => {
      const result = await execGit(
        ["rev-parse", "--abbrev-ref", "nonexistent"],
        { cwd: repoDir, allowNonZero: true }
      );
      // On error with allowNonZero, stdout may be empty
      expect(typeof result).toBe("string");
    });

    it("should return trimmed output", async () => {
      const result = await execGit(["rev-parse", "HEAD"], { cwd: repoDir });
      expect(result).toBe(result.trim());
      expect(result).not.toContain("\n");
    });
  });

  describe("execGitFull", () => {
    it("should return exit code 0 on success", async () => {
      const result = await execGitFull(["rev-parse", "HEAD"], {
        cwd: repoDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^[a-f0-9]{40}$/);
    });

    it("should return non-zero exit code on failure without throwing", async () => {
      const result = await execGitFull(["rev-parse", "no-branch"], {
        cwd: repoDir,
      });
      expect(result.exitCode).not.toBe(0);
    });

    it("should capture stderr on failure", async () => {
      const result = await execGitFull(["rev-parse", "no-branch"], {
        cwd: repoDir,
      });
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  });

  describe("execGitLong", () => {
    it("should execute with longer timeout", async () => {
      const result = await execGitLong(["rev-parse", "HEAD"], {
        cwd: repoDir,
      });
      expect(result).toMatch(/^[a-f0-9]{40}$/);
    });
  });
});
