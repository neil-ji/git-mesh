/**
 * SDK 集成测试 — 验证 gitmesh 与主流 Git SDK 的互操作性。
 *
 * gitmesh 本身不封装 git 操作，而是为 Agent 创建隔离 worktree。
 * Agent 在 worktree 内可使用任意 Git SDK（simple-git、isomorphic-git 等）
 * 完成编码和提交。本测试文件验证这一设计承诺。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createTempRepo, TempRepo } from "./_helpers";
import { gitmesh } from "../src/index";
import { execGit } from "../src/git";
import type { ResolutionResult, ConflictInfo, AgentWorkDoneSignal } from "../src/types";

// simple-git is an optional peer — tests import it dynamically
// so the suite still compiles even if simple-git isn't installed.
const hasSimpleGit = (() => {
  try {
    require.resolve("simple-git");
    return true;
  } catch {
    return false;
  }
})();

let repo: TempRepo;
const workspaceDir = path.join(os.tmpdir(), "gitmesh-sdk-integration-test");

function cleanupWorkspace() {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  if (repo) {
    execGit(["worktree", "prune"], { cwd: repo.cwd }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// simple-git
// ---------------------------------------------------------------------------
(hasSimpleGit ? describe : describe.skip)("simple-git integration", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const simpleGit = require("simple-git");

  beforeAll(async () => {
    repo = await createTempRepo();
  });

  afterAll(() => {
    repo.cleanup();
    cleanupWorkspace();
  });

  it(
    "should merge an agent that uses simple-git for add & commit",
    async () => {
      cleanupWorkspace();

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "sg-basic",
            onReady: async (signal: AgentWorkDoneSignal) => {
              const sg = simpleGit(signal.worktreePath);
              // Use simple-git for all git operations
              const filePath = path.join(signal.worktreePath, "sg-feature.md");
              fs.writeFileSync(filePath, "# Built with simple-git\n\n- add\n- commit\n");
              await sg.add("sg-feature.md");
              await sg.commit("feat: simple-git basic workflow");
              signal.done();
            },
            onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "no conflict expected",
            }),
          },
        ],
        strategy: "rebase-first",
      });

      const summary = await session.done();
      expect(summary.status).toBe("success");
      expect(summary.results.length).toBe(1);
      expect(summary.results[0].status).toBe("merged");
      expect(summary.results[0].mergeCommit).toBeTruthy();
      expect(fs.existsSync(path.join(repo.cwd, "sg-feature.md"))).toBe(true);
    },
    30000,
  );

  it(
    "should handle multiple agents using simple-git in parallel",
    async () => {
      cleanupWorkspace();

      const mergedNames: string[] = [];
      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "sg-parallel-1",
            onReady: async (signal: AgentWorkDoneSignal) => {
              const sg = simpleGit(signal.worktreePath);
              const filePath = path.join(signal.worktreePath, "p1.txt");
              fs.writeFileSync(filePath, "parallel agent 1\n");
              await sg.add("p1.txt");
              await sg.commit("feat: p1 via simple-git");
              signal.done();
            },
            onConflict: async (): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "no conflict",
            }),
          },
          {
            name: "sg-parallel-2",
            onReady: async (signal: AgentWorkDoneSignal) => {
              const sg = simpleGit(signal.worktreePath);
              const filePath = path.join(signal.worktreePath, "p2.txt");
              fs.writeFileSync(filePath, "parallel agent 2\n");
              await sg.add("p2.txt");
              await sg.commit("feat: p2 via simple-git");
              signal.done();
            },
            onConflict: async (): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "no conflict",
            }),
          },
        ],
        strategy: "rebase-first",
        onMerged: (name) => {
          mergedNames.push(name);
        },
      });

      const summary = await session.done();
      expect(summary.status).toBe("success");
      expect(summary.results.length).toBe(2);
      expect(summary.results.every((r) => r.status === "merged")).toBe(true);
      expect(mergedNames.length).toBe(2);
      expect(fs.existsSync(path.join(repo.cwd, "p1.txt"))).toBe(true);
      expect(fs.existsSync(path.join(repo.cwd, "p2.txt"))).toBe(true);
    },
    30000,
  );

  it(
    "should work when simple-git agent uses status and log before committing",
    async () => {
      cleanupWorkspace();

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "sg-inspect",
            onReady: async (signal: AgentWorkDoneSignal) => {
              const sg = simpleGit(signal.worktreePath);

              // Agent inspects repo state before working
              const status = await sg.status();
              expect(status.current).toBeTruthy();

              const log = await sg.log();
              expect(log.all.length).toBeGreaterThan(0);

              // Make changes
              const filePath = path.join(signal.worktreePath, "inspected.txt");
              fs.writeFileSync(filePath, `branch was: ${status.current}\n`);
              await sg.add("inspected.txt");
              await sg.commit("feat: inspected state via simple-git");

              signal.done();
            },
            onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "no conflict expected",
            }),
          },
        ],
        strategy: "rebase-first",
      });

      const summary = await session.done();
      expect(summary.status).toBe("success");
      expect(fs.existsSync(path.join(repo.cwd, "inspected.txt"))).toBe(true);
    },
    30000,
  );

  it(
    "should handle conflict resolution when agent uses simple-git to inspect and resolve",
    async () => {
      cleanupWorkspace();

      // Save the commit before adding shared file, so we can create a conflict scenario
      const baseCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });

      // Add shared file to trunk (this simulates "trunk advanced")
      const sharedFile = path.join(repo.cwd, "shared.md");
      fs.writeFileSync(sharedFile, "# Shared File\n\nInitial content.\n");
      await execGit(["add", "shared.md"], { cwd: repo.cwd });
      await execGit(["commit", "-m", "add shared file"], { cwd: repo.cwd });

      let conflictResolved = false;

      // Agent 1: creates worktree from the commit BEFORE shared.md was added,
      // then adds shared.md with its own content → conflict with trunk
      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "sg-conflict",
            baseRef: baseCommit,
            onReady: async (signal: AgentWorkDoneSignal) => {
              const sg = simpleGit(signal.worktreePath);
              const fp = path.join(signal.worktreePath, "shared.md");
              // Agent adds the same file with different content
              fs.writeFileSync(fp, "# Shared File\n\nAgent version via simple-git.\n");
              await sg.add("shared.md");
              await sg.commit("feat: agent adds shared.md via simple-git");
              signal.done();
            },
            onConflict: async (info: ConflictInfo): Promise<ResolutionResult> => {
              // Use simple-git to inspect repo state during conflict
              const sg = simpleGit(info.worktreePath);
              const status = await sg.status();
              // Status should reflect conflicted state
              expect(status.conflicted.length).toBeGreaterThan(0);

              // Read the conflicted file
              const fp = path.join(info.worktreePath, "shared.md");
              const content = fs.readFileSync(fp, "utf-8");
              expect(content).toContain("<<<<<<<");

              // Resolve: keep merged version
              // Note: continueRebase() calls git add . internally,
              // so we only need to write the resolved content here
              const resolved =
                "# Shared File\n\nMerged: trunk + agent via simple-git.\n";
              fs.writeFileSync(fp, resolved);

              conflictResolved = true;
              return { resolved: true };
            },
          },
        ],
        strategy: "rebase-first",
        maxRetries: 3,
      });

      const summary = await session.done();
      expect(conflictResolved).toBe(true);
      expect(summary.status).toBe("success");
      expect(summary.results[0].status).toBe("merged");

      // Verify merged content is in trunk
      const mergedContent = fs.readFileSync(
        path.join(repo.cwd, "shared.md"),
        "utf-8",
      );
      expect(mergedContent).toContain("Merged: trunk + agent via simple-git");
    },
    30000,
  );
});

// ---------------------------------------------------------------------------
// Mixed SDK: simple-git + raw CLI agents in same session
// ---------------------------------------------------------------------------
(hasSimpleGit ? describe : describe.skip)("mixed SDK session", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const simpleGit = require("simple-git");

  beforeAll(async () => {
    repo = await createTempRepo();
  });

  afterAll(() => {
    repo.cleanup();
    cleanupWorkspace();
  });

  it(
    "should handle agents using different git tools in the same session",
    async () => {
      cleanupWorkspace();

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "raw-cli-agent",
            onReady: async (signal: AgentWorkDoneSignal) => {
              // This agent uses raw git CLI (like gitmesh internals do)
              const fp = path.join(signal.worktreePath, "from-cli.md");
              fs.writeFileSync(fp, "# Made with raw git CLI\n");
              await execGit(["add", "from-cli.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "feat: raw CLI agent"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            onConflict: async (): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "no conflict",
            }),
          },
          {
            name: "simple-git-agent",
            onReady: async (signal: AgentWorkDoneSignal) => {
              const sg = simpleGit(signal.worktreePath);
              const fp = path.join(signal.worktreePath, "from-sg.md");
              fs.writeFileSync(fp, "# Made with simple-git\n");
              await sg.add("from-sg.md");
              await sg.commit("feat: simple-git agent");
              signal.done();
            },
            onConflict: async (): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "no conflict",
            }),
          },
        ],
        strategy: "rebase-first",
      });

      const summary = await session.done();
      expect(summary.status).toBe("success");
      expect(summary.results.length).toBe(2);
      expect(summary.results.every((r) => r.status === "merged")).toBe(true);

      // Both files should land on trunk, regardless of which SDK was used
      expect(fs.existsSync(path.join(repo.cwd, "from-cli.md"))).toBe(true);
      expect(fs.existsSync(path.join(repo.cwd, "from-sg.md"))).toBe(true);
    },
    30000,
  );
});

// ---------------------------------------------------------------------------
// AgentResult.worktreePath contract — SDK-agnostic
// ---------------------------------------------------------------------------
describe("AgentResult.worktreePath contract", () => {
  beforeAll(async () => {
    repo = await createTempRepo();
  });

  afterAll(() => {
    repo.cleanup();
    cleanupWorkspace();
  });

  it(
    "should expose worktreePath on success so SDKs can inspect or clean up",
    async () => {
      cleanupWorkspace();

      let capturedWorktreePath = "";

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "path-check",
            onReady: async (signal: AgentWorkDoneSignal) => {
              capturedWorktreePath = signal.worktreePath;
              // Verify the worktree path exists and is a git repo
              expect(fs.existsSync(signal.worktreePath)).toBe(true);
              expect(fs.existsSync(path.join(signal.worktreePath, ".git"))).toBe(true);

              const fp = path.join(signal.worktreePath, "path-test.txt");
              fs.writeFileSync(fp, "worktreePath contract test\n");
              await execGit(["add", "path-test.txt"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "test: path contract"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            onConflict: async (): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "no conflict",
            }),
          },
        ],
        strategy: "rebase-first",
      });

      const summary = await session.done();
      expect(summary.status).toBe("success");
      // The AgentResult should carry the same worktreePath
      expect(summary.results[0].worktreePath).toBe(capturedWorktreePath);
    },
    30000,
  );
});
