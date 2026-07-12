/**
 * Agent 信号桥接。
 *
 * gitmesh 不启动 Agent，也不管理 Agent 进程。
 * 此模块负责：
 * - 在 worktree 创建成功后通知调用方（onReady 回调）
 * - 接收 Agent 完成信号并通知合并引擎
 * - 桥接冲突解决回调
 */

import type {
  AgentDefinition,
  AgentWorkDoneSignal,
  WorktreeInfo,
} from "./types";

/**
 * 为单个 Agent 创建工作信号并调用 onReady
 * 调用方在 onReady 中启动 Agent，Agent 完成后调用 signal.done()
 */
export function createAgentSignal(
  definition: AgentDefinition,
  worktreeInfo: WorktreeInfo,
  onDone: (agentName: string) => void,
  onError: (agentName: string, error: Error) => void
): AgentWorkDoneSignal {
  let called = false;

  const signal: AgentWorkDoneSignal = {
    agentName: definition.name,
    worktreePath: worktreeInfo.path,
    done: () => {
      if (called) {
        // done() 只能调用一次，忽略重复调用
        return;
      }
      called = true;
      onDone(definition.name);
    },
  };

  return signal;
}

/**
 * 调用 Agent 的 onReady 回调
 * 通过 Promise 包装以支持同步和异步回调
 */
export async function invokeAgentReady(
  definition: AgentDefinition,
  signal: AgentWorkDoneSignal
): Promise<void> {
  try {
    await definition.onReady(signal);
  } catch (err) {
    // onReady 中的同步异常在这里捕获
    throw err;
  }
}

/**
 * 获取 Agent 的冲突解决回调
 */
export function getConflictResolver(definition: AgentDefinition) {
  return definition.onConflict;
}
