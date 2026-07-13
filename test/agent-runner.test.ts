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
    onReady: () => {},
    onConflict: async (_: ConflictInfo): Promise<ResolutionResult> => ({
      resolved: false,
    }),
    ...overrides,
  };
}

/** 新版 onDone 签名：返回 { promise, enqueue } */
function makeOnDone() {
  const deferred = (() => {
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => { resolve = r; });
    return { promise, resolve };
  })();
  const enqueue = vi.fn();
  const onDone = vi.fn((_name: string) => ({ promise: deferred.promise, enqueue }));
  return { onDone, ...deferred, enqueue };
}

describe("createAgentSignal", () => {
  it("should create signal with correct properties", () => {
    const def = makeDefinition();
    const wt = makeWorktree();
    const { onDone } = makeOnDone();
    const onError = vi.fn();

    const signal = createAgentSignal(def, wt, onDone, onError);

    expect(signal.agentName).toBe("test-agent");
    expect(signal.worktreePath).toBe("/tmp/test-worktree");
    expect(typeof signal.done).toBe("function");
  });

  it("should call onDone when done() is invoked", () => {
    const def = makeDefinition();
    const wt = makeWorktree();
    const { onDone } = makeOnDone();
    const onError = vi.fn();

    const signal = createAgentSignal(def, wt, onDone, onError);
    signal.done();

    expect(onDone).toHaveBeenCalledWith("test-agent");
    expect(onError).not.toHaveBeenCalled();
  });

  it("should return same promise on repeated done() calls", async () => {
    const def = makeDefinition();
    const wt = makeWorktree();
    const { onDone, resolve } = makeOnDone();
    const onError = vi.fn();

    const signal = createAgentSignal(def, wt, onDone, onError);
    const p1 = signal.done();
    const p2 = signal.done();
    const p3 = signal.done();

    // 同一个 deferred
    expect(onDone).toHaveBeenCalledTimes(1);

    // resolve 后所有 promise 都得到相同结果
    resolve(true);
    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    expect(await p3).toBe(true);
  });
});

describe("invokeAgentReady", () => {
  it("should call onReady with the signal (fire-and-forget)", () => {
    const onReady = vi.fn();
    const def = makeDefinition({ onReady });
    const wt = makeWorktree();
    const { onDone } = makeOnDone();
    const onError = vi.fn();
    const signal = createAgentSignal(def, wt, onDone, onError);

    invokeAgentReady(def, signal, onError);

    // onReady 被同步调用
    expect(onReady).toHaveBeenCalledWith(signal);
    expect(onError).not.toHaveBeenCalled();
  });

  it("should not throw for async onReady that fails", async () => {
    const onError = vi.fn();
    const def = makeDefinition({
      onReady: async () => {
        throw new Error("agent start failed");
      },
    });
    const { onDone } = makeOnDone();
    const signal = createAgentSignal(def, makeWorktree(), onDone, onError);

    // invokeAgentReady 不再抛出 — fire-and-forget
    expect(() => invokeAgentReady(def, signal, onError)).not.toThrow();

    // 异步异常通过 onError 回调通知（等待 microtask）
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).toHaveBeenCalledWith("test-agent", expect.any(Error));
  });

  it("should not throw for sync onReady that throws (fire-and-forget)", () => {
    const onError = vi.fn();
    const def = makeDefinition({
      onReady: () => {
        throw new Error("sync fail");
      },
    });
    const { onDone } = makeOnDone();
    const signal = createAgentSignal(def, makeWorktree(), onDone, onError);

    expect(() => invokeAgentReady(def, signal, onError)).not.toThrow();

    // 同步异常通过 onError 回调通知
    expect(onError).toHaveBeenCalledWith("test-agent", expect.any(Error));
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
