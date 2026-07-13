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
import { detectConflicts, hasConflicts, buildConflictPrompt } from "../src/conflict";
import type { ConflictInfo } from "../src/types";
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

describe("buildConflictPrompt", () => {
  const baseConflict: ConflictInfo = {
    agentName: "test-agent",
    files: [
      {
        path: "src/app.ts",
        status: "conflicted",
        content: "<<<<<<< HEAD\nline from trunk\n=======\nline from agent\n>>>>>>> mesh/test-agent\n",
        incomingDiff: "+line from trunk\n",
        outgoingDiff: "+line from agent\n",
      },
    ],
    attempt: 1,
    maxRetries: 3,
    targetCommit: "abc1234567890",
    sourceCommit: "def9876543210",
    worktreePath: "/tmp/gitmesh-workspaces/test-agent",
  };

  it("should include essential fields in default output", () => {
    const prompt = buildConflictPrompt(baseConflict);
    expect(prompt).toContain("test-agent");
    expect(prompt).toContain("1/3");
    expect(prompt).toContain("abc1234");
    expect(prompt).toContain("src/app.ts");
    expect(prompt).toContain("<<<<<<<");
    expect(prompt).toContain(">>>>>>>");
    expect(prompt).toContain("outgoing");
    expect(prompt).toContain("incoming");
  });

  it("should use custom header when provided", () => {
    const customHeader = "CUSTOM: resolve this please";
    const prompt = buildConflictPrompt(baseConflict, { header: customHeader });
    expect(prompt).toContain(customHeader);
  });

  it("should truncate file content when exceeding maxFileContent", () => {
    const longContent = "x".repeat(100);
    const conflict: ConflictInfo = {
      ...baseConflict,
      files: [{ ...baseConflict.files[0], content: longContent }],
    };
    const prompt = buildConflictPrompt(conflict, { maxFileContent: 50 });
    expect(prompt).toContain("截断");
    expect(prompt).not.toContain("x".repeat(60));
  });

  it("should include hints when both sides only append", () => {
    const appendConflict: ConflictInfo = {
      ...baseConflict,
      files: [
        {
          ...baseConflict.files[0],
          outgoingDiff: "+entry_1\n+entry_2\n",
          incomingDiff: "+entry_3\n+entry_4\n",
        },
      ],
    };
    const prompt = buildConflictPrompt(appendConflict, { hints: true });
    expect(prompt).toContain("💡");
    expect(prompt).toContain("追加");
  });

  it("should suppress hints when hints: false", () => {
    const appendConflict: ConflictInfo = {
      ...baseConflict,
      files: [
        {
          ...baseConflict.files[0],
          outgoingDiff: "+entry_1\n",
          incomingDiff: "+entry_2\n",
        },
      ],
    };
    const prompt = buildConflictPrompt(appendConflict, { hints: false });
    expect(prompt).not.toContain("💡");
  });

  it("should not show hints when there are deletions", () => {
    const modifyConflict: ConflictInfo = {
      ...baseConflict,
      files: [
        {
          ...baseConflict.files[0],
          outgoingDiff: "+new line\n-old line\n",
          incomingDiff: "+other line\n",
        },
      ],
    };
    const prompt = buildConflictPrompt(modifyConflict);
    expect(prompt).not.toContain("💡");
  });

  it("should handle multiple files", () => {
    const multiFile: ConflictInfo = {
      ...baseConflict,
      files: [
        baseConflict.files[0],
        {
          path: "src/utils.ts",
          status: "deleted-by-them",
          content: "deleted content",
          incomingDiff: "-deleted\n",
          outgoingDiff: "+modified\n",
        },
      ],
    };
    const prompt = buildConflictPrompt(multiFile);
    expect(prompt).toContain("src/app.ts");
    expect(prompt).toContain("src/utils.ts");
    expect(prompt).toContain("deleted-by-them");
  });
});
