/**
 * gitmesh 错误类体系
 */

export class GitmeshError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "GitmeshError";
  }
}

// === Worktree 错误 ===

export class WorktreeError extends GitmeshError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "WorktreeError";
  }
}

export class WorktreeCreateError extends WorktreeError {
  constructor(
    public readonly worktreeName: string,
    message: string,
    cause?: unknown
  ) {
    super(`Failed to create worktree "${worktreeName}": ${message}`, cause);
    this.name = "WorktreeCreateError";
  }
}

export class WorktreeRemoveError extends WorktreeError {
  constructor(
    public readonly worktreeName: string,
    message: string,
    cause?: unknown
  ) {
    super(`Failed to remove worktree "${worktreeName}": ${message}`, cause);
    this.name = "WorktreeRemoveError";
  }
}

// === Merge Engine 错误 ===

export class MergeEngineError extends GitmeshError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "MergeEngineError";
  }
}

export class RebaseError extends MergeEngineError {
  constructor(
    public readonly agentName: string,
    message: string,
    cause?: unknown
  ) {
    super(`Rebase failed for "${agentName}": ${message}`, cause);
    this.name = "RebaseError";
  }
}

export class MergeError extends MergeEngineError {
  constructor(
    public readonly agentName: string,
    message: string,
    cause?: unknown
  ) {
    super(`Merge failed for "${agentName}": ${message}`, cause);
    this.name = "MergeError";
  }
}

export class StrategyError extends MergeEngineError {
  constructor(message: string, cause?: unknown) {
    super(`Strategy execution error: ${message}`, cause);
    this.name = "StrategyError";
  }
}

// === Agent 错误 ===

export class AgentError extends GitmeshError {
  constructor(
    public readonly agentName: string,
    message: string,
    cause?: unknown
  ) {
    super(`Agent "${agentName}" error: ${message}`, cause);
    this.name = "AgentError";
  }
}

export class AgentTimeoutError extends AgentError {
  constructor(agentName: string, timeoutMs: number) {
    super(agentName, `Conflict resolution timed out after ${timeoutMs}ms`);
    this.name = "AgentTimeoutError";
  }
}

export class AgentResolveError extends AgentError {
  constructor(agentName: string, reason: string) {
    super(agentName, `Conflict resolution returned error: ${reason}`);
    this.name = "AgentResolveError";
  }
}

export class AgentAbandonError extends AgentError {
  constructor(agentName: string, reason: string) {
    super(agentName, `Agent abandoned conflict resolution: ${reason}`);
    this.name = "AgentAbandonError";
  }
}

// === Session 错误 ===

export class SessionError extends GitmeshError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "SessionError";
  }
}

export class SessionInterrupted extends SessionError {
  constructor(reason?: string) {
    super(`Session interrupted${reason ? `: ${reason}` : ""}`);
    this.name = "SessionInterrupted";
  }
}
