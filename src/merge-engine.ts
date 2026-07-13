/**
 * 合并引擎主逻辑。
 *
 * 负责：
 * - 维护合并队列
 * - 按策略执行 rebase → merge 流程
 * - 冲突检测与路由
 * - 重试循环管理
 * - 主干更新后重启未完成的 rebase
 */

import { TypedEventEmitter } from "./events";
import { AsyncLock } from "./lock";
import { rebaseBranch, continueRebase, abortRebase, isRebasing } from "./rebase";
import { fastForwardMerge } from "./merge";
import { buildConflictInfo, hasConflicts } from "./conflict";
import { getTrunkHead, removeWorktree } from "./worktree";
import {
  createRetryState,
  canRetry,
  incrementRetry,
  resolveWithTimeout,
} from "./retry";
import {
  MergeEngineError,
  AgentAbandonError,
  AgentTimeoutError,
  AgentResolveError,
} from "./errors";
import type {
  QueueItem,
  AgentResult,
  ConflictInfo,
  ResolutionResult,
  SessionEvents,
} from "./types";

export type { QueueItem, AgentResult };

export interface MergeEngineOptions {
  cwd: string;
  trunkBranch: string;
  workspaceDir: string;
  branchPrefix: string;
  maxRetries: number;
  conflictTimeout: number;
  strategy: string;
  /** 预期 agent 数量（checkAllDone 用） */
  totalAgentCount?: number;
}

/**
 * 合并引擎内部状态
 */
type AgentState =
  | "queued"
  | "rebasing"
  | "conflict"
  | "waiting_for_lock"
  | "merged"
  | "failed";

interface AgentEntry {
  item: QueueItem;
  state: AgentState;
  trunkHeadAtStart: string;
  retryState: ReturnType<typeof createRetryState>;
  result?: AgentResult;
  abortController: AbortController;
}

export class MergeEngine extends TypedEventEmitter<SessionEvents> {
  private opts: MergeEngineOptions;
  private queue: AgentEntry[] = [];
  private mergeLock: AsyncLock = new AsyncLock();
  private trunkHead: string = "";
  private isRunning: boolean = false;
  private isAborted: boolean = false;
  private resolveDone: ((value: AgentResult[]) => void) | null = null;
  private activeCount: number = 0;

  constructor(opts: MergeEngineOptions) {
    super();
    this.opts = opts;
  }

  /**
   * 添加 Agent 到合并队列，开始处理
   */
  enqueue(item: QueueItem): void {
    const entry: AgentEntry = {
      item,
      state: "queued",
      trunkHeadAtStart: "",
      retryState: createRetryState(this.opts.maxRetries),
      abortController: new AbortController(),
    };
    this.queue.push(entry);
    this.activeCount++;

    // 引擎已启动，立即触发处理（应对 agent 在 done() 后入队的场景）
    if (this.isRunning) {
      this.processQueue();
    }
  }

  /**
   * 标记 Agent 为启动失败（onReady 抛出异常等场景）。
   *
   * 直接将失败条目加入队列，不经过 rebase/merge 流程。
   * 确保引擎能正确统计并 resolve done promise。
   */
  markFailed(agentName: string, reason: string): void {
    const entry: AgentEntry = {
      item: {
        agentName,
        worktreePath: "",
        branch: "",
        onConflict: async () => ({ resolved: false }),
        retries: 0,
      },
      state: "failed",
      trunkHeadAtStart: "",
      retryState: createRetryState(0),
      abortController: new AbortController(),
      result: {
        agentName,
        status: "failed",
        reason,
        cleaned: false,
      },
    };
    this.queue.push(entry);
    this.activeCount++;
    this.checkAllDone();
  }

  /**
   * 启动合并引擎。
   *
   * 如果引擎已被 abort，直接返回已有结果，不再重新启动。
   * 在 await getTrunkHead 之后和 Promise 构造函数内部分别检查 isAborted，
   * 覆盖 abort() 在引擎启动期间被调用的竞态窗口。
   */
  async start(): Promise<AgentResult[]> {
    if (this.isAborted) {
      return this.collectAbortedResults();
    }

    this.isRunning = true;

    // 获取初始 trunk HEAD（可能耗时，abort 可在此期间发生）
    this.trunkHead = await getTrunkHead(this.opts.cwd, this.opts.trunkBranch);

    // 二次检查：abort 可能在 getTrunkHead 期间被调用
    if (this.isAborted) {
      return this.collectAbortedResults();
    }

    return new Promise<AgentResult[]>((resolve) => {
      // 三次检查：abort 可能在 Promise 构造函数执行前的微任务中被调用
      if (this.isAborted) {
        resolve(this.collectAbortedResults());
        return;
      }
      this.resolveDone = resolve;

      // 先处理已在队列中的 agent。
      // 之后通过 enqueue() 触发的 agent 也会自动调用 processQueue()。
      this.processQueue();
    });
  }

  /**
   * 收集 abort 后的结果（包含队列中已有的和未入队的占位结果）
   */
  private collectAbortedResults(): AgentResult[] {
    return this.queue.map(
      (entry) =>
        entry.result ?? {
          agentName: entry.item.agentName,
          status: "failed" as const,
          reason: "Session aborted",
          cleaned: false,
        }
    );
  }

  /**
   * 中断合并引擎。
   *
   * 将所有非终止状态的 agent 标记为 failed，并直接 resolve done promise。
   * 这确保了 Session.done() 不会在 abort 后永久挂起。
   */
  abort(): void {
    this.isAborted = true;
    // 取消所有正在进行的操作，并将非终止状态的 agent 标记为失败
    for (const entry of this.queue) {
      entry.abortController.abort();
      if (entry.state !== "merged" && entry.state !== "failed") {
        entry.state = "failed";
        entry.result = {
          agentName: entry.item.agentName,
          status: "failed",
          reason: "Session aborted",
          cleaned: false,
        };
      }
    }
    // 直接 resolve done promise，防止 Session.done() 永久挂起。
    // 不使用 checkAllDone() 因为可能存在尚未入队的 agent
    // （totalAgentCount > queue.length），此时 checkAllDone 无法 resolve。
    if (this.resolveDone) {
      const results = this.queue.map(
        (entry) =>
          entry.result ?? {
            agentName: entry.item.agentName,
            status: "failed" as const,
            reason: "Session aborted",
            cleaned: false,
          }
      );
      this.resolveDone(results);
      this.resolveDone = null;
    }
  }

  /**
   * 处理队列的主循环
   * rebase-first 策略：并发 rebase，串行合并
   */
  private processQueue(): void {
    if (this.isAborted) {
      this.checkAllDone();
      return;
    }

    // 找到所有 queued 状态的 agent 并发启动 rebase
    const queued = this.queue.filter((e) => e.state === "queued");
    for (const entry of queued) {
      entry.state = "rebasing";
      entry.trunkHeadAtStart = this.trunkHead;
      this.processRebase(entry);
    }

    this.checkAllDone();
  }

  /**
   * 处理单个 Agent 的 rebase 流程
   */
  private async processRebase(entry: AgentEntry): Promise<void> {
    const { item, abortController } = entry;
    const signal = abortController.signal;

    try {
      if (signal.aborted) return;

      this.emit("mesh:rebase", item.agentName);

      const rebaseResult = await rebaseBranch(
        item.worktreePath,
        this.opts.trunkBranch
      );

      if (signal.aborted) return;

      if (rebaseResult.success) {
        // Rebase 成功，进入合并阶段
        await this.processMerge(entry);
      } else {
        // Rebase 冲突
        entry.state = "conflict";
        await this.processConflict(entry, rebaseResult.files);
      }
    } catch (err) {
      if (signal.aborted) return;
      await this.handleFailure(
        entry,
        `Rebase error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * 处理冲突：通知 Agent，等待解决
   */
  private async processConflict(
    entry: AgentEntry,
    conflictFiles: import("./types").ConflictFile[]
  ): Promise<void> {
    const { item, abortController } = entry;
    const signal = abortController.signal;

    if (!canRetry(entry.retryState)) {
      await this.handleFailure(
        entry,
        `Max retries (${this.opts.maxRetries}) exceeded`
      );
      return;
    }

    incrementRetry(entry.retryState);

    const conflictInfo = buildConflictInfo({
      agentName: item.agentName,
      files: conflictFiles,
      attempt: entry.retryState.attempt,
      maxRetries: this.opts.maxRetries,
      targetCommit: this.trunkHead,
      sourceCommit: entry.trunkHeadAtStart,
      worktreePath: item.worktreePath,
    });

    this.emit("mesh:conflict", conflictInfo);

    try {
      const resolution = await resolveWithTimeout(
        item.agentName,
        conflictInfo,
        item.onConflict,
        this.opts.conflictTimeout
      );

      if (signal.aborted) return;

      if (resolution.resolved) {
        // Agent 声称已解决冲突，继续 rebase
        this.emit("mesh:retry", item.agentName, entry.retryState.attempt);

        const continueResult = await continueRebase(item.worktreePath);

        if (signal.aborted) return;

        if (continueResult.success) {
          // Rebase 成功
          await this.processMerge(entry);
        } else {
          // 继续 rebase 又遇到新冲突
          await this.processConflict(entry, continueResult.files);
        }
      } else {
        // Agent 放弃解决
        await this.handleFailure(
          entry,
          resolution.reason ?? "Agent abandoned conflict resolution"
        );
      }
    } catch (err) {
      if (signal.aborted) return;

      if (err instanceof AgentTimeoutError) {
        await this.handleFailure(
          entry,
          `Conflict resolution timed out after ${this.opts.conflictTimeout}ms`
        );
      } else if (err instanceof AgentAbandonError) {
        await this.handleFailure(entry, err.message);
      } else if (err instanceof AgentResolveError) {
        await this.handleFailure(entry, err.message);
      } else {
        // 未知错误，中止 rebase 并重试
        try {
          await abortRebase(item.worktreePath);
        } catch {
          // ignore
        }

        if (canRetry(entry.retryState)) {
          entry.state = "rebasing";
          entry.trunkHeadAtStart = this.trunkHead;
          await this.processRebase(entry);
        } else {
          await this.handleFailure(
            entry,
            `Rebase retries exhausted: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  /**
   * 处理合并：获取锁 → 检查 trunk 变化 → merge → 释放锁
   */
  private async processMerge(entry: AgentEntry): Promise<void> {
    const { item, abortController } = entry;

    try {
      // 等待合并锁
      await this.mergeLock.acquire();

      if (abortController.signal.aborted) {
        this.mergeLock.release();
        return;
      }

      // 检查 trunk 是否在 rebase 期间被更新
      const currentTrunkHead = await getTrunkHead(
        this.opts.cwd,
        this.opts.trunkBranch
      );

      if (currentTrunkHead !== entry.trunkHeadAtStart) {
        // trunk 已变化，需要重新 rebase
        this.mergeLock.release();

        // 检查当前是否还在 rebase 状态
        entry.state = "rebasing";
        entry.trunkHeadAtStart = currentTrunkHead;

        // 通知其他 rebasing 的 agent 重启（通过 processQueue 自然处理）
        await this.processRebase(entry);
        return;
      }

      // 合并！
      const newHead = await fastForwardMerge(
        item.branch,
        this.opts.trunkBranch,
        this.opts.cwd
      );

      // 更新全局 trunk HEAD
      this.trunkHead = newHead;

      // 释放锁
      this.mergeLock.release();

      // 标记完成
      entry.state = "merged";
      entry.result = {
        agentName: item.agentName,
        status: "merged",
        mergeCommit: newHead,
        cleaned: false,
      };

      this.emit("mesh:merged", item.agentName, newHead);

      // trunk 更新后，重启所有正在 rebase 的其他 agent
      await this.restartInProgressRebases();

      // 检查是否所有 agent 都已完成
      this.checkAllDone();
    } catch (err) {
      this.mergeLock.release();
      await this.handleFailure(
        entry,
        `Merge error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * 重启所有正在 rebase 的其他 Agent。
   * 只重启真正在 git rebase 中的 agent，
   * 已完成 rebase 正在等锁的 agent 由 processMerge 中的 trunk 检查处理。
   */
  private async restartInProgressRebases(): Promise<void> {
    const rebasing = this.queue.filter(
      (e) => e.state === "rebasing" && e.item.agentName !== this.getLastMergedName()
    );

    for (const entry of rebasing) {
      // 只重启真正在 rebase 中的 agent
      try {
        if (await isRebasing(entry.item.worktreePath)) {
          await abortRebase(entry.item.worktreePath);
          // 更新目标并重启
          entry.trunkHeadAtStart = this.trunkHead;
          this.processRebase(entry);
        }
        // 如果不在 rebase 中（已完成，正在等锁），
        // processMerge 中的 trunk 检查会处理重启
      } catch {
        // 忽略错误
      }
    }
  }

  private getLastMergedName(): string {
    const merged = this.queue.find((e) => e.state === "merged");
    // 更准确的是找最近 merged 的
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].state === "merged") {
        return this.queue[i].item.agentName;
      }
    }
    return "";
  }

  /**
   * 标记 Agent 为失败
   */
  private async handleFailure(
    entry: AgentEntry,
    reason: string
  ): Promise<void> {
    // 先中止可能的 rebase 状态
    try {
      if (await isRebasing(entry.item.worktreePath)) {
        await abortRebase(entry.item.worktreePath);
      }
    } catch {
      // ignore
    }

    entry.state = "failed";
    entry.result = {
      agentName: entry.item.agentName,
      status: "failed",
      reason,
      cleaned: false,
    };

    this.emit("mesh:failed", entry.item.agentName, reason);
    this.checkAllDone();
  }

  /**
   * 检查是否所有 agent 都已处理完毕
   */
  private checkAllDone(): void {
    // 必须等待至少 expected 个 agent 入队，且全部处理完毕
    const expected = this.opts.totalAgentCount ?? this.queue.length;
    if (this.queue.length < expected) return;

    const pending = this.queue.filter(
      (e) =>
        e.state === "queued" ||
        e.state === "rebasing" ||
        e.state === "conflict" ||
        e.state === "waiting_for_lock"
    );

    if (pending.length === 0 && this.resolveDone) {
      const allResults: AgentResult[] = [];
      for (const entry of this.queue) {
        allResults.push(
          entry.result ?? {
            agentName: entry.item.agentName,
            status: "failed",
            reason: "Unknown error",
            cleaned: false,
          }
        );
      }

      this.resolveDone(allResults);
      this.resolveDone = null;
    }
  }

  /**
   * 清理成功的 Agent 的 worktree
   */
  async cleanupSuccessful(): Promise<void> {
    for (const entry of this.queue) {
      if (entry.state === "merged" && entry.result) {
        try {
          await removeWorktree(entry.item.agentName, {
            cwd: this.opts.cwd,
            workspaceDir: this.opts.workspaceDir,
            branchPrefix: this.opts.branchPrefix,
          });
          entry.result.cleaned = true;
        } catch {
          // 清理失败不影响流程
        }
      }
    }
  }
}
