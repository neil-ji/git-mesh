/**
 * Agent 信号桥接。
 *
 * gitmesh 不启动 Agent，也不管理 Agent 进程。
 * 此模块负责：
 * - 在 worktree 创建成功后通知调用方（onReady 回调）
 * - 接收 Agent 完成信号，返回 merge 结果的 Promise
 * - 桥接冲突解决回调
 */

import type {
  AgentDefinition,
  AgentWorkDoneSignal,
  WorktreeInfo,
} from "./types";

/**
 * 为单个 Agent 创建工作信号。
 *
 * 调用方在 onReady 中启动 Agent，Agent 完成后调用 signal.done()，
 * 返回值是 Promise<boolean>，在 merge engine 处理完毕后 resolve。
 */
export function createAgentSignal(
  definition: AgentDefinition,
  worktreeInfo: WorktreeInfo,
  onDone: (agentName: string) => {
    promise: Promise<boolean>;
    enqueue: () => void;
  },
  onError: (agentName: string, error: Error) => void
): AgentWorkDoneSignal {
  let called = false;
  let cachedPromise: Promise<boolean> | null = null;

  const signal: AgentWorkDoneSignal = {
    agentName: definition.name,
    worktreePath: worktreeInfo.path,
    done: async (): Promise<boolean> => {
      if (called && cachedPromise) {
        return cachedPromise;
      }
      called = true;

      const { promise, enqueue } = onDone(definition.name);
      cachedPromise = promise;
      enqueue();  // 立即入队到 merge engine

      return promise;
    },
  };

  return signal;
}

/**
 * 调用 Agent 的 onReady 回调。
 *
 * onReady 是 fire-and-forget —— gitmesh 不等待 onReady 返回。
 * Agent 的生命周期以 signal.done() 为准。
 */
export function invokeAgentReady(
  definition: AgentDefinition,
  signal: AgentWorkDoneSignal
): void {
  try {
    const result = definition.onReady(signal);
    // 如果是 Promise，不 await —— 派发后即返回
    if (result instanceof Promise) {
      result.catch((err) => {
        // onReady 异常记录但不断言失败——agent 可能仍在运行
        // 调用方应通过 signal.done() 管理生命周期
      });
    }
  } catch (err) {
    // onReady 的同步异常 —— agent 不会调用 done()
    // 调用方应通过 onFailed 回调获知
  }
}

/**
 * 获取 Agent 的冲突解决回调
 */
export function getConflictResolver(definition: AgentDefinition) {
  return definition.onConflict;
}
