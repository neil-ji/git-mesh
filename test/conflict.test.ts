/**
 * 冲突检测测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createTempRepo, TempRepo, advanceTrunk, simulateAgentWork } from "./_helpers";
import { createWorktree, removeWorktree } from "../src/worktree";
import { execGit } from "../src/git";
import { detectConflicts, hasConflicts } from "../src/conflict";
import { rebaseBranch, abortRebase } from "../src/rebase";

let repo: TempRepo;
const workspaceDir = path.join(os.tmpdir(), "gitmesh-test-conflicts");

describe("Conflict Detection", () => {
  beforeAll(async () => {
    repo = await createTempRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  function opts() {
    return {
      cwd: repo.cwd,
      workspaceDir,
      branchPrefix: "mesh/",
    };
  }

  it("should detect no conflicts when rebase is clean", async () => {
    const wt = await createWorktree("clean-agent", "main", opts());
    await simulateAgentWork(wt.path, "new-file.md", "# New File", "feat: add new file");

    const result = await rebaseBranch(wt.path, "main");
    expect(result.success).toBe(true);

    await abortRebase(wt.path).catch(() => {});
    await removeWorktree("clean-agent", opts(), true);
  });

  it("should detect conflicts when both trunk and agent modify same file", async () => {
    // Save the initial commit
    const initialCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });

    // Advance trunk: modify README.md
    await advanceTrunk(repo.cwd, "README.md", "# Updated on trunk\n\nTrunk changes to README.\n");

    // Create worktree based on the old commit (before trunk advanced)
    const wt = await createWorktree("conflict-agent", initialCommit, opts());

    // Simulate agent modifying the same file
    await simulateAgentWork(wt.path, "README.md", "# Updated by agent\n\nAgent changes to README.\n", "feat: agent changes");

    // Try rebase - should conflict
    const result = await rebaseBranch(wt.path, "main");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.files.length).toBeGreaterThan(0);
      expect(hasConflicts(result.files)).toBe(true);
    }

    await abortRebase(wt.path);
    await removeWorktree("conflict-agent", opts(), true);
  });

  it("should read conflict file content with markers", async () => {
    const initialCommit = await execGit(["rev-parse", "HEAD"], { cwd: repo.cwd });

    // Create a file on trunk
    await advanceTrunk(
      repo.cwd,
      "shared.md",
      "# Shared File\n\nLine 1 from trunk\nLine 2\nLine 3\n"
    );

    // Create worktree from before trunk had the file
    const wt = await createWorktree("content-test", initialCommit, opts());

    // Agent creates a different version of the same file
    await simulateAgentWork(
      wt.path,
      "shared.md",
      "# Shared File\n\nLine 1 from agent\nLine 2\nLine 3\n",
      "feat: agent changes"
    );

    const result = await rebaseBranch(wt.path, "main");
    expect(result.success).toBe(false);
    if (!result.success) {
      const file = result.files[0];
      expect(file.content).toContain("<<<<<<<");
      expect(file.content).toContain(">>>>>>>");
      expect(file.status).toBeDefined();
    }

    await abortRebase(wt.path);
    await removeWorktree("content-test", opts(), true);
  });
});
