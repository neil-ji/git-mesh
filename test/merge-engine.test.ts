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
import { rebaseBranch } from "../src/rebase";
import {
  checkWorkingTreeClean,
  fastForwardMerge,
  refOnlyMerge,
  squashMerge,
} from "../src/merge";
import { autoResolveConflicts } from "../src/conflict";
import type { ResolutionResult, ConflictInfo, ConflictFile } from "../src/types";

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
      conflictStrategy: "route-to-agent",
      mergeStrategy: "ff-only",
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
      conflictStrategy: "route-to-agent",
      mergeStrategy: "ff-only",
    });

    engine.enqueue({
      agentName: "agent-beta",
      worktreePath: wt2.path,
      branch: wt2.branch,
      onConflict: async () => ({ resolved: false, reason: "no conflict expected" }),
      retries: 0,
      conflictStrategy: "route-to-agent",
      mergeStrategy: "ff-only",
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
      conflictStrategy: "route-to-agent",
      mergeStrategy: "ff-only",
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
      conflictStrategy: "route-to-agent",
      mergeStrategy: "ff-only",
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

  // === Merge strategies: squash ===

  it("squashMerge should squash agent commits into one", async () => {
    const wt = await createWorktree("squash-test", "main", wopts());
    // Make two commits — squash should compress them into one
    await simulateAgentWork(wt.path, "s1.md", "# S1", "feat: first");
    await simulateAgentWork(wt.path, "s2.md", "# S2", "feat: second");

    const initialHead = await getTrunkHead(repo.cwd, "main");
    const newHead = await squashMerge(
      wt.branch, "main", repo.cwd,
      "squash: combined commit"
    );

    expect(newHead).not.toBe(initialHead);

    // Verify files are on trunk
    expect(fs.existsSync(path.join(repo.cwd, "s1.md"))).toBe(true);
    expect(fs.existsSync(path.join(repo.cwd, "s2.md"))).toBe(true);

    // Verify it's a single commit with our message
    const log = await execGit(["log", "-1", "--format=%s"], { cwd: repo.cwd });
    expect(log).toBe("squash: combined commit");

    await removeWorktree("squash-test", wopts(), true);
  });

  it("squashMerge should throw on dirty working tree", async () => {
    const wt = await createWorktree("sq-dirty", "main", wopts());
    await simulateAgentWork(wt.path, "sd.md", "# SD", "feat: sd");

    const dirtyFile = path.join(repo.cwd, "temp.log");
    fs.writeFileSync(dirtyFile, "dirty");

    try {
      await expect(
        squashMerge(wt.branch, "main", repo.cwd, "msg")
      ).rejects.toThrow(/Working tree is not clean/);
    } finally {
      fs.unlinkSync(dirtyFile);
      await removeWorktree("sq-dirty", wopts(), true);
    }
  });

  it("squash merge via MergeEngine should work end-to-end", async () => {
    const wt = await createWorktree("sq-engine", "main", wopts());
    // Two commits
    await simulateAgentWork(wt.path, "se1.md", "# SE1", "feat: one");
    await simulateAgentWork(wt.path, "se2.md", "# SE2", "feat: two");

    const engine = new MergeEngine({
      cwd: repo.cwd,
      trunkBranch: "main",
      workspaceDir,
      branchPrefix: "mesh/",
      maxRetries: 2,
      conflictTimeout: 30000,
      strategy: "rebase-first",
    });

    const donePromise = engine.start();
    engine.enqueue({
      agentName: "sq-engine",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async () => ({ resolved: false, reason: "no" }),
      retries: 0,
      conflictStrategy: "route-to-agent",
      mergeStrategy: "squash",
      squashMessage: "squash: engine test",
    });

    const results = await donePromise;
    expect(results[0].status).toBe("merged");

    const log = await execGit(["log", "-1", "--format=%s"], { cwd: repo.cwd });
    expect(log).toBe("squash: engine test");

    await removeWorktree("sq-engine", wopts(), true);
  });

  // === Conflict strategies: accept-agent / accept-trunk ===

  it("conflictStrategy accept-trunk should skip agent callback", async () => {
    // First, advance trunk with a change to a file the agent will also touch
    const conflictFile = "shared.md";
    fs.writeFileSync(path.join(repo.cwd, conflictFile), "# Trunk version\n");
    await execGit(["add", conflictFile], { cwd: repo.cwd });
    await execGit(["commit", "-m", "trunk: add shared file"], { cwd: repo.cwd });

    // Now create a worktree from BEFORE the trunk change (on the initial commit)
    const initialCommit = await execGit(["rev-parse", "HEAD~1"], { cwd: repo.cwd });
    const wt = await createWorktree("cs-trunk", initialCommit, {
      ...wopts(),
      baseRef: initialCommit,
    });
    // Agent modifies the same file
    fs.writeFileSync(path.join(wt.path, conflictFile), "# Agent version\n");
    await execGit(["add", conflictFile], { cwd: wt.path });
    await execGit(["commit", "-m", "agent: modify shared"], { cwd: wt.path });

    let agentCallbackCalled = false;

    const engine = new MergeEngine({
      cwd: repo.cwd,
      trunkBranch: "main",
      workspaceDir,
      branchPrefix: "mesh/",
      maxRetries: 2,
      conflictTimeout: 30000,
      strategy: "rebase-first",
    });

    const donePromise = engine.start();
    engine.enqueue({
      agentName: "cs-trunk",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async () => {
        agentCallbackCalled = true;
        return { resolved: false };
      },
      retries: 0,
      conflictStrategy: "accept-trunk",  // should skip callback
      mergeStrategy: "ff-only",
    });

    const results = await donePromise;
    // accept-trunk: trunk version wins
    // Agent's conflicting change is discarded, so the file stays as trunk version
    expect(agentCallbackCalled).toBe(false);

    await removeWorktree("cs-trunk", wopts(), true);
  });

  it("conflictStrategy accept-agent should keep agent version", async () => {
    // Advance trunk with a conflicting change
    const conflictFile = "agent-wins.md";
    fs.writeFileSync(path.join(repo.cwd, conflictFile), "# Trunk change\n");
    await execGit(["add", conflictFile], { cwd: repo.cwd });
    await execGit(["commit", "-m", "trunk: add file"], { cwd: repo.cwd });

    const initialCommit = await execGit(["rev-parse", "HEAD~1"], { cwd: repo.cwd });
    const wt = await createWorktree("cs-agent", initialCommit, {
      ...wopts(),
      baseRef: initialCommit,
    });
    fs.writeFileSync(path.join(wt.path, conflictFile), "# Agent change\n");
    await execGit(["add", conflictFile], { cwd: wt.path });
    await execGit(["commit", "-m", "agent: modify"], { cwd: wt.path });

    const engine = new MergeEngine({
      cwd: repo.cwd,
      trunkBranch: "main",
      workspaceDir,
      branchPrefix: "mesh/",
      maxRetries: 2,
      conflictTimeout: 30000,
      strategy: "rebase-first",
    });

    const donePromise = engine.start();
    engine.enqueue({
      agentName: "cs-agent",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async () => ({ resolved: false }),
      retries: 0,
      conflictStrategy: "accept-agent",  // agent version wins
      mergeStrategy: "ff-only",
    });

    const results = await donePromise;
    expect(results[0].status).toBe("merged");

    // Accept-agent: agent's version should be on trunk
    const content = fs.readFileSync(path.join(repo.cwd, conflictFile), "utf-8");
    expect(content).toContain("Agent change");

    await removeWorktree("cs-agent", wopts(), true);
  });

  // === Rebase dirty-tree protection ===

  it("rebaseBranch should throw on dirty worktree", async () => {
    const wt = await createWorktree("rb-dirty", "main", wopts());
    // Create a dirty file without committing
    fs.writeFileSync(path.join(wt.path, "uncommitted.txt"), "dirty");

    try {
      await expect(
        rebaseBranch(wt.path, "main")
      ).rejects.toThrow(/Worktree is not clean/);
    } finally {
      await removeWorktree("rb-dirty", wopts(), true);
    }
  });

  it("onBeforeRebase hook should be called before rebase", async () => {
    const wt = await createWorktree("hook-rb", "main", wopts());
    await simulateAgentWork(wt.path, "hr.md", "# HR", "feat: hr");

    let hookCalled = false;

    const engine = new MergeEngine({
      cwd: repo.cwd,
      trunkBranch: "main",
      workspaceDir,
      branchPrefix: "mesh/",
      maxRetries: 2,
      conflictTimeout: 30000,
      strategy: "rebase-first",
      onBeforeRebase: () => {
        hookCalled = true;
      },
    });

    const donePromise = engine.start();
    engine.enqueue({
      agentName: "hook-rb",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async () => ({ resolved: false, reason: "no" }),
      retries: 0,
      conflictStrategy: "route-to-agent",
      mergeStrategy: "ff-only",
    });

    const results = await donePromise;
    expect(results[0].status).toBe("merged");
    expect(hookCalled).toBe(true);

    await removeWorktree("hook-rb", wopts(), true);
  });
});
