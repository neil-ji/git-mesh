/**
 * Worktree 子系统测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "os";
import * as path from "path";
import { createTempRepo, TempRepo } from "./_helpers";
import { createWorktree, removeWorktree, listWorktrees, getWorktreeStatus } from "../src/worktree";

let repo: TempRepo;
const workspaceDir = path.join(os.tmpdir(), "gitmesh-test-workspaces");

describe("Worktree Subsystem", () => {
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

  it("should create a worktree", async () => {
    const info = await createWorktree("test-agent", "main", opts());

    expect(info.name).toBe("test-agent");
    expect(info.branch).toBe("mesh/test-agent");
    expect(info.head).toBeTruthy();
    expect(info.path).toContain("test-agent");

    await removeWorktree("test-agent", opts(), true);
  });

  it("should list created worktrees", async () => {
    await createWorktree("agent-1", "main", opts());
    await createWorktree("agent-2", "main", opts());

    const list = await listWorktrees(opts());
    const names = list.map((w) => w.name);

    expect(names).toContain("agent-1");
    expect(names).toContain("agent-2");

    await removeWorktree("agent-1", opts(), true);
    await removeWorktree("agent-2", opts(), true);
  });

  it("should report worktree status", async () => {
    await createWorktree("status-test", "main", opts());
    const status = await getWorktreeStatus("status-test", opts());

    expect(status.dirty).toBe(false);
    expect(status.head).toBeTruthy();

    await removeWorktree("status-test", opts(), true);
  });

  it("should remove a worktree and its branch", async () => {
    await createWorktree("remove-test", "main", opts());
    await removeWorktree("remove-test", opts(), true);

    const list = await listWorktrees(opts());
    expect(list.map((w) => w.name)).not.toContain("remove-test");
  });
});
