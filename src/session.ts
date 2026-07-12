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
import { createWorktree, removeWorktree, getTrunkHead } from "./worktree";
import { createAgentSignal, invokeAgentReady } from "./agent-runner";
import { SessionError, SessionInterrupted } from "./errors";
import type {
  GitmeshOptions,
  Session,
  SessionSummary,
  SessionEvents,
  AgentResult,
  QueueItem,
} from "./types";

interface ResolvedOptions extends Required<GitmeshOptions> {}

export class SessionImpl
  extends TypedEventEmitter<SessionEvents>
  implements Session
{
  private opts: ResolvedOptions;
  private engine: MergeEngine;
  private worktrees: Map<string, { path: string; branch: string }> = new Map();
  private started: boolean = false;
  private finished: boolean = false;
  private aborted: boolean = false;

  constructor(opts: ResolvedOptions) {
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
    });

    // 代理合并引擎的事件
    this.proxyEngineEvents();
  }

  /**
   * 代理合并引擎的所有事件到 session 层面
   */
  private proxyEngineEvents(): void {
    const events: Array<keyof SessionEvents> = [
      "agent:done",
      "mesh:rebase",
      "mesh:conflict",
      "mesh:retry",
      "mesh:merged",
      "mesh:failed",
    ];

    for (const event of events) {
      this.engine.on(event, ((...args: any[]) => {
        (this.emit as any)(event, ...args);
      }) as any);
    }
  }

  /**
   * 启动 session：创建所有 worktree，启动 agent
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new SessionError("Session already started");
    }
    if (this.aborted) {
      throw new SessionError("Session has been aborted");
    }

    this.started = true;

    // 为每个 agent 创建 worktree
    for (const agent of this.opts.agents) {
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
        // worktree 创建失败，终止 session
        throw new SessionError(
          `Failed to create worktree for agent "${agent.name}"`,
          err
        );
      }
    }

    // 通知各 Agent 开始工作
    // 使用 Promise.allSettled 以保证一个 agent 的 onReady 失败不影响其他
    const readyPromises = this.opts.agents.map((agent) => {
      return this.startAgent(agent);
    });

    await Promise.allSettled(readyPromises);
  }

  /**
   * 为单个 Agent 启动工作流
   */
  private async startAgent(agent: typeof this.opts.agents[number]): Promise<void> {
    const worktreeInfo = this.worktrees.get(agent.name);
    if (!worktreeInfo) {
      throw new SessionError(
        `Worktree not found for agent "${agent.name}"`
      );
    }

    // 创建 done 回调，将 agent 加入合并队列
    const signal = createAgentSignal(
      agent,
      {
        name: agent.name,
        path: worktreeInfo.path,
        branch: worktreeInfo.branch,
        head: "", // will be resolved inside the worktree
      },
      (agentName: string) => {
        this.emit("agent:done", agentName);

        const queueItem: QueueItem = {
          agentName,
          worktreePath: worktreeInfo.path,
          branch: worktreeInfo.branch,
          onConflict: agent.onConflict,
          retries: 0,
        };

        this.engine.enqueue(queueItem);
      },
      (agentName: string, error: Error) => {
        this.emit("mesh:failed", agentName, error.message);
      }
    );

    // 调用 onReady （在 worktree 中启动 agent）
    await invokeAgentReady(agent, signal);
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

    // 启动合并引擎（开始处理已完成的 agent）
    const results = await this.engine.start();

    // 清理成功的 worktree
    await this.engine.cleanupSuccessful();

    this.finished = true;

    const summary = this.buildSummary(results);
    this.emit("session:done", summary);
    return summary;
  }

  /**
   * 中断 session
   */
  async abort(reason?: string): Promise<void> {
    this.aborted = true;
    this.engine.abort();

    // 清理所有 worktree
    for (const [name] of this.worktrees) {
      try {
        await removeWorktree(name, {
          cwd: this.opts.cwd,
          workspaceDir: this.opts.workspaceDir,
          branchPrefix: this.opts.branchPrefix,
        }, true); // force remove
      } catch {
        // 清理失败不影响
      }
    }

    this.worktrees.clear();
    this.emit("session:done", {
      status: "failed",
      results: [],
      trunkHead: "",
    });
  }

  /**
   * 构建结果摘要
   */
  private buildSummary(results?: AgentResult[]): SessionSummary {
    const finalResults = results ?? [];

    if (finalResults.length === 0) {
      return {
        status: "failed",
        results: [],
        trunkHead: "",
      };
    }

    const allMerged = finalResults.every((r) => r.status === "merged");
    const allFailed = finalResults.every((r) => r.status !== "merged");

    let status: SessionSummary["status"];
    if (allMerged) {
      status = "success";
    } else if (allFailed) {
      status = "failed";
    } else {
      status = "partial";
    }

    const trunkHead = finalResults
      .filter((r) => r.status === "merged")
      .map((r) => r.mergeCommit!)
      .pop() ?? "";

    return {
      status,
      results: finalResults,
      trunkHead,
    };
  }
}
