/**
 * Session 集成测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createTempRepo, TempRepo } from "./_helpers";
import { gitmesh } from "../src/index";
import { execGit } from "../src/git";
import type { ResolutionResult, ConflictInfo, AgentWorkDoneSignal } from "../src/types";

let repo: TempRepo;
const workspaceDir = path.join(os.tmpdir(), "gitmesh-session-test");

describe("Session Integration", () => {
  beforeAll(async () => {
    repo = await createTempRepo();
  });

  afterAll(() => {
    repo.cleanup();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    // Clean git worktree metadata
    execGit(["worktree", "prune"], { cwd: repo.cwd }).catch(() => {});
  });

  it(
    "should complete a full session with one agent",
    async () => {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      execGit(["worktree", "prune"], { cwd: repo.cwd }).catch(() => {});

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "hello-world",
            onReady: async (signal: AgentWorkDoneSignal) => {
              const filePath = path.join(signal.worktreePath, "hello.md");
              fs.writeFileSync(filePath, "# Hello from agent\n");
              await execGit(["add", "hello.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "feat: hello world"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "no conflict expected",
            }),
          },
        ],
        strategy: "rebase-first",
        maxRetries: 2,
      });

      let mergedName = "";
      let mergedCommit = "";

      // Note: worktree:ready and agent:done fire during gitmesh()/start()
      // and are already past. mesh:* events fire during done().
      session.on("mesh:merged", (name: string, commit: string) => {
        mergedName = name;
        mergedCommit = commit;
      });

      const summary = await session.done();

      expect(summary.status).toBe("success");
      expect(summary.results.length).toBe(1);
      expect(summary.results[0].status).toBe("merged");
      expect(mergedName).toBe("hello-world");
      expect(mergedCommit).toBeTruthy();
      expect(fs.existsSync(path.join(repo.cwd, "hello.md"))).toBe(true);
    },
    30000
  );

  it(
    "should handle a full session with two parallel agents",
    async () => {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      execGit(["worktree", "prune"], { cwd: repo.cwd }).catch(() => {});

      const session = await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "agent-one",
            onReady: async (signal: AgentWorkDoneSignal) => {
              const filePath = path.join(signal.worktreePath, "one.md");
              fs.writeFileSync(filePath, "# Agent One\n");
              await execGit(["add", "one.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "feat: agent one"], {
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
            name: "agent-two",
            onReady: async (signal: AgentWorkDoneSignal) => {
              const filePath = path.join(signal.worktreePath, "two.md");
              fs.writeFileSync(filePath, "# Agent Two\n");
              await execGit(["add", "two.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "feat: agent two"], {
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
        maxRetries: 2,
      });

      const mergedAgents: string[] = [];
      session.on("mesh:merged", (name: string) => {
        mergedAgents.push(name);
      });

      const summary = await session.done();

      // Both agents should merge successfully
      expect(summary.results.length).toBe(2);
      expect(summary.results.every((r) => r.status === "merged")).toBe(true);
      expect(mergedAgents.length).toBe(2);

      // Both files should exist in the repo
      expect(fs.existsSync(path.join(repo.cwd, "one.md"))).toBe(true);
      expect(fs.existsSync(path.join(repo.cwd, "two.md"))).toBe(true);
    },
    30000
  );
});
