/**
 * Merge Engine 测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createTempRepo, TempRepo, simulateAgentWork } from "./_helpers";
import { createWorktree, removeWorktree, getTrunkHead } from "../src/worktree";
import { MergeEngine } from "../src/merge-engine";
import type { ResolutionResult, ConflictInfo } from "../src/types";

let repo: TempRepo;

describe("Merge Engine", () => {
  beforeAll(async () => {
    repo = await createTempRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  const workspaceDir = path.join(os.tmpdir(), "gitmesh-test-me");

  function makeEngine() {
    if (!repo) throw new Error("repo not initialized");
    return new MergeEngine({
      cwd: repo.cwd,
      trunkBranch: "main",
      workspaceDir,
      branchPrefix: "mesh/",
      maxRetries: 2,
      conflictTimeout: 30000,
      strategy: "rebase-first",
    });
  }

  function wopts() {
    return {
      cwd: repo.cwd,
      workspaceDir,
      branchPrefix: "mesh/",
    };
  }

  it("should merge a single agent with no conflicts", async () => {
    const wt = await createWorktree("single-agent", "main", wopts());
    await simulateAgentWork(wt.path, "feature-a.md", "# Feature A", "feat: add feature A");

    const initialTrunkHead = await getTrunkHead(repo.cwd, "main");
    const engine = makeEngine();

    const donePromise = engine.start();
    engine.enqueue({
      agentName: "single-agent",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => ({
        resolved: false,
        reason: "should not conflict",
      }),
      retries: 0,
    });

    const results = await donePromise;

    expect(results.length).toBe(1);
    expect(results[0].status).toBe("merged");
    expect(results[0].mergeCommit).toBeTruthy();

    const newTrunkHead = await getTrunkHead(repo.cwd, "main");
    expect(newTrunkHead).not.toBe(initialTrunkHead);

    await removeWorktree("single-agent", wopts(), true);
  });

  it("should process two non-conflicting agents", async () => {
    const wt1 = await createWorktree("agent-alpha", "main", wopts());
    const wt2 = await createWorktree("agent-beta", "main", wopts());

    await simulateAgentWork(wt1.path, "alpha.md", "# Alpha work", "feat: alpha changes");
    await simulateAgentWork(wt2.path, "beta.md", "# Beta work", "feat: beta changes");

    const engine = makeEngine();
    const donePromise = engine.start();

    engine.enqueue({
      agentName: "agent-alpha",
      worktreePath: wt1.path,
      branch: wt1.branch,
      onConflict: async () => ({ resolved: false, reason: "no conflict expected" }),
      retries: 0,
    });

    engine.enqueue({
      agentName: "agent-beta",
      worktreePath: wt2.path,
      branch: wt2.branch,
      onConflict: async () => ({ resolved: false, reason: "no conflict expected" }),
      retries: 0,
    });

    const results = await donePromise;

    expect(results.length).toBe(2);
    expect(results.every((r) => r.status === "merged")).toBe(true);

    expect(fs.existsSync(path.join(repo.cwd, "alpha.md"))).toBe(true);
    expect(fs.existsSync(path.join(repo.cwd, "beta.md"))).toBe(true);

    await removeWorktree("agent-alpha", wopts(), true);
    await removeWorktree("agent-beta", wopts(), true);
  });
});
