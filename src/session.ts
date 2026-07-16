/**
 * Session 实现。
 *
 * Session 是调用方的唯一入口，负责：
 * - 持有所有 worktree 引用
 * - 管理 Merge Engine 的启停
 * - 聚合事件流
 * - 生命周期管理
 * - 结果汇总
 */

import { TypedEventEmitter } from "./events";
import { MergeEngine } from "./merge-engine";
import { createWorktree, removeWorktree } from "./worktree";
import { createAgentSignal, invokeAgentReady } from "./agent-runner";
import { SessionError } from "./errors";
import { buildConflictPrompt } from "./conflict";
import type { ResolvedGitmeshOptions } from "./validate";
import type {
  Session,
  SessionSummary,
  SessionEvents,
  AgentResult,
  QueueItem,
  AgentDefinition,
  AgentResolveConflict,
  WorktreeInfo,
  ConflictInfo,
  ResolutionResult,
} from "./types";

/**
 * Deferred Promise — 用于 signal.done() 返回的 Promise<boolean>
 * 在 merge engine 处理完对应 agent 后 resolve
 */
class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason?: any) => void;
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export class SessionImpl
  extends TypedEventEmitter<SessionEvents>
  implements Session
{
  private opts: ResolvedGitmeshOptions;
  private engine: MergeEngine;
  private worktrees: Map<string, { path: string; branch: string }> = new Map();
  private started: boolean = false;
  private finished: boolean = false;
  private aborted: boolean = false;
  private agentDeferreds: Map<string, Deferred<boolean>> = new Map();
  private agentQueueItems: Map<string, QueueItem> = new Map();
  private doneCount: number = 0;
  private totalAgentCount: number = 0;

  constructor(opts: ResolvedGitmeshOptions) {
    super();
    this.opts = opts;
    this.engine = new MergeEngine({
      cwd: opts.cwd,
      trunkBranch: opts.trunkBranch,
      workspaceDir: opts.workspaceDir,
      branchPrefix: opts.branchPrefix,
      maxRetries: opts.maxRetries,
      conflictTimeout: opts.conflictTimeout,
      strategy: opts.strategy,
      totalAgentCount: opts.agents.length,
      onBeforeMerge: opts.onBeforeMerge,
      mergeMode: opts.mergeMode,
    });

    // 在构造函数中注册回调——早于任何事件可能触发
    this.registerCallbacks();
    this.proxyEngineEvents();
  }

  /**
   * 注册用户传入的 onMerged / onFailed / onConflict / onDone 回调。
   * 因为是构造函数里就注册的，不存在"session.on 太晚"的时序问题。
   */
  private registerCallbacks(): void {
    if (this.opts.onMerged) {
      this.on("mesh:merged", this.opts.onMerged);
    }
    if (this.opts.onFailed) {
      this.on("mesh:failed", this.opts.onFailed);
    }
    if (this.opts.onConflict) {
      this.on("mesh:conflict", this.opts.onConflict);
    }
    if (this.opts.onDone) {
      this.on("session:done", this.opts.onDone);
    }
  }

  /**
   * 代理合并引擎的事件到 session 层面，同时处理 signal.done() 的 Promise
   */
  private proxyEngineEvents(): void {
    // 直接代理的事件
    const passthrough: Array<keyof SessionEvents> = [
      "mesh:rebase",
      "mesh:conflict",
      "mesh:retry",
    ];
    for (const event of passthrough) {
      this.engine.on(event, ((...args: any[]) => {
        (this.emit as any)(event, ...args);
      }) as any);
    }

    // mesh:merged — 触发事件 + resolve 对应的 signal.done() Promise
    this.engine.on("mesh:merged", (name: string, commit: string) => {
      this.emit("mesh:merged", name, commit);
      const d = this.agentDeferreds.get(name);
      if (d) {
        d.resolve(true);
        this.agentDeferreds.delete(name);
      }
    });

    // mesh:failed — 触发事件 + reject/resolve 对应的 signal.done() Promise
    this.engine.on("mesh:failed", (name: string, reason: string, worktreePath: string) => {
      this.emit("mesh:failed", name, reason, worktreePath);
      const d = this.agentDeferreds.get(name);
      if (d) {
        d.resolve(false);
        this.agentDeferreds.delete(name);
      }
    });
  }

  /**
   * 启动 session：创建 worktree + 通知 Agent 开始工作。
   *
   * 不会等待 onReady 返回——Agent 生命周期以 signal.done() 为准。
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new SessionError("Session already started");
    }
    if (this.aborted) {
      throw new SessionError("Session has been aborted");
    }

    this.started = true;
    this.totalAgentCount = this.opts.agents.length;

    // 为每个 agent 创建 worktree
    for (const agent of this.opts.agents) {
      if (this.aborted) {
        // 中途 abort，清理已创建的 worktree
        await this.cleanupAllWorktrees();
        return;
      }

      const baseRef = agent.baseRef ?? this.opts.trunkBranch;
      try {
        const worktreeInfo = await createWorktree(agent.name, baseRef, {
          cwd: this.opts.cwd,
          workspaceDir: this.opts.workspaceDir,
          branchPrefix: this.opts.branchPrefix,
        });
        this.worktrees.set(agent.name, {
          path: worktreeInfo.path,
          branch: worktreeInfo.branch,
        });
        this.emit("worktree:ready", worktreeInfo);
      } catch (err) {
        // worktree 创建失败，清理并终止
        await this.cleanupAllWorktrees();
        throw new SessionError(
          `Failed to create worktree for agent "${agent.name}"`,
          err
        );
      }
    }

    // Fire-and-forget：通知每个 agent 开始工作
    for (const agent of this.opts.agents) {
      if (this.aborted) break;
      this.startAgent(agent);
    }
  }

  /**
   * 为单个 Agent 启动工作流。
   *
   * signal.done() 返回 Promise<boolean>，
   * 在 merge engine 处理完该 agent 后 resolve。
   */
  private startAgent(agent: AgentDefinition): void {
    const worktreeInfo = this.worktrees.get(agent.name);
    if (!worktreeInfo) {
      const reason = `Worktree not found for agent "${agent.name}"`;
      this.emit("mesh:failed", agent.name, reason, "");
      this.engine.markFailed(agent.name, reason);
      return;
    }

    // 创建 Deferred，让 signal.done() 能返回 Promise
    const deferred = new Deferred<boolean>();
    this.agentDeferreds.set(agent.name, deferred);

    const wtInfo: WorktreeInfo = {
      name: agent.name,
      path: worktreeInfo.path,
      branch: worktreeInfo.branch,
      head: "",
    };

    // Agent 失败时的统一处理：emit 事件 + resolve deferred + 通知引擎
    const handleAgentError = (agentName: string, error: Error) => {
      this.emit("mesh:failed", agentName, error.message, worktreeInfo.path);
      const d = this.agentDeferreds.get(agentName);
      if (d) {
        d.resolve(false);
        this.agentDeferreds.delete(agentName);
      }
      // 通知引擎此 agent 已失败，确保引擎能完成计数并 resolve done promise
      this.engine.markFailed(agentName, error.message);
    };

    const signal = createAgentSignal(
      agent,
      wtInfo,
      (agentName: string) => {
        this.doneCount++;
        // 构建 QueueItem 并返回 enqueue 函数 + promise
        const queueItem: QueueItem = {
          agentName,
          worktreePath: worktreeInfo.path,
          branch: worktreeInfo.branch,
          onConflict: this.resolveEffectiveConflictHandler(agent),
          retries: 0,
          conflictStrategy: agent.conflictStrategy ?? "route-to-agent",
          mergeStrategy: agent.mergeStrategy ?? "ff-only",
          squashMessage: agent.squashMessage,
        };
        this.agentQueueItems.set(agentName, queueItem);

        return {
          promise: deferred.promise,
          enqueue: () => {
            this.emit("agent:done", agentName);
            this.engine.enqueue(queueItem);
          },
        };
      },
      handleAgentError
    );

    // 🔑 关键：先创建 signal + deferred，
    // 然后调用 onReady（不 await）,
    // 最后 enqueue（这样 agent 的 done() 调用时可以安全地
    // 进入 merge engine 队列）
    invokeAgentReady(agent, signal, handleAgentError);

    // 如果 agent 在 onReady 中同步调用了 signal.done()，
    // deferred.promise 已经创建好了，enqueue 也已就绪
  }

  /**
   * 根据优先级解析有效的 onConflict 处理器。
   *
   * 优先级：onConflict（用户手写，最高）> resolveConflict（内建循环）> 默认放弃
   *
   * merge-engine 的冲突循环已内置（processConflict → continueRebase → retry）。
   * 此方法只负责桥接用户回调，不重写循环。
   */
  private resolveEffectiveConflictHandler(
    agent: AgentDefinition
  ): AgentResolveConflict {
    // 优先级 1：用户手写 onConflict（完全自定义模式）
    if (agent.onConflict) {
      return agent.onConflict;
    }

    // 优先级 2：resolveConflict（内建循环模式）
    if (agent.resolveConflict) {
      return async (
        conflict: ConflictInfo
      ): Promise<ResolutionResult> => {
        try {
          const prompt = buildConflictPrompt(
            conflict,
            agent.conflictPromptOptions
          );
          await agent.resolveConflict!({
            worktreePath: conflict.worktreePath,
            prompt,
            conflict,
            runPrompt: agent.runPrompt,
          });
          return { resolved: true };
        } catch (err) {
          return {
            resolved: false,
            reason:
              err instanceof Error ? err.message : String(err),
          };
        }
      };
    }

    // 优先级 3：默认放弃（无处理器）
    return async (): Promise<ResolutionResult> => ({
      resolved: false,
      reason:
        "No onConflict or resolveConflict handler configured — cannot resolve",
    });
  }

  /**
   * 等待所有 Agent 完成，返回结果摘要
   */
  async done(): Promise<SessionSummary> {
    if (!this.started) {
      await this.start();
    }

    if (this.finished) {
      return this.buildSummary();
    }

    // 启动引擎（此时队列可能为空——agent 还在工作中）
    const enginePromise = this.engine.start();

    // 等待每个 agent 的 signal.done() 调用，然后入队
    // enqueue 会自动触发 processQueue，所以引擎会持续处理
    // 引擎在 checkAllDone 中判断所有 agent 处理完毕

    // 等待引擎完成
    const results = await enginePromise;

    // 清理成功的 worktree
    await this.engine.cleanupSuccessful();

    this.finished = true;

    const summary = this.buildSummary(results);
    this.emit("session:done", summary);
    return summary;
  }

  /**
   * 中断 session。
   *
   * 清理所有 worktree，将未完成的 agent 标记为失败。
   * 设置 finished = true，防止 done() 在 abort 后重新进入引擎。
   */
  async abort(reason?: string): Promise<void> {
    this.aborted = true;
    this.finished = true;
    this.engine.abort();

    // Reject 所有未完成的 deferred
    for (const [name, d] of this.agentDeferreds) {
      d.resolve(false);
    }
    this.agentDeferreds.clear();

    await this.cleanupAllWorktrees();

    this.emit("session:done", {
      status: "failed",
      results: [],
      trunkHead: "",
    });
  }

  /**
   * 清理所有 worktree
   */
  private async cleanupAllWorktrees(): Promise<void> {
    for (const [name] of this.worktrees) {
      try {
        await removeWorktree(
          name,
          {
            cwd: this.opts.cwd,
            workspaceDir: this.opts.workspaceDir,
            branchPrefix: this.opts.branchPrefix,
          },
          true
        );
      } catch {
        // 清理失败不影响
      }
    }
    this.worktrees.clear();
  }

  /**
   * 构建结果摘要
   */
  private buildSummary(results?: AgentResult[]): SessionSummary {
    const finalResults = results ?? [];

    if (finalResults.length === 0) {
      return { status: "failed", results: [], trunkHead: "" };
    }

    const allMerged = finalResults.every((r) => r.status === "merged");
    const allFailed = finalResults.every((r) => r.status !== "merged");

    let status: SessionSummary["status"];
    if (allMerged) status = "success";
    else if (allFailed) status = "failed";
    else status = "partial";

    // 取引擎返回的 trunkHead（结果中最后一个 merged agent 的 commit 即为最新 HEAD）
    const lastMerged = [...finalResults]
      .reverse()
      .find((r) => r.status === "merged");
    const trunkHead = lastMerged?.mergeCommit ?? "";

    return { status, results: finalResults, trunkHead };
  }
}
