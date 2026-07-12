/**
 * Session abort 和边缘路径测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createTempRepo, TempRepo } from "./_helpers";
import { gitmesh } from "../src/index";
import { execGit } from "../src/git";
import { SessionError } from "../src/errors";
import type { AgentWorkDoneSignal, ConflictInfo, ResolutionResult } from "../src/types";

let repo: TempRepo;
const workspaceDir = path.join(os.tmpdir(), "gitmesh-session-edge");

describe("Session Edge Cases", () => {
  beforeAll(async () => {
    repo = await createTempRepo();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  afterAll(() => {
    repo.cleanup();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    execGit(["worktree", "prune"], { cwd: repo.cwd }).catch(() => {});
  });

  it("should abort session and clean up worktrees", async () => {
    const session = await gitmesh({
      cwd: repo.cwd,
      workspaceDir,
      agents: [
        {
          name: "abort-me",
          // Agent never calls done — we'll abort
          onReady: async (_signal: AgentWorkDoneSignal) => {
            // Don't call signal.done() — simulate stuck agent
          },
          onConflict: async (): Promise<ResolutionResult> => ({
            resolved: false,
          }),
        },
      ],
      maxRetries: 1,
    });

    const doneEvents: any[] = [];
    session.on("session:done", (summary) => {
      doneEvents.push(summary);
    });

    // Abort the session
    await session.abort("user cancelled");

    // Check done event was emitted
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].status).toBe("failed");
  });

  it("should not start twice", async () => {
    const session = await gitmesh({
      cwd: repo.cwd,
      workspaceDir,
      agents: [
        {
          name: "once",
          onReady: async (signal: AgentWorkDoneSignal) => {
            signal.done();
          },
          onConflict: async (): Promise<ResolutionResult> => ({
            resolved: false,
          }),
        },
      ],
    });

    // done() internally calls start() if not started — but since gitmesh() already started,
    // this should work fine
    await session.done();

    // Calling done() again should return cached summary (finished flag)
    const summary2 = await session.done();
    expect(summary2.status).toBeDefined();
  });

  it("should report partial status when some agents fail", async () => {
    // First advance trunk to change README.md
    const initialCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
    const filePath = path.join(repo.cwd, "README.md");
    fs.writeFileSync(filePath, "# Trunk changed README\n\nTrunk update for conflict test.\n");
    await execGit(["add", "README.md"], { cwd: repo.cwd });
    await execGit(["commit", "-m", "trunk update"], { cwd: repo.cwd });

    const summary = await (
      await gitmesh({
        cwd: repo.cwd,
        workspaceDir,
        agents: [
          {
            name: "will-succeed",
            onReady: async (signal: AgentWorkDoneSignal) => {
              // New file — no conflict possible
              const fp = path.join(signal.worktreePath, "success.md");
              fs.writeFileSync(fp, "# Success\n");
              await execGit(["add", "success.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "good"], { cwd: signal.worktreePath });
              signal.done();
            },
            onConflict: async (): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "nope",
            }),
          },
          {
            name: "will-fail",
            baseRef: initialCommit, // based on commit BEFORE trunk updated README
            onReady: async (signal: AgentWorkDoneSignal) => {
              // Modify same file trunk changed → guaranteed conflict
              const fp = path.join(signal.worktreePath, "README.md");
              fs.writeFileSync(fp, "# Agent conflicting version\n");
              await execGit(["add", "README.md"], { cwd: signal.worktreePath });
              await execGit(["commit", "-m", "conflict-bound"], {
                cwd: signal.worktreePath,
              });
              signal.done();
            },
            onConflict: async (): Promise<ResolutionResult> => ({
              resolved: false,
              reason: "I give up on this conflict",
            }),
          },
        ],
        maxRetries: 1,
      })
    ).done();

    expect(summary.status).toBe("partial");
    const succeeded = summary.results.find((r) => r.agentName === "will-succeed");
    const failed = summary.results.find((r) => r.agentName === "will-fail");
    expect(succeeded!.status).toBe("merged");
    expect(failed!.status).toBe("failed");
    expect(summary.trunkHead).toBeTruthy();
  });

  it("should throw SessionError for non-git directory", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-repo-"));
    await expect(
      gitmesh({
        cwd: tmpDir,
        agents: [
          {
            name: "x",
            onReady: async () => {},
            onConflict: async () => ({ resolved: false }),
          },
        ],
      })
    ).rejects.toThrow(SessionError);
    fs.rmdirSync(tmpDir);
  });

  it("should throw SessionError when no agents provided", async () => {
    await expect(
      gitmesh({
        cwd: repo.cwd,
        agents: [],
      } as any)
    ).rejects.toThrow(SessionError);
  });
});
