/**
 * Agent Runner 单元测试
 */

import { describe, it, expect, vi } from "vitest";
import {
  createAgentSignal,
  invokeAgentReady,
  getConflictResolver,
} from "../src/agent-runner";
import type {
  AgentDefinition,
  WorktreeInfo,
  ConflictInfo,
  ResolutionResult,
} from "../src/types";

function makeWorktree(): WorktreeInfo {
  return {
    name: "test-agent",
    path: "/tmp/test-worktree",
    branch: "mesh/test-agent",
    head: "abc123",
  };
}

function makeDefinition(
  overrides: Partial<AgentDefinition> = {}
): AgentDefinition {
  return {
    name: "test-agent",
    onReady: async () => {},
    onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => ({
      resolved: false,
    }),
    ...overrides,
  };
}

describe("createAgentSignal", () => {
  it("should create signal with correct properties", () => {
    const def = makeDefinition();
    const wt = makeWorktree();
    const onDone = vi.fn();
    const onError = vi.fn();

    const signal = createAgentSignal(def, wt, onDone, onError);

    expect(signal.agentName).toBe("test-agent");
    expect(signal.worktreePath).toBe("/tmp/test-worktree");
    expect(typeof signal.done).toBe("function");
  });

  it("should call onDone when done() is invoked", () => {
    const def = makeDefinition();
    const wt = makeWorktree();
    const onDone = vi.fn();
    const onError = vi.fn();

    const signal = createAgentSignal(def, wt, onDone, onError);
    signal.done();

    expect(onDone).toHaveBeenCalledWith("test-agent");
    expect(onError).not.toHaveBeenCalled();
  });

  it("should ignore second done() call (one-shot guard)", () => {
    const def = makeDefinition();
    const wt = makeWorktree();
    const onDone = vi.fn();
    const onError = vi.fn();

    const signal = createAgentSignal(def, wt, onDone, onError);
    signal.done();
    signal.done();
    signal.done();

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("invokeAgentReady", () => {
  it("should call onReady with the signal", async () => {
    const onReady = vi.fn();
    const def = makeDefinition({ onReady });
    const wt = makeWorktree();
    const signal = createAgentSignal(def, wt, vi.fn(), vi.fn());

    await invokeAgentReady(def, signal);

    expect(onReady).toHaveBeenCalledWith(signal);
  });

  it("should work with async onReady", async () => {
    let called = false;
    const def = makeDefinition({
      onReady: async () => {
        await new Promise((r) => setTimeout(r, 10));
        called = true;
      },
    });
    const signal = createAgentSignal(def, makeWorktree(), vi.fn(), vi.fn());

    await invokeAgentReady(def, signal);
    expect(called).toBe(true);
  });

  it("should propagate errors from onReady", async () => {
    const def = makeDefinition({
      onReady: async () => {
        throw new Error("agent start failed");
      },
    });
    const signal = createAgentSignal(def, makeWorktree(), vi.fn(), vi.fn());

    await expect(invokeAgentReady(def, signal)).rejects.toThrow(
      "agent start failed"
    );
  });
});

describe("getConflictResolver", () => {
  it("should return the onConflict callback", () => {
    const resolver = async (_: ConflictInfo): Promise<ResolutionResult> => ({
      resolved: true,
    });
    const def = makeDefinition({ onConflict: resolver });

    const result = getConflictResolver(def);
    expect(result).toBe(resolver);
  });
});
