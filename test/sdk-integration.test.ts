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
import { buildConflictPrompt } from "../src/conflict";
import type { ResolutionResult, ConflictInfo, AgentWorkDoneSignal, ConflictResolutionParams } from "../src/types";

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

// ---------------------------------------------------------------------------
// resolveConflict mode — gitmesh-managed conflict loop
// ---------------------------------------------------------------------------
describe("resolveConflict mode", () => {
  beforeAll(async () => {
    repo = await createTempRepo();
  });

  afterAll(() => {
    repo.cleanup();
    cleanupWorkspace();
  });

  it(
    "should auto-resolve conflict via resolveConflict callback",
    async () => {
      cleanupWorkspace();

      // Create real conflict: trunk modifies README, agent modifies same file from old base
      const baseCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
      // Trunk: modify README.md
      fs.writeFileSync(path.join(repo.cwd, "README.md"), "# Trunk version\n\nTrunk changes.\n");
      await execGit(["add", "README.md"], { cwd: repo.cwd });
      await execGit(["commit", "-m", "trunk modifies readme"], { cwd: repo.cwd });

      let receivedPrompt = "";
      let receivedWorktreePath = "";

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "rc-test",
            baseRef: baseCommit,
            onReady: async (signal: AgentWorkDoneSignal) => {
              // Agent modifies same file from old base → conflict
              const fp = path.join(signal.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Agent version\n\nAgent changes.\n");
              await execGit(["add", "README.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "agent changes readme"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            resolveConflict: async (params: ConflictResolutionParams) => {
              receivedPrompt = params.prompt;
              receivedWorktreePath = params.worktreePath;

              // Verify params are well-formed
              expect(params.prompt).toContain("rc-test");
              expect(params.prompt).toContain("README.md");
              expect(params.conflict.agentName).toBe("rc-test");
              expect(fs.existsSync(params.worktreePath)).toBe(true);

              // Resolve: overwrite with merged content
              const fp = path.join(params.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Resolved by rc-test\n\nMerged.\n");
            },
          },
        ],
        strategy: "rebase-first",
        maxRetries: 3,
      });

      const summary = await session.done();

      expect(receivedPrompt).toBeTruthy();
      expect(receivedWorktreePath).toBeTruthy();
      expect(summary.status).toBe("success");
      expect(summary.results[0].status).toBe("merged");
    },
    30000,
  );

  it(
    "should prefer onConflict over resolveConflict when both are set",
    async () => {
      cleanupWorkspace();

      // Create real conflict
      const baseCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
      fs.writeFileSync(path.join(repo.cwd, "README.md"), "# Trunk priority test\n");
      await execGit(["add", "README.md"], { cwd: repo.cwd });
      await execGit(["commit", "-m", "trunk changes readme"], { cwd: repo.cwd });

      let onConflictCalled = false;
      let resolveConflictCalled = false;

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "priority-test",
            baseRef: baseCommit,
            onReady: async (signal: AgentWorkDoneSignal) => {
              const fp = path.join(signal.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Agent priority test\n");
              await execGit(["add", "README.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "agent changes"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            // Both are set — onConflict should win (highest priority)
            onConflict: async (conflict: ConflictInfo): Promise<ResolutionResult> => {
              onConflictCalled = true;
              // Resolve the conflict
              const fp = path.join(conflict.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Resolved priority\n");
              return { resolved: true };
            },
            resolveConflict: async () => {
              resolveConflictCalled = true;
            },
          },
        ],
        strategy: "rebase-first",
        maxRetries: 3,
      });

      await session.done();
      expect(onConflictCalled).toBe(true);
      expect(resolveConflictCalled).toBe(false);
    },
    30000,
  );

  it(
    "should fail when resolveConflict throws an error",
    async () => {
      cleanupWorkspace();

      const baseCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
      fs.writeFileSync(path.join(repo.cwd, "README.md"), "# Trunk error test\n");
      await execGit(["add", "README.md"], { cwd: repo.cwd });
      await execGit(["commit", "-m", "trunk changes readme"], { cwd: repo.cwd });

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "throw-test",
            baseRef: baseCommit,
            onReady: async (signal: AgentWorkDoneSignal) => {
              const fp = path.join(signal.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Agent error test\n");
              await execGit(["add", "README.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "agent changes"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            resolveConflict: async () => {
              throw new Error("agent crashed during conflict resolution");
            },
          },
        ],
        strategy: "rebase-first",
        maxRetries: 1,
      });

      const summary = await session.done();
      expect(summary.results[0].status).toBe("failed");
      expect(summary.results[0].reason).toContain("agent crashed");
    },
    30000,
  );

  it(
    "should pass structured conflict info alongside prompt",
    async () => {
      cleanupWorkspace();

      const baseCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
      fs.writeFileSync(path.join(repo.cwd, "README.md"), "# Trunk struct test\n");
      await execGit(["add", "README.md"], { cwd: repo.cwd });
      await execGit(["commit", "-m", "trunk changes readme"], { cwd: repo.cwd });

      let capturedConflict: ConflictInfo | null = null;
      let verifyPrompt = "";

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "struct-test",
            baseRef: baseCommit,
            onReady: async (signal: AgentWorkDoneSignal) => {
              const fp = path.join(signal.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Agent struct test\n");
              await execGit(["add", "README.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "agent changes"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            resolveConflict: async (params: ConflictResolutionParams) => {
              capturedConflict = params.conflict;
              verifyPrompt = params.prompt;

              // Resolve
              const fp = path.join(params.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Resolved struct\n");

              // Verify the prompt was generated from the same conflict data
              const regenerated = buildConflictPrompt(params.conflict);
              expect(verifyPrompt).toBe(regenerated);
            },
          },
        ],
        strategy: "rebase-first",
        maxRetries: 3,
      });

      await session.done();

      expect(capturedConflict).not.toBeNull();
      expect(capturedConflict!.agentName).toBe("struct-test");
      expect(capturedConflict!.files.length).toBeGreaterThan(0);
      expect(capturedConflict!.attempt).toBeGreaterThan(0);
      expect(capturedConflict!.worktreePath).toBeTruthy();
    },
    30000,
  );

  it(
    "should pass runPrompt through to resolveConflict params when set in AgentDefinition",
    async () => {
      cleanupWorkspace();

      const baseCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
      fs.writeFileSync(path.join(repo.cwd, "README.md"), "# Trunk runPrompt test\n");
      await execGit(["add", "README.md"], { cwd: repo.cwd });
      await execGit(["commit", "-m", "trunk changes readme"], { cwd: repo.cwd });

      let receivedRunPrompt: any = undefined;
      let runPromptCalled = false;

      // Simulate a reusable agent session
      const runPromptFn = async (p: string) => {
        runPromptCalled = true;
        return { success: true, output: `resolved: ${p.slice(0, 20)}...` };
      };

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "runprompt-test",
            baseRef: baseCommit,
            onReady: async (signal: AgentWorkDoneSignal) => {
              const fp = path.join(signal.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Agent runprompt test\n");
              await execGit(["add", "README.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "agent changes"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            runPrompt: runPromptFn,
            resolveConflict: async (params: ConflictResolutionParams) => {
              receivedRunPrompt = params.runPrompt;

              // Verify runPrompt is available
              expect(params.runPrompt).toBeDefined();
              expect(typeof params.runPrompt).toBe("function");

              // Use runPrompt to send a message to the agent session
              const result = await params.runPrompt!(
                `Please resolve the conflict in README.md`
              );
              expect(result.success).toBe(true);
              expect(result.output).toBeTruthy();

              // Actually resolve the conflict
              const fp = path.join(params.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Resolved via runPrompt\n");
            },
          },
        ],
        strategy: "rebase-first",
        maxRetries: 3,
      });

      await session.done();

      expect(receivedRunPrompt).toBeDefined();
      expect(runPromptCalled).toBe(true);
    },
    30000,
  );
});
