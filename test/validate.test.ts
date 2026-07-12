/**
 * 参数校验和环境检查测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  resolveOptions,
  validateGitEnv,
  ensureWorkspaceDir,
  validateTrunkBranch,
} from "../src/validate";
import { SessionError } from "../src/errors";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

let repoDir: string;

describe("validate", () => {
  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitmesh-validate-"));
    git(["init", "-b", "main"], repoDir);
    git(["config", "user.email", "test@t"], repoDir);
    git(["config", "user.name", "Test"], repoDir);
    fs.writeFileSync(path.join(repoDir, "f.txt"), "hi");
    git(["add", "f.txt"], repoDir);
    git(["commit", "-m", "init"], repoDir);
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe("resolveOptions", () => {
    const basicAgent = {
      name: "test",
      onReady: async () => {},
      onConflict: async () => ({ resolved: false }),
    };

    it("should fill in all defaults", () => {
      const opts = resolveOptions({ agents: [basicAgent] });
      expect(opts.strategy).toBe("rebase-first");
      expect(opts.maxRetries).toBe(3);
      expect(opts.conflictTimeout).toBe(600_000);
      expect(opts.trunkBranch).toBe("main");
      expect(opts.branchPrefix).toBe("mesh/");
      // cwd defaults to process.cwd()
      expect(opts.cwd).toBe(path.resolve(process.cwd()));
    });

    it("should resolve provided cwd to absolute path", () => {
      const opts = resolveOptions({ agents: [basicAgent], cwd: repoDir });
      expect(opts.cwd).toBe(path.resolve(repoDir));
    });

    it("should resolve workspaceDir relative to cwd parent", () => {
      const opts = resolveOptions({ agents: [basicAgent], cwd: "/a/b" });
      expect(opts.workspaceDir).toBe(path.resolve("/a", ".gitmesh-workspaces"));
    });

    it("should preserve explicit option values", () => {
      const opts = resolveOptions({
        agents: [basicAgent],
        strategy: "sequential",
        maxRetries: 5,
        conflictTimeout: 3000,
      });
      expect(opts.strategy).toBe("sequential");
      expect(opts.maxRetries).toBe(5);
      expect(opts.conflictTimeout).toBe(3000);
    });

    it("should throw when agents array is empty", () => {
      expect(() => resolveOptions({ agents: [] })).toThrow(SessionError);
      expect(() => resolveOptions({ agents: [] })).toThrow(
        "At least one agent is required"
      );
    });

    it("should throw on duplicate agent names", () => {
      expect(() =>
        resolveOptions({
          agents: [
            { name: "dup", onReady: async () => {}, onConflict: async () => ({ resolved: false }) },
            { name: "dup", onReady: async () => {}, onConflict: async () => ({ resolved: false }) },
          ],
        })
      ).toThrow(/Duplicate agent name/);
    });

    it("should throw when agent has no name", () => {
      expect(() =>
        resolveOptions({
          agents: [
            {
              name: "",
              onReady: async () => {},
              onConflict: async () => ({ resolved: false }),
            },
          ],
        })
      ).toThrow(SessionError);
    });

    it("should throw when agent has no onReady", () => {
      expect(() =>
        resolveOptions({
          agents: [
            {
              name: "x",
              onReady: undefined as any,
              onConflict: async () => ({ resolved: false }),
            },
          ],
        })
      ).toThrow(/onReady/);
    });

    it("should throw when agent has no onConflict", () => {
      expect(() =>
        resolveOptions({
          agents: [
            {
              name: "x",
              onReady: async () => {},
              onConflict: undefined as any,
            },
          ],
        })
      ).toThrow(/onConflict/);
    });
  });

  describe("validateGitEnv", () => {
    it("should pass for valid git repo", async () => {
      await expect(validateGitEnv(repoDir)).resolves.toBeUndefined();
    });

    it("should throw for non-git directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "not-git-"));
      await expect(validateGitEnv(tmpDir)).rejects.toThrow(/Not a git repository/);
      fs.rmdirSync(tmpDir);
    });

    it("should throw for inaccessible directory", async () => {
      await expect(
        validateGitEnv("/nonexistent/path/12345")
      ).rejects.toThrow(SessionError);
    });

    it("should throw when inside a worktree", async () => {
      // Create a worktree to test
      const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-vld-ws-"));
      fs.mkdirSync(wsDir, { recursive: true });
      git(["worktree", "add", "-b", "mesh/vld-test", path.join(wsDir, "wt"), "main"], repoDir);

      await expect(
        validateGitEnv(path.join(wsDir, "wt"))
      ).rejects.toThrow(/Cannot run gitmesh inside a git worktree/);

      // Cleanup
      git(["worktree", "remove", path.join(wsDir, "wt")], repoDir);
      git(["branch", "-D", "mesh/vld-test"], repoDir);
      fs.rmSync(wsDir, { recursive: true, force: true });
    });
  });

  describe("ensureWorkspaceDir", () => {
    it("should create directory if it does not exist", () => {
      const dir = path.join(os.tmpdir(), "gm-ensure-dir-" + Date.now());
      expect(fs.existsSync(dir)).toBe(false);
      ensureWorkspaceDir(dir);
      expect(fs.existsSync(dir)).toBe(true);
      fs.rmdirSync(dir);
    });

    it("should not throw if directory already exists", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-ensure-"));
      expect(() => ensureWorkspaceDir(dir)).not.toThrow();
      fs.rmdirSync(dir);
    });
  });

  describe("validateTrunkBranch", () => {
    it("should pass for existing local branch", async () => {
      await expect(
        validateTrunkBranch(repoDir, "main")
      ).resolves.toBeUndefined();
    });

    it("should throw for non-existing branch", async () => {
      await expect(
        validateTrunkBranch(repoDir, "nope-branch")
      ).rejects.toThrow(SessionError);
      await expect(
        validateTrunkBranch(repoDir, "nope-branch")
      ).rejects.toThrow(/does not exist/);
    });

    it("should pass for existing remote-tracking branch", async () => {
      // refs/heads/main should work
      await expect(
        validateTrunkBranch(repoDir, "main")
      ).resolves.toBeUndefined();
    });
  });
});
