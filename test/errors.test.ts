/**
 * 错误类体系测试
 */

import { describe, it, expect } from "vitest";
import {
  GitmeshError,
  WorktreeError,
  WorktreeCreateError,
  WorktreeRemoveError,
  MergeEngineError,
  RebaseError,
  MergeError,
  StrategyError,
  AgentError,
  AgentTimeoutError,
  AgentResolveError,
  AgentAbandonError,
  SessionError,
  SessionInterrupted,
} from "../src/errors";

describe("Error Classes", () => {
  describe("GitmeshError (base)", () => {
    it("should set name and message", () => {
      const err = new GitmeshError("test message");
      expect(err.name).toBe("GitmeshError");
      expect(err.message).toBe("test message");
      expect(err).toBeInstanceOf(Error);
    });

    it("should propagate cause", () => {
      const cause = new Error("root cause");
      const err = new GitmeshError("wrapper", cause);
      expect(err.cause).toBe(cause);
    });
  });

  describe("WorktreeError", () => {
    it("should extend GitmeshError", () => {
      const err = new WorktreeError("wt error");
      expect(err).toBeInstanceOf(GitmeshError);
      expect(err.name).toBe("WorktreeError");
    });
  });

  describe("WorktreeCreateError", () => {
    it("should format message with worktree name", () => {
      const err = new WorktreeCreateError("my-agent", "disk full");
      expect(err.name).toBe("WorktreeCreateError");
      expect(err.worktreeName).toBe("my-agent");
      expect(err.message).toContain("my-agent");
      expect(err.message).toContain("disk full");
    });

    it("should propagate cause", () => {
      const cause = new Error("git error");
      const err = new WorktreeCreateError("agent", "failed", cause);
      expect(err.cause).toBe(cause);
    });
  });

  describe("WorktreeRemoveError", () => {
    it("should format message with worktree name", () => {
      const err = new WorktreeRemoveError("agent-x", "permission denied");
      expect(err.name).toBe("WorktreeRemoveError");
      expect(err.worktreeName).toBe("agent-x");
      expect(err.message).toContain("agent-x");
    });
  });

  describe("MergeEngineError", () => {
    it("should extend GitmeshError", () => {
      const err = new MergeEngineError("me error");
      expect(err).toBeInstanceOf(GitmeshError);
      expect(err.name).toBe("MergeEngineError");
    });
  });

  describe("RebaseError", () => {
    it("should format message with agent name", () => {
      const err = new RebaseError("agent-1", "conflict");
      expect(err.name).toBe("RebaseError");
      expect(err.agentName).toBe("agent-1");
      expect(err.message).toContain("agent-1");
      expect(err.message).toContain("conflict");
    });
  });

  describe("MergeError", () => {
    it("should format message with agent name", () => {
      const err = new MergeError("agent-2", "not fast-forward");
      expect(err.name).toBe("MergeError");
      expect(err.agentName).toBe("agent-2");
    });
  });

  describe("StrategyError", () => {
    it("should format message", () => {
      const err = new StrategyError("invalid strategy");
      expect(err.name).toBe("StrategyError");
      expect(err.message).toContain("invalid strategy");
    });
  });

  describe("AgentError", () => {
    it("should format message with agent name", () => {
      const err = new AgentError("bot", "something went wrong");
      expect(err.name).toBe("AgentError");
      expect(err.agentName).toBe("bot");
      expect(err.message).toContain("bot");
    });
  });

  describe("AgentTimeoutError", () => {
    it("should include timeout value in message", () => {
      const err = new AgentTimeoutError("slow-agent", 5000);
      expect(err.name).toBe("AgentTimeoutError");
      expect(err.agentName).toBe("slow-agent");
      expect(err.message).toContain("5000ms");
    });
  });

  describe("AgentResolveError", () => {
    it("should include reason in message", () => {
      const err = new AgentResolveError("agent", "invalid response");
      expect(err.name).toBe("AgentResolveError");
      expect(err.message).toContain("invalid response");
    });
  });

  describe("AgentAbandonError", () => {
    it("should include reason in message", () => {
      const err = new AgentAbandonError("agent", "too complex");
      expect(err.name).toBe("AgentAbandonError");
      expect(err.message).toContain("too complex");
    });
  });

  describe("SessionError", () => {
    it("should extend GitmeshError", () => {
      const err = new SessionError("session failed");
      expect(err).toBeInstanceOf(GitmeshError);
      expect(err.name).toBe("SessionError");
    });
  });

  describe("SessionInterrupted", () => {
    it("should have default message without reason", () => {
      const err = new SessionInterrupted();
      expect(err.name).toBe("SessionInterrupted");
      expect(err.message).toBe("Session interrupted");
    });

    it("should include reason in message when provided", () => {
      const err = new SessionInterrupted("SIGINT");
      expect(err.message).toBe("Session interrupted: SIGINT");
    });
  });
});
