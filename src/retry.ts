/**
 * 重试循环管理。
 *
 * 管理 Agent 冲突解决的重试循环：
 * - 追踪重试次数
 * - 在达到 maxRetries 时终止
 * - 支持超时控制
 */

import { AgentError, AgentTimeoutError } from "./errors";
import type { ConflictInfo, ResolutionResult } from "./types";

export interface RetryConfig {
  maxRetries: number;
  conflictTimeout: number;
}

export interface RetryState {
  attempt: number;
  maxRetries: number;
}

/**
 * 创建重试状态
 */
export function createRetryState(maxRetries: number): RetryState {
  return { attempt: 0, maxRetries };
}

/**
 * 检查是否可以重试
 */
export function canRetry(state: RetryState): boolean {
  return state.attempt < state.maxRetries;
}

/**
 * 递增重试次数
 */
export function incrementRetry(state: RetryState): void {
  state.attempt++;
}

/**
 * 带超时的冲突解决调用
 */
export async function resolveWithTimeout(
  agentName: string,
  conflict: ConflictInfo,
  onConflict: (conflict: ConflictInfo) => Promise<ResolutionResult>,
  timeoutMs: number
): Promise<ResolutionResult> {
  return new Promise<ResolutionResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AgentTimeoutError(agentName, timeoutMs));
    }, timeoutMs);

    onConflict(conflict)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(
          new AgentError(
            agentName,
            `Conflict resolution threw an error: ${
              err instanceof Error ? err.message : String(err)
            }`,
            err
          )
        );
      });
  });
}
