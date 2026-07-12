# gitmesh

> Agent 并行编码时，底下的 git 管道工。

在单仓库内为多个 Agent 创建隔离 worktree，Agent 各自完成编码后，自动将变更合回主干。遇冲突时路由回对应 Agent 自行解决，循环直到全部合并成功。

## 特性

- **Agent 协议** — gitmesh 不实现 Agent，只定义信号协议。支持 Claude SDK、shell 脚本、HTTP 回调等任意 Agent 实现
- **Rebase-First 合并** — 保持线性 git 历史，冲突在 worktree 内解决，不污染主干
- **冲突路由** — 自动检测冲突，通知对应 Agent 解决，支持重试循环
- **事件驱动** — 完整的 typed 事件系统，可观测全流程进度
- **失败隔离** — 单个 Agent 失败不阻塞其他 Agent

## 安装

```bash
npm install gitmesh
```

## 快速开始

```typescript
import { gitmesh } from "gitmesh";

const session = await gitmesh({
  cwd: "/path/to/your/repo",
  agents: [
    {
      name: "fix-auth",
      onReady: async (signal) => {
        // Agent 在 signal.worktreePath 中工作
        await runYourAgent({ cwd: signal.worktreePath });
        signal.done(); // 通知 gitmesh 可以合并
      },
      onConflict: async (conflict) => {
        // 冲突时让 Agent 自行解决
        return runConflictResolver(conflict);
      },
    },
    {
      name: "refactor-db",
      onReady: async (signal) => {
        await runYourAgent({ cwd: signal.worktreePath });
        signal.done();
      },
      onConflict: async (conflict) => {
        return runConflictResolver(conflict);
      },
    },
  ],
  strategy: "rebase-first",
  maxRetries: 3,
});

// 监听事件
session.on("mesh:conflict", (info) => {
  console.log(`⚠️ ${info.agentName} 遇到 ${info.files.length} 个冲突文件`);
});

session.on("mesh:merged", (name, commit) => {
  console.log(`✅ ${name} 已合并，commit: ${commit.slice(0, 7)}`);
});

session.on("mesh:failed", (name, reason) => {
  console.log(`❌ ${name} 合并失败: ${reason}`);
});

// 等待全部完成
const summary = await session.done();
console.log(summary);
// { status: "partial", results: [...], trunkHead: "abc1234" }
```

## API

### `gitmesh(options): Promise<Session>`

创建并启动一个 gitmesh session。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cwd` | `string` | `process.cwd()` | 仓库根目录 |
| `agents` | `AgentDefinition[]` | **必填** | Agent 定义列表 |
| `strategy` | `"rebase-first"` \| `"sequential"` | `"rebase-first"` | 合并策略 |
| `maxRetries` | `number` | `3` | 每个 Agent 最大重试次数 |
| `conflictTimeout` | `number` | `600_000` | 冲突解决超时（毫秒） |
| `workspaceDir` | `string` | `"../.gitmesh-workspaces"` | worktree 存储目录 |
| `trunkBranch` | `string` | `"main"` | 主干分支名 |
| `branchPrefix` | `string` | `"mesh/"` | Agent 分支名前缀 |

### AgentDefinition

```typescript
interface AgentDefinition {
  name: string;
  baseRef?: string;
  onReady: (signal: AgentWorkDoneSignal) => void | Promise<void>;
  onConflict: (conflict: ConflictInfo) => Promise<ResolutionResult>;
}
```

### Session

```typescript
interface Session {
  on(event, handler): void;
  off(event, handler): void;
  done(): Promise<SessionSummary>;
  abort(reason?: string): Promise<void>;
}
```

### 事件

| 事件 | 说明 |
|------|------|
| `worktree:ready` | worktree 已创建，Agent 可开始工作 |
| `agent:done` | Agent 完成工作，进入合并队列 |
| `mesh:rebase` | 开始执行 rebase |
| `mesh:conflict` | 发生冲突，需 Agent 解决 |
| `mesh:retry` | Agent 解决了冲突，重试 rebase |
| `mesh:merged` | Agent 分支成功合入主干 |
| `mesh:failed` | Agent 合并失败 |
| `session:done` | 全流程结束 |

## 合并策略

### rebase-first（默认）

Agent 完成后立即 rebase 到当前主干 HEAD。rebase 成功则合并，冲突则通知 Agent 解决后重试。允许多个 Agent 并发 rebase，串行合并写入主干。

### sequential

严格按 Agent 定义顺序逐个合并，前一个完成后下一个才开始。

## 与 treefork 的关系

| treefork | gitmesh |
|----------|---------|
| worktree CRUD | 合并编排 |
| checkpoint | 冲突路由 |
| config 管理 | Agent 协议 |
| CLI + tmux | Session 生命周期 + 事件系统 |

两者互补，不重复。

## License

MIT
