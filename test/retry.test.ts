/**
 * 重试逻辑单元测试
 */

import { describe, it, expect, vi } from "vitest";
import {
  createRetryState,
  canRetry,
  incrementRetry,
  resolveWithTimeout,
} from "../src/retry";
import { AgentTimeoutError, AgentError } from "../src/errors";
import type { ConflictInfo, ResolutionResult } from "../src/types";

function makeConflict(): ConflictInfo {
  return {
    agentName: "test-agent",
    files: [],
    attempt: 1,
    maxRetries: 3,
    targetCommit: "abc123",
    sourceCommit: "def456",
    worktreePath: "/tmp/test",
  };
}

describe("Retry State", () => {
  describe("createRetryState", () => {
    it("should initialize with attempt 0", () => {
      const state = createRetryState(3);
      expect(state.attempt).toBe(0);
      expect(state.maxRetries).toBe(3);
    });

    it("should accept custom maxRetries", () => {
      const state = createRetryState(5);
      expect(state.maxRetries).toBe(5);
    });
  });

  describe("canRetry", () => {
    it("should return true when attempt < maxRetries", () => {
      const state = { attempt: 0, maxRetries: 3 };
      expect(canRetry(state)).toBe(true);
    });

    it("should return true at boundary attempt = maxRetries - 1", () => {
      const state = { attempt: 2, maxRetries: 3 };
      expect(canRetry(state)).toBe(true);
    });

    it("should return false when attempt >= maxRetries", () => {
      const state = { attempt: 3, maxRetries: 3 };
      expect(canRetry(state)).toBe(false);
    });

    it("should return false when attempt > maxRetries", () => {
      const state = { attempt: 5, maxRetries: 3 };
      expect(canRetry(state)).toBe(false);
    });
  });

  describe("incrementRetry", () => {
    it("should increment attempt by 1", () => {
      const state = { attempt: 0, maxRetries: 3 };
      incrementRetry(state);
      expect(state.attempt).toBe(1);
      incrementRetry(state);
      expect(state.attempt).toBe(2);
    });
  });
});

describe("resolveWithTimeout", () => {
  it("should resolve with the result when onConflict completes in time", async () => {
    const conflict = makeConflict();
    const result: ResolutionResult = { resolved: true };

    const onConflict = vi.fn().mockResolvedValue(result);

    const output = await resolveWithTimeout(
      "agent",
      conflict,
      onConflict,
      5000
    );

    expect(output).toBe(result);
    expect(onConflict).toHaveBeenCalledWith(conflict);
  });

  it("should reject with AgentTimeoutError when onConflict takes too long", async () => {
    const conflict = makeConflict();
    const onConflict = vi.fn().mockImplementation(
      () => new Promise((r) => setTimeout(r, 500))
    );

    await expect(
      resolveWithTimeout("slow-agent", conflict, onConflict, 10)
    ).rejects.toThrow(AgentTimeoutError);

    await expect(
      resolveWithTimeout("slow-agent", conflict, onConflict, 10)
    ).rejects.toThrow(/10ms/);
  });

  it("should reject with AgentError when onConflict throws", async () => {
    const conflict = makeConflict();
    const onConflict = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      resolveWithTimeout("agent", conflict, onConflict, 5000)
    ).rejects.toThrow(AgentError);

    await expect(
      resolveWithTimeout("agent", conflict, onConflict, 5000)
    ).rejects.toThrow(/threw an error/);
  });

  it("should clear timeout when onConflict resolves quickly", async () => {
    const conflict = makeConflict();
    const onConflict = vi.fn().mockResolvedValue({ resolved: true });

    // Should not hang or throw timeout
    const result = await resolveWithTimeout(
      "agent",
      conflict,
      onConflict,
      60000 // long timeout
    );

    expect(result.resolved).toBe(true);
  });
});
