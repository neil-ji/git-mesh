/**
 * Merge Engine 测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createTempRepo, TempRepo, simulateAgentWork } from "./_helpers";
import { createWorktree, removeWorktree, getTrunkHead } from "../src/worktree";
import { execGit } from "../src/git";
import { MergeEngine } from "../src/merge-engine";
import {
  checkWorkingTreeClean,
  fastForwardMerge,
  refOnlyMerge,
} from "../src/merge";
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

  // === Layer 1: Dirty-tree detection ===

  it("checkWorkingTreeClean should return empty for clean repo", async () => {
    const dirty = await checkWorkingTreeClean(repo.cwd);
    expect(dirty).toEqual([]);
  });

  it("checkWorkingTreeClean should detect dirty files", async () => {
    const dirtyFile = path.join(repo.cwd, "untracked.log");
    fs.writeFileSync(dirtyFile, "temp data");
    try {
      const dirty = await checkWorkingTreeClean(repo.cwd);
      expect(dirty.length).toBeGreaterThan(0);
      expect(dirty.some((f) => f.includes("untracked.log"))).toBe(true);
    } finally {
      fs.unlinkSync(dirtyFile);
    }
  });

  it("fastForwardMerge should throw on dirty working tree", async () => {
    const wt = await createWorktree("dirty-test", "main", wopts());
    await simulateAgentWork(wt.path, "dirty.md", "# Dirty", "feat: dirty");

    // Dirty the main repo
    const dirtyFile = path.join(repo.cwd, "temp-artifact.txt");
    fs.writeFileSync(dirtyFile, "build output");

    try {
      await expect(
        fastForwardMerge(wt.branch, "main", repo.cwd)
      ).rejects.toThrow(/Working tree is not clean/);
    } finally {
      fs.unlinkSync(dirtyFile);
      await removeWorktree("dirty-test", wopts(), true);
    }
  });

  // === Layer 2: onBeforeMerge hook ===

  it("should call onBeforeMerge hook before merge", async () => {
    const wt = await createWorktree("hook-test", "main", wopts());
    await simulateAgentWork(wt.path, "hook.md", "# Hook", "feat: hook");

    let hookCalled = false;

    const engine = new MergeEngine({
      cwd: repo.cwd,
      trunkBranch: "main",
      workspaceDir,
      branchPrefix: "mesh/",
      maxRetries: 2,
      conflictTimeout: 30000,
      strategy: "rebase-first",
      onBeforeMerge: () => {
        hookCalled = true;
      },
    });

    const donePromise = engine.start();
    engine.enqueue({
      agentName: "hook-test",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async () => ({ resolved: false, reason: "no" }),
      retries: 0,
    });

    const results = await donePromise;
    expect(results[0].status).toBe("merged");
    expect(hookCalled).toBe(true);

    await removeWorktree("hook-test", wopts(), true);
  });

  it("should pass error from onBeforeMerge to caller", async () => {
    const wt = await createWorktree("hook-err", "main", wopts());
    await simulateAgentWork(wt.path, "he.md", "# HE", "feat: he");

    const engine = new MergeEngine({
      cwd: repo.cwd,
      trunkBranch: "main",
      workspaceDir,
      branchPrefix: "mesh/",
      maxRetries: 2,
      conflictTimeout: 30000,
      strategy: "rebase-first",
      onBeforeMerge: () => {
        throw new Error("cleanup failed");
      },
    });

    const donePromise = engine.start();
    engine.enqueue({
      agentName: "hook-err",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async () => ({ resolved: false, reason: "no" }),
      retries: 0,
    });

    const results = await donePromise;
    expect(results[0].status).toBe("failed");
    expect(results[0].reason).toContain("cleanup failed");

    await removeWorktree("hook-err", wopts(), true);
  });

  // === Layer 3: ref-only merge ===

  it("refOnlyMerge should update trunk ref without touching working tree", async () => {
    const wt = await createWorktree("refonly", "main", wopts());
    await simulateAgentWork(wt.path, "refonly.md", "# RefOnly", "feat: refonly");

    // Dirty the main repo — ref-only mode should still work
    const dirtyFile = path.join(repo.cwd, "build-output.txt");
    fs.writeFileSync(dirtyFile, "dirty working tree");

    const initialHead = await getTrunkHead(repo.cwd, "main");

    try {
      // refOnlyMerge should succeed despite dirty tree
      const newHead = await refOnlyMerge(wt.branch, "main", repo.cwd);
      expect(newHead).not.toBe(initialHead);

      // Working tree is still dirty (untouched)
      const dirty = await checkWorkingTreeClean(repo.cwd);
      expect(dirty.length).toBeGreaterThan(0);

      // But the ref has advanced
      const trunkHead = await getTrunkHead(repo.cwd, "main");
      expect(trunkHead).toBe(newHead);

      // Sync working tree to clean up for subsequent tests
      await execGit(["checkout", "main"], { cwd: repo.cwd });
      await execGit(["reset", "--hard", "main"], { cwd: repo.cwd });
    } finally {
      if (fs.existsSync(dirtyFile)) {
        try { fs.unlinkSync(dirtyFile); } catch {}
      }
    }

    await removeWorktree("refonly", wopts(), true);
  });

  it("mergeMode ref-only via MergeEngine should work with dirty tree", async () => {
    const wt = await createWorktree("refonly-me", "main", wopts());
    await simulateAgentWork(wt.path, "rome.md", "# ROME", "feat: refonly-me");

    // Dirty the main repo
    const dirtyFile = path.join(repo.cwd, "ci-artifact.txt");
    fs.writeFileSync(dirtyFile, "ci build output");

    try {
      const engine = new MergeEngine({
        cwd: repo.cwd,
        trunkBranch: "main",
        workspaceDir,
        branchPrefix: "mesh/",
        maxRetries: 2,
        conflictTimeout: 30000,
        strategy: "rebase-first",
        mergeMode: "ref-only",
      });

      const donePromise = engine.start();
      engine.enqueue({
        agentName: "refonly-me",
        worktreePath: wt.path,
        branch: wt.branch,
        onConflict: async () => ({ resolved: false, reason: "no" }),
        retries: 0,
      });

      const results = await donePromise;
      expect(results[0].status).toBe("merged");

      // Sync working tree for subsequent tests
      await execGit(["checkout", "main"], { cwd: repo.cwd });
      await execGit(["reset", "--hard", "main"], { cwd: repo.cwd });
    } finally {
      if (fs.existsSync(dirtyFile)) {
        try { fs.unlinkSync(dirtyFile); } catch {}
      }
    }

    await removeWorktree("refonly-me", wopts(), true);
  });
});
