/**
 * 合并策略接口 + 内置策略实现。
 *
 * v1 提供两种策略：
 * - rebase-first（默认）：Agent 完成后立即 rebase → 成功则合并，冲突则解决后重试
 * - sequential：严格按 Agent 定义顺序逐个合并
 */

import type { QueueItem } from "./types";

/**
 * 策略接口
 */
export interface MergeStrategyEngine {
  processItem(item: QueueItem, trunkHead: string): Promise<MergeResult>;
  onTrunkUpdated(newHead: string): void;
}

export interface MergeResult {
  success: boolean;
  reason?: string;
  mergeCommit?: string;
}

/**
 * 内置策略类型
 */
export type BuiltinStrategy = "rebase-first" | "sequential";

/**
 * Rebase-first 策略：
 * - 每个 Agent 完成后立即 rebase 到当前 trunk HEAD
 * - rebase 成功 → 合并
 * - rebase 冲突 → 通知 Agent 解决 → 重试
 * - 允许多个 Agent 并发 rebase，但合并写入主干串行
 *
 * 此模块只定义策略行为接口，实际编排逻辑在 merge-engine.ts
 */
export const STRATEGY_REBASE_FIRST = "rebase-first" as const;

/**
 * Sequential 策略：
 * - 严格按 Agent 定义顺序逐个合并
 * - 前一个完成后（成功或失败），下一个才开始
 */
export const STRATEGY_SEQUENTIAL = "sequential" as const;

/**
 * 获取策略描述
 */
export function describeStrategy(strategy: string): string {
  switch (strategy) {
    case STRATEGY_REBASE_FIRST:
      return "Rebase each agent branch onto trunk, merge on success, resolve conflicts on failure";
    case STRATEGY_SEQUENTIAL:
      return "Process agents in definition order, one at a time";
    default:
      return `Unknown strategy: ${strategy}`;
  }
}
