# 高级用法

涵盖并行模式、错误恢复、自定义工作流等高级场景。

## 大批量 Agent 管理

当 Agent 数量较多时，建议按模块分组管理：

```typescript
interface AgentTask {
  name: string;
  prompt: string;
}

async function runBatch(tasks: AgentTask[]) {
  const session = await gitmesh({
    cwd: "/path/to/repo",
    agents: tasks.map((task) => ({
      name: task.name,
      onReady: (signal) => {
        runClaudeAgent({
          prompt: task.prompt,
          cwd: signal.worktreePath,
        }).then(() => signal.done());
      },
      onConflict: async (conflict) => {
        return runClaudeAgent({
          prompt: buildConflictPrompt(task.prompt, conflict),
          cwd: conflict.worktreePath,
        });
      },
    })),
  });

  return session.done();
}

// 使用
const results = await runBatch([
  { name: "fix-oauth", prompt: "修复 OAuth 登录 token 刷新逻辑" },
  { name: "refactor-db", prompt: "重构数据库迁移层" },
  { name: "add-tests", prompt: "为 auth 模块补充单元测试" },
  { name: "fix-types", prompt: "修复 TypeScript 类型错误" },
]);
```

## Agent 工厂模式

创建可复用的 Agent 工厂：

```typescript
function createAgent(config: {
  name: string;
  baseRef?: string;
  workPrompt: string;
  conflictPrompt?: string;
}): AgentDefinition {
  return {
    name: config.name,
    baseRef: config.baseRef,
    onReady: (signal) => {
      runClaudeAgent({
        prompt: config.workPrompt,
        cwd: signal.worktreePath,
      }).then(() => signal.done());
    },
    onConflict: async (conflict) => {
      const prompt = config.conflictPrompt ??
        buildDefaultConflictPrompt(conflict);

      const ok = await runClaudeAgent({
        prompt,
        cwd: conflict.worktreePath,
      });
      return { resolved: ok };
    },
  };
}

// 使用
const agents = [
  createAgent({
    name: "fix-auth",
    workPrompt: "修复登录逻辑...",
  }),
  createAgent({
    name: "add-api",
    workPrompt: "添加新 API 端点...",
    conflictPrompt: "你是 API 专家，请解决冲突...",
  }),
];
```

## 多 Agent 协同

利用构造函数回调和事件系统实现 Agent 间的协同：

```typescript
const mergedFiles = new Set<string>();

const session = await gitmesh({
  agents: [...],
  // 使用构造函数回调监控进度
  onMerged: (name, commit) => {
    mergedFiles.add(name);
    console.log(`${name} 合并了:`, commit);
  },
  onFailed: (name, reason) => {
    if (reason.includes("conflict")) {
      console.log(`${name} 因冲突失败，启动补偿 Agent...`);
      // 注意：此时 session 仍在运行，不能在同一 session 中新增 Agent
      // 但可以记录信息，在外层处理
    }
  },
  onDone: (summary) => {
    // 根据结果启动第二轮
    if (summary.status === "partial") {
      const failed = summary.results
        .filter(r => r.status !== "merged")
        .map(r => r.agentName);
      console.log(`失败的 Agent: ${failed.join(", ")}`);
      // 可以在这里启动新的 session 重试失败的 Agent
    }
  },
});
```

## 批量重试

第一轮失败后，自动提取失败的 Agent 重试：

```typescript
async function runWithRetry(
  tasks: AgentTask[],
  maxRounds: number = 3
): Promise<SessionSummary> {
  let remaining = tasks;
  let finalSummary: SessionSummary | null = null;

  for (let round = 1; round <= maxRounds; round++) {
    const session = await gitmesh({
      cwd: "/path/to/repo",
      agents: remaining.map((task) => ({
        name: task.name,
        onReady: (signal) => {
          runClaudeAgent({
            prompt: task.prompt,
            cwd: signal.worktreePath,
          }).then(() => signal.done());
        },
        onConflict: async (conflict) => {
          const ok = await runClaudeAgent({
            prompt: buildConflictPrompt(task.prompt, conflict),
            cwd: conflict.worktreePath,
          });
          return { resolved: ok };
        },
      })),
    });

    const summary = await session.done();
    finalSummary = summary;

    // 提取失败的 Agent
    const failed = summary.results
      .filter(r => r.status !== "merged")
      .map(r => r.agentName);

    if (failed.length === 0) break;

    console.log(`第 ${round} 轮: ${failed.length} 个失败，重试...`);
    remaining = tasks.filter(t => failed.includes(t.name));
  }

  return finalSummary!;
}
```

## 自定义冲突解决策略

根据冲突类型采用不同解决策略：

```typescript
function createSmartAgent(name: string, taskPrompt: string): AgentDefinition {
  return {
    name,
    onReady: (signal) => {
      runClaudeAgent({ prompt: taskPrompt, cwd: signal.worktreePath }).then(() => signal.done());
    },
    onConflict: async (conflict) => {
      // 分析冲突类型
      const trivialConflicts = conflict.files.filter(
        f => f.status === "deleted-by-both"
      );
      const seriousConflicts = conflict.files.filter(
        f => f.status === "conflicted" || f.status === "added-by-both"
      );

      // 简单冲突：标记为已解决
      if (seriousConflicts.length === 0) {
        return { resolved: true };
      }

      // 复杂冲突：使用大模型解决
      if (conflict.attempt <= 2) {
        const ok = await runClaudeAgent({
          prompt: buildConflictPrompt(taskPrompt, conflict),
          cwd: conflict.worktreePath,
        });
        if (ok) return { resolved: true };
      }

      // 最后尝试：放弃 Agent 侧改动，接受主干版本
      // 这可能是合理的，取决于你的使用场景
      return {
        resolved: false,
        reason: `${seriousConflicts.length} 个文件需要人工解决`,
      };
    },
  };
}
```

## 监控与指标

```typescript
interface SessionMetrics {
  startTime: number;
  agentTimings: Map<string, { start: number; end?: number }>;
  conflictCount: Map<string, number>;
  mergeCount: number;
  failCount: number;
}

function createMetrics(): SessionMetrics {
  return {
    startTime: Date.now(),
    agentTimings: new Map(),
    conflictCount: new Map(),
    mergeCount: 0,
    failCount: 0,
  };
}

function attachMetrics(session: Session): SessionMetrics {
  const m = createMetrics();

  session.on("worktree:ready", (info) => {
    m.agentTimings.set(info.name, { start: Date.now() });
  });

  session.on("mesh:conflict", (info) => {
    const count = m.conflictCount.get(info.agentName) ?? 0;
    m.conflictCount.set(info.agentName, count + 1);
  });

  session.on("mesh:merged", (name) => {
    const t = m.agentTimings.get(name);
    if (t) t.end = Date.now();
    m.mergeCount++;
  });

  session.on("mesh:failed", (name) => {
    const t = m.agentTimings.get(name);
    if (t) t.end = Date.now();
    m.failCount++;
  });

  session.on("session:done", () => {
    const elapsed = (Date.now() - m.startTime) / 1000;
    console.log(`总计耗时: ${elapsed.toFixed(1)}s`);
    console.log(`成功: ${m.mergeCount}, 失败: ${m.failCount}`);

    for (const [name, timing] of m.agentTimings) {
      const agentTime = timing.end
        ? ((timing.end - timing.start) / 1000).toFixed(1)
        : "未完成";
      console.log(`  ${name}: ${agentTime}s`);
    }
  });

  return m;
}

// 使用（session.on 方式）
const session = await gitmesh({ agents: [...] });
attachMetrics(session);
const summary = await session.done();

// 或使用构造函数回调实现类似监控
async function monitoredSession(tasks) {
  const timings = new Map();

  const session = await gitmesh({
    agents: tasks,
    onMerged: (name) => {
      console.log(`${name} 合并完成`);
    },
    onFailed: (name, reason) => {
      console.log(`${name} 失败: ${reason}`);
    },
    onDone: (summary) => {
      console.log(`Session 结束: ${summary.status}`);
    },
  });

  return session.done();
}
```

## 与 CI/CD 集成

```typescript
import { gitmesh } from "gitmesh";

async function ciPipeline(tasks: AgentTask[]) {
  console.log("=== gitmesh CI Pipeline ===");

  let hasFailures = false;

  const session = await gitmesh({
    cwd: process.env.REPO_PATH ?? process.cwd(),
    agents: tasks.map(createAgent),
    strategy: "rebase-first",
    maxRetries: 2,
    conflictTimeout: 300_000, // CI 环境设置更短的超时
    // 使用构造函数回调代替 session.on()
    onFailed: (name, reason) => {
      hasFailures = true;
      // CI 日志格式
      console.log(`::error title=gitmesh::${name} 合并失败: ${reason}`);
    },
    onMerged: (name, commit) => {
      console.log(`::notice title=gitmesh::${name} 已合并: ${commit.slice(0, 7)}`);
    },
  });

  const summary = await session.done();

  // 输出 CI 摘要
  console.log(`\n--- gitmesh Summary ---`);
  console.log(`Status: ${summary.status}`);
  console.log(`Trunk HEAD: ${summary.trunkHead}`);

  for (const r of summary.results) {
    const icon = r.status === "merged" ? "✅" : "❌";
    const detail = r.status === "merged"
      ? r.mergeCommit?.slice(0, 7)
      : r.reason;
    console.log(`${icon} ${r.agentName}: ${detail}`);
  }

  // CI 退出码
  if (summary.status === "failed") {
    process.exit(1);
  }

  if (hasFailures) {
    console.log("\n⚠️ 部分 Agent 失败，请检查日志");
  }
}
```

## 下一步

- [API 参考](./api-reference.md) — 完整的类型和函数文档
- [错误处理](./error-handling.md) — 错误类型和处理方式
- [事件系统](./events.md) — 事件参考
