/**
 * Merge Engine 冲突、重试、失败路径测试
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createTempRepo, TempRepo, advanceTrunk, simulateAgentWork } from "./_helpers";
import { createWorktree, removeWorktree, getTrunkHead } from "../src/worktree";
import { MergeEngine } from "../src/merge-engine";
import { execGit } from "../src/git";
import type { ResolutionResult, ConflictInfo } from "../src/types";

let repo: TempRepo;

describe("Merge Engine — Conflict & Retry", () => {
  beforeAll(async () => {
    repo = await createTempRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  const workspaceDir = path.join(os.tmpdir(), "gitmesh-test-mc");

  function wopts() {
    return { cwd: repo.cwd, workspaceDir, branchPrefix: "mesh/" };
  }

  function makeEngine(maxRetries = 3) {
    return new MergeEngine({
      cwd: repo.cwd,
      trunkBranch: "main",
      workspaceDir,
      branchPrefix: "mesh/",
      maxRetries,
      conflictTimeout: 30000,
      strategy: "rebase-first",
    });
  }

  it("should fail when agent abandons conflict resolution", async () => {
    // Save current HEAD, then advance trunk
    const initialCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
    await advanceTrunk(repo.cwd, "README.md", "# Trunk modified README\n\nTrunk updated.\n");

    // Create worktree from old commit — agent modifies same file as trunk
    const wt = await createWorktree("abandon-agent", initialCommit, wopts());
    await simulateAgentWork(
      wt.path,
      "README.md",
      "# Agent modified README\n\nAgent's version.\n",
      "feat: agent changed readme"
    );

    const engine = makeEngine(2);
    const donePromise = engine.start();

    engine.enqueue({
      agentName: "abandon-agent",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => ({
        resolved: false,
        reason: "too complex, giving up",
      }),
      retries: 0,
    });

    const results = await donePromise;

    expect(results.length).toBe(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].reason).toContain("too complex");

    // Clean up
    await removeWorktree("abandon-agent", wopts(), true);
  });

  it("should retry and succeed when agent resolves conflict", async () => {
    const initialCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });

    // Add a new file on trunk
    await advanceTrunk(
      repo.cwd,
      "config.json",
      '{"version": "2.0", "name": "trunk-version"}\n'
    );

    // Agent creates worktree from old commit and adds same file with different content
    const wt = await createWorktree("resolve-agent", initialCommit, wopts());
    await simulateAgentWork(
      wt.path,
      "config.json",
      '{"version": "1.0", "name": "agent-version"}\n',
      "feat: agent's config"
    );

    const engine = makeEngine(3);
    const donePromise = engine.start();

    engine.enqueue({
      agentName: "resolve-agent",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async (conflict: ConflictInfo): Promise<ResolutionResult> => {
        // Agent resolves the conflict by picking a merged version
        const filePath = path.join(conflict.worktreePath, "config.json");
        fs.writeFileSync(
          filePath,
          '{"version": "3.0", "name": "merged-version"}\n'
        );
        return { resolved: true };
      },
      retries: 0,
    });

    const results = await donePromise;

    expect(results.length).toBe(1);
    expect(results[0].status).toBe("merged");
    expect(results[0].mergeCommit).toBeTruthy();

    // Verify merged content is in trunk
    const configContent = fs.readFileSync(
      path.join(repo.cwd, "config.json"),
      "utf-8"
    );
    expect(configContent).toContain("merged-version");

    await removeWorktree("resolve-agent", wopts(), true);
  });

  it("should fail when max retries exhausted", async () => {
    const initialCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });

    await advanceTrunk(repo.cwd, "README.md", "# Trunk v4\n\nTrunk changes.\n");

    const wt = await createWorktree("exhaust-agent", initialCommit, wopts());
    await simulateAgentWork(
      wt.path,
      "README.md",
      "# Agent v4\n\nAgent changes.\n",
      "feat: agent's readme v4"
    );

    const engine = makeEngine(1); // maxRetries=1 means 0 actual retries
    const donePromise = engine.start();
    let errorsThrown = 0;

    engine.enqueue({
      agentName: "exhaust-agent",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => {
        errorsThrown++;
        // Throw an error each time — triggers the unknown error path
        // which aborts rebase and retries. After maxRetries, it fails.
        throw new Error("agent crashed during conflict resolution");
      },
      retries: 0,
    });

    const results = await donePromise;

    expect(results.length).toBe(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].reason).toContain("retries exhausted");

    await removeWorktree("exhaust-agent", wopts(), true);
  });

  it("should clean up successful worktrees and leave failed ones", async () => {
    // Create one agent that will succeed
    const wtGood = await createWorktree("good-agent", "main", wopts());
    await simulateAgentWork(wtGood.path, "good.md", "# Good work", "feat: good");

    // Create one that will fail
    const initialCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
    await advanceTrunk(repo.cwd, "README.md", "# Trunk v5\n\nConflict coming.\n");
    const wtBad = await createWorktree("bad-agent", initialCommit, wopts());
    await simulateAgentWork(wtBad.path, "README.md", "# Agent v5\n\nConflict!\n", "feat: bad conflict");

    const engine = makeEngine(1);
    const donePromise = engine.start();

    engine.enqueue({
      agentName: "good-agent",
      worktreePath: wtGood.path,
      branch: wtGood.branch,
      onConflict: async () => ({ resolved: false }),
      retries: 0,
    });

    engine.enqueue({
      agentName: "bad-agent",
      worktreePath: wtBad.path,
      branch: wtBad.branch,
      onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => ({
        resolved: false,
        reason: "giving up",
      }),
      retries: 0,
    });

    const results = await donePromise;

    const good = results.find((r) => r.agentName === "good-agent")!;
    const bad = results.find((r) => r.agentName === "bad-agent")!;

    expect(good.status).toBe("merged");

    // Cleanup successful — good agent's worktree should be cleaned
    await engine.cleanupSuccessful();
    expect(fs.existsSync(wtGood.path)).toBe(false);
    // Failed agent's worktree should remain
    expect(fs.existsSync(wtBad.path)).toBe(true);

    // Manual cleanup
    await removeWorktree("bad-agent", wopts(), true);
  });

  it("should emit events for conflict and retry", async () => {
    const initialCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });
    await advanceTrunk(repo.cwd, "README.md", "# Trunk v6\n\nMore conflicts.\n");

    const wt = await createWorktree("event-agent", initialCommit, wopts());
    await simulateAgentWork(wt.path, "README.md", "# Agent v6\n\nAgent's README.\n", "feat: event agent changes");

    const engine = makeEngine(3);
    const events: string[] = [];

    engine.on("mesh:rebase", (name: string) => events.push(`rebase:${name}`));
    engine.on("mesh:conflict", (info: ConflictInfo) => {
      events.push(`conflict:${info.agentName}:${info.attempt}`);
    });
    engine.on("mesh:retry", (name: string, attempt: number) =>
      events.push(`retry:${name}:${attempt}`)
    );
    engine.on("mesh:merged", (name: string) => events.push(`merged:${name}`));
    engine.on("mesh:failed", (name: string, reason: string) =>
      events.push(`failed:${name}`)
    );

    const donePromise = engine.start();

    engine.enqueue({
      agentName: "event-agent",
      worktreePath: wt.path,
      branch: wt.branch,
      onConflict: async (conflict: ConflictInfo): Promise<ResolutionResult> => {
        // Resolve on first attempt
        const filePath = path.join(conflict.worktreePath, "README.md");
        fs.writeFileSync(filePath, "# Merged README v6\n\nResolved.\n");
        return { resolved: true };
      },
      retries: 0,
    });

    await donePromise;

    // First rebase → conflict → retry → resolve → merge
    expect(events.filter((e) => e.startsWith("rebase:"))).toHaveLength(1);
    expect(events.filter((e) => e.startsWith("conflict:"))).toHaveLength(1);
    expect(events.filter((e) => e.startsWith("retry:"))).toHaveLength(1);
    expect(events.filter((e) => e.startsWith("merged:"))).toHaveLength(1);
    expect(events.filter((e) => e.startsWith("failed:"))).toHaveLength(0);

    await removeWorktree("event-agent", wopts(), true);
  });
});
