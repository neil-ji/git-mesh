# gitmesh — Architecture

Agent 并行编码时，底下的 git 管道工。在单仓库内为多个 Agent 创建隔离 worktree，Agent 各自完成编码后，自动将变更合回主干。遇冲突时路由回对应 Agent 自行解决，循环直到全部合并成功。

- **仅支持编程式调用**（暂无 CLI）
- TypeScript，MIT 协议
- 单机、单仓库、本地 git

---

## 1. 概念模型

```
                    主干 (main)
                      │
         ┌────────────┼────────────┐
         │            │            │
      agent-A      agent-B      agent-C     ← 各自独立 worktree，并行工作
         │            │            │
         ▼            ▼            ▼
       完成          完成          完成
         │            │            │
         └────────────┼────────────┘
                      │
                 Merge Engine         ← 排序、rebase、合并、冲突路由
                      │
                      ▼
                   主干更新
```

gitmesh 管理从「Agent 开始工作」到「所有 Agent 代码合入主干」的完整流程。它不管 Agent 怎么实现（Claude SDK、shell 脚本、手写代码都行），只定义 Agent 必须遵守的协议。

**gitmesh 做什么：**
- 给每个 Agent 创建独立的 git worktree
- 监听 Agent 完成信号，按策略决定合并顺序
- 执行 rebase → merge，冲突时通知 Agent 自行解决
- 超时或重试耗尽的 Agent 上报失败，不阻塞其他 Agent

**gitmesh 不做什么：**
- 不实现 Agent（外部实现，遵循 Agent 协议即可）
- 不实现合并算法（git 的事）
- 不搞分布式协调（单机本地仓库）
- 不管理 Agent 生命周期（启动、停止、重启由调用方负责）

---

## 2. 系统分层

```
┌──────────────────────────────────────────┐
│               Public API                 │  gitmesh(), Session
├──────────────────────────────────────────┤
│              Session Layer               │  生命周期、事件路由、结果聚合
├──────────────────┬───────────────────────┤
│   Agent Runner   │    Merge Engine       │  Agent 适配、合并编排
├──────────────────┴───────────────────────┤
│           Worktree Subsystem             │  git worktree CRUD（内部）
├──────────────────────────────────────────┤
│                 git                      │  裸 git 命令
└──────────────────────────────────────────┘
```

### 2.1 Worktree Subsystem（最底层，内部使用）

自包含的轻量 worktree 管理层，不暴露为公开 API。仅供 session 内部调用。

职责：
- `create(name, baseRef)` — 创建 worktree + 分支
- `remove(name, force)` — 删除 worktree + 分支
- `list()` — 列出当前 session 管理的 worktree
- `status(name)` — 返回 worktree 的 dirty/clean 状态、当前 HEAD

不做的事：
- 无 checkpoint 机制（gitmesh 用 git reflog 回溯，不需要显式快照）
- 无 remote 模式（只本地仓库，不 clone 远端）
- 无 config 文件（所有配置通过 `gitmesh()` 参数传入）

### 2.2 Merge Engine（合并编排）

职责：
- 维护合并队列，按策略决定处理顺序
- 执行 rebase：将 Agent 的 worktree 分支 rebase 到当前主干 HEAD
- 检测冲突：rebasing 失败 → 收集冲突信息 → 路由给 Agent
- 执行合并：rebase 成功后，fast-forward 合入主干
- 管理重试循环

策略是可插拔的，通过 `strategy` 参数指定。v1 提供两种：

| 策略 | 行为 |
|------|------|
| `rebase-first`（默认） | Agent 完成后立即 rebase → 成功则合并，冲突则解决后重试 |
| `sequential` | 严格按 Agent 定义顺序逐个合并，前一个完成后下一个才开始 |

策略接口后续可扩展（如 DAG 依赖排序、文件冲突预检等）。

### 2.3 Agent Runner

Agent 运行器是 gitmesh 和外部 Agent 之间的适配层。

gitmesh 不启动 Agent，也不管理 Agent 进程。它假设 Agent 已经由调用方启动，gitmesh 只负责：
- 在 worktree 创建成功后通知调用方「工作区已就绪」
- 接收调用方传入的「Agent 工作完成」信号
- 冲突时把冲突信息传给调用方，等待 Agent 解决

### 2.4 Session Layer（最上层）

Session 是调用方的唯一入口。它：
- 持有所有 worktree 引用
- 管理 Merge Engine 的启停
- 聚合事件流
- 在全部完成后返回结果摘要

---

## 3. Agent 协议

Agent 是 gitmesh 的外部实体。调用方通过实现以下接口将 Agent 接入：

```typescript
// gitmesh 不定义 Agent 类，只定义它需要的回调签名

type AgentWorkDone = (signal: {
  agentName: string;
  // Agent 在 worktree 中的 commit 已完成，可以开始合并
}) => void;

type AgentResolveConflict = (conflict: ConflictInfo) => Promise<ResolutionResult>;
```

**Agent 不必是一个类实例**——可以是一个 HTTP 回调、一个 IPC 消息、一个函数调用。gitmesh 只关心两件事：
1. 怎么知道 Agent 干完了？（`AgentWorkDone`）
2. 怎么让 Agent 解决冲突？（`AgentResolveConflict`）

调用方负责把这两个信号桥接到实际的 Agent 实现。

---

## 4. 合并引擎

### 4.1 Rebase-First 流程（默认策略）

```
Agent 完成
    │
    ▼
┌─────────────────┐
│  rebase worktree │  git rebase origin/main (在 worktree 内执行)
│  onto main HEAD  │
└────────┬────────┘
         │
    ┌────┴────┐
    │ 冲突？   │
    └────┬────┘
    无冲突│   有冲突
         │      │
         ▼      ▼
    ┌────────┐ ┌──────────────────┐
    │ 合并    │ │ 构建 ConflictInfo │
    │ fast-fwd│ │ 通知 Agent 解决   │
    └───┬────┘ └────────┬─────────┘
        │               │
        ▼               ▼
    ┌────────┐    ┌──────────────┐
    │ 清理    │    │ Agent 解决后  │
    │worktree │    │ 重新 rebase   │
    └───┬────┘    └──────┬───────┘
        │               │
        ▼               │ 重试次数 < max
    ┌────────┐          │
    │ 下一个   │          │ 重试次数 = max
    │ Agent   │          │
    └────────┘          ▼
                   ┌──────────┐
                   │ 标记失败  │
                   │ 继续下一个 │
                   └──────────┘
```

### 4.2 为什么 rebase-first 是默认

- **主干保持线性历史**，没有 merge commit 噪音
- **冲突在 worktree 内解决**，不污染主干
- **Agent 只看到自己的变更和主干的差异**，冲突上下文清晰
- **失败的 Agent 不影响其他 Agent**（跳过他，继续队列）

### 4.3 合并队列

当多个 Agent 同时完成，合并引擎将它们放入队列。`rebase-first` 策略下队列行为：

- 并发 rebase：多个 Agent 可以同时 rebase（因为各自 worktree 独立）
- 串行合并：写入主干必须串行（git 的约束），通过文件锁保护
- 先成功先合并：不阻塞在慢 Agent 上

```
Agent-A rebasing ──→ success ──→ merge ──→ 主干更新
Agent-B rebasing ──→ conflict ──→ 等待 Agent 解决
Agent-C rebasing ──→ success ──→ 等待 merge 锁
                                        │
                            主干更新后 Agent-C 重新 rebase 到新主干
                                        │
                                       ...
```

这里的关键细节：每次主干更新后，所有还在 rebase 中的 Agent 需要**重新 rebase 到新主干**。这避免了「基于旧主干 rebase 成功，合并时却发现新冲突」的情况。

---

## 5. 冲突系统

### 5.1 ConflictInfo 结构

冲突发生时，gitmesh 构建以下结构传给 Agent：

```typescript
type ConflictInfo = {
  /** Agent 名称 */
  agentName: string;
  /** 发生冲突的文件列表 */
  files: ConflictFile[];
  /** 当前 rebase 尝试次数 */
  attempt: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** rebase 的目标 commit（主干当前 HEAD） */
  targetCommit: string;
  /** Agent 分支的当前 commit */
  sourceCommit: string;
  /** worktree 路径，Agent 在此目录内解决冲突 */
  worktreePath: string;
};

type ConflictFile = {
  /** 相对于 repo root 的文件路径 */
  path: string;
  /** 冲突状态：git 标记了冲突区域 */
  status: "conflicted" | "deleted-by-us" | "deleted-by-them" | "added-by-both";
  /** 冲突内容（含 <<<<<<< ======= >>>>>>> 标记），Agent 可直接编辑此文件 */
  content: string;
  /** 主干侧改了什么（对方改了什么） */
  incomingDiff: string;
  /** Agent 侧改了什么（我方改了什么） */
  outgoingDiff: string;
};
```

Agent 解决冲突后返回：

```typescript
type ResolutionResult = {
  /** 是否已解决 */
  resolved: boolean;
  /** 如无法解决，说明原因 */
  reason?: string;
};
```

### 5.2 冲突解决循环

```
ConflictInfo → Agent.resolveConflict()
    │
    ├─ resolved: true  → gitmesh git add → git rebase --continue
    │                     ├─ 成功 → 继续合并
    │                     └─ 又冲突 → 再次 ConflictInfo（attempt + 1）
    │
    └─ resolved: false → 标记失败，跳过此 Agent，记录 reason
```

循环终止条件：
- Agent 解决后 rebase 成功 → 进入合并
- Agent 放弃解决（`resolved: false`）→ 标记失败
- 重试次数达到 `maxRetries` → 标记失败

即使标记失败，Agent 的 worktree 和分支**不会立即删除**，以便人工介入后手动合并。

---

## 6. Session 状态机

```
                    ┌─────────┐
                    │  IDLE   │
                    └────┬────┘
                         │ gitmesh({agents, strategy})
                         ▼
                    ┌─────────┐
                    │  INIT   │  创建 worktree，验证 git 环境
                    └────┬────┘
                         │
                         ▼
                    ┌─────────┐
                    │ WORKING │  Agent 在各自 worktree 中工作
                    └────┬────┘
                         │ Agent 完成信号
                         ▼
                    ┌─────────┐
                    │ MERGING │  rebase → merge 循环
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │  DONE  │ │PARTIAL │ │ FAILED │
         │ 全部成 │ │部分成功│ │ 全部失 │
         │ 功合并 │ │部分失败│ │ 败合并 │
         └────────┘ └────────┘ └────────┘
```

状态转换规则：
- `INIT` → `WORKING`：所有 worktree 创建成功
- `INIT` → `FAILED`：git 环境异常或 worktree 创建失败
- `WORKING` → `MERGING`：任意 Agent 完成工作
- `MERGING` → `WORKING`：仍有 Agent 未完成，等待中
- `MERGING` → `DONE`：所有 Agent 处理完毕且全部成功
- `MERGING` → `PARTIAL`：所有 Agent 处理完毕，部分成功部分失败
- `MERGING` → `FAILED`：所有 Agent 均合并失败

---

## 7. 事件系统

gitmesh 通过 typed EventEmitter 暴露所有状态变化。调用方通过监听事件获知进度：

```typescript
session.on("worktree:ready", (info: WorktreeInfo) => {
  // worktree 已创建，Agent 可开始工作
});

session.on("agent:done", (name: string) => {
  // 某个 Agent 完成工作，进入合并队列
});

session.on("mesh:rebase", (name: string) => {
  // 开始对某个 Agent 的分支执行 rebase
});

session.on("mesh:conflict", (info: ConflictInfo) => {
  // 发生冲突，需 Agent 解决
});

session.on("mesh:retry", (name: string, attempt: number) => {
  // Agent 解决了冲突，重试 rebase
});

session.on("mesh:merged", (name: string, commit: string) => {
  // 某个 Agent 的分支成功合入主干
});

session.on("mesh:failed", (name: string, reason: string) => {
  // 某个 Agent 合并失败（重试耗尽或 Agent 放弃）
});

session.on("session:done", (summary: SessionSummary) => {
  // 全流程结束
});
```

---

## 8. 错误模型

```
GitmeshError (基类)
├── WorktreeError          worktree 操作失败
│   ├── WorktreeCreateError
│   └── WorktreeRemoveError
├── MergeEngineError        合并引擎错误
│   ├── RebaseError         rebase 失败（冲突以外的原因）
│   ├── MergeError          合并写入主干失败
│   └── StrategyError       策略执行异常
├── AgentError              Agent 侧错误
│   ├── AgentTimeoutError   Agent 解决冲突超时
│   ├── AgentResolveError   Agent 返回异常结果
│   └── AgentAbandonError   Agent 放弃解决冲突
└── SessionError            Session 级别错误
    └── SessionInterrupted  外部中断（SIGINT 等）
```

所有错误携带 `cause` 链，不吞原始 git 错误。

---

## 9. 类型系统概要

```typescript
// === 入口 ===

type GitmeshOptions = {
  /** 仓库根目录，默认 process.cwd() */
  cwd?: string;
  /** Agent 定义 */
  agents: AgentDefinition[];
  /** 合并策略，默认 "rebase-first" */
  strategy?: MergeStrategy;
  /** 每个 Agent 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 冲突解决超时（毫秒），默认 600_000（10 分钟） */
  conflictTimeout?: number;
  /** worktree 存储目录，默认 "../.gitmesh-workspaces" */
  workspaceDir?: string;
  /** 主干分支名，默认 "main" */
  trunkBranch?: string;
  /** Agent 分支名前缀，默认 "mesh/" */
  branchPrefix?: string;
};

type AgentDefinition = {
  /** 唯一名称，用作 worktree 目录名和分支名的一部分 */
  name: string;
  /** 基于哪个 ref 创建工作区，默认 trunkBranch */
  baseRef?: string;
  /** Agent 工作完成回调，调用方在此通知 gitmesh */
  onReady: (signal: AgentWorkDoneSignal) => void | Promise<void>;
  /** 冲突解决回调，调用方在此桥接 Agent 解决冲突 */
  onConflict: AgentResolveConflict;
};

type AgentWorkDoneSignal = {
  agentName: string;
  worktreePath: string;
  /** 调用此方法通知 gitmesh：Agent 已完成，可以合并 */
  done: () => void;
};

// === 入口函数 ===

function gitmesh(options: GitmeshOptions): Promise<Session>;

// === Session ===

interface Session {
  /** 事件监听 */
  on<E extends keyof SessionEvents>(event: E, handler: SessionEvents[E]): void;
  /** 移除监听 */
  off<E extends keyof SessionEvents>(event: E, handler: SessionEvents[E]): void;
  /** 等待全部完成，返回结果摘要 */
  done(): Promise<SessionSummary>;
  /** 中断 session */
  abort(reason?: string): Promise<void>;
}

// === 结果摘要 ===

type SessionSummary = {
  status: "success" | "partial" | "failed";
  results: AgentResult[];
  /** 最终主干 HEAD */
  trunkHead: string;
};

type AgentResult = {
  agentName: string;
  status: "merged" | "failed" | "abandoned";
  /** 合并后的主干 commit（仅 merged 时有值） */
  mergeCommit?: string;
  /** 失败原因（仅 failed/abandoned 时有值） */
  reason?: string;
  /** worktree 是否已清理 */
  cleaned: boolean;
};
```

---

## 10. 包结构

```
gitmesh/
├── src/
│   ├── index.ts            # 公开 API 入口：export { gitmesh, ... }
│   ├── types.ts            # 所有类型定义
│   │
│   ├── session.ts          # Session 实现，生命周期 + 事件路由
│   │
│   ├── agent-runner.ts     # Agent 信号桥接，onReady/onConflict 调用管理
│   │
│   ├── merge-engine.ts     # 合并引擎主逻辑：队列管理、流程控制
│   ├── strategy.ts         # MergeStrategy 接口 + 内置策略实现
│   ├── rebase.ts           # rebase 操作封装
│   ├── merge.ts            # 合并操作封装 + 文件锁
│   ├── conflict.ts         # 冲突检测、ConflictInfo 构建
│   ├── retry.ts            # 重试循环管理
│   │
│   ├── worktree.ts         # git worktree CRUD（内部）
│   ├── git.ts              # 裸 git 命令封装
│   ├── lock.ts             # 主干合并文件锁
│   │
│   ├── events.ts           # Typed EventEmitter
│   ├── errors.ts           # 错误类体系
│   │
│   └── validate.ts         # 参数校验、git 环境检查
│
├── test/
│   ├── session.test.ts
│   ├── merge-engine.test.ts
│   ├── strategy.test.ts
│   ├── worktree.test.ts
│   ├── conflict.test.ts
│   └── _helpers.ts         # 测试用临时仓库创建工具
│
├── package.json
├── tsconfig.json
├── README.md
├── ARCHITECTURE.md
└── LICENSE                 # MIT
```

---

## 11. 关键设计决策

### 11.1 为什么 Agent 是外部协议而不是内部类

Agent 的实现方式千差万别——可能是 Claude SDK 调用、可能是 shell 脚本、可能是 HTTP 回调。把 Agent 抽象为 gitmesh 内部类会让框架和特定 Agent 实现耦合。协议模式让调用方自行桥接，gitmesh 只关心「完成」和「解决冲突」两个信号。

### 11.2 为什么 worktree 层是内部的

worktree CRUD 对 gitmesh 的调用方没有独立价值。调用方不需要「给我一个 worktree 让我自己管理」。gitmesh 的 worktree 层只服务于自身的合并编排，暴露出去会增加 API 表面积和维护负担。

### 11.3 为什么默认 rebase-first 而不是 merge

- Agent 产出通常是连续的 commit 序列，rebase 保持线性历史
- Agent 的 commit message 可能质量不高（AI 生成的），没必要保留原始的 commit 图
- 冲突在 rebase 过程中逐个 commit 解决，比一次 merge 要处理的冲突面更细粒度

### 11.4 主干合并的文件锁

写入主干是唯一的串行点。使用 lockfile 而非 git 内置锁，因为：
- git 锁作用于整个仓库，会阻塞其他正在 rebase 的 Agent
- lockfile 只锁合并写入这一步，rebase 可以并行

### 11.5 失败的 worktree 不立即清理

Agent 合并失败后，worktree 和分支保留在现场。这允许：
- 人工进入 worktree 手动完成合并
- 查看 Agent 的 commit 历史和 diff
- 调试为什么冲突解决失败

Session 提供了 `abort()` 方法，调用方可选择批量清理。

---

## 12. 使用示例

```typescript
import { gitmesh } from "gitmesh";

// 两个 agent 并行工作，gitmesh 管合并
const session = await gitmesh({
  cwd: "/home/user/project",
  agents: [
    {
      name: "fix-auth",
      onReady: async (signal) => {
        // 在 worktree 里启动 Agent 工作
        await runClaudeAgent({
          prompt: "修复 OAuth 登录的 token 刷新逻辑",
          cwd: signal.worktreePath,
        });
        // Agent 完成，通知 gitmesh 可以合并了
        signal.done();
      },
      onConflict: async (conflict) => {
        // 冲突了，让 Agent 自己解决
        return runClaudeAgent({
          prompt: buildConflictPrompt(conflict),
          cwd: conflict.worktreePath,
        });
      },
    },
    {
      name: "refactor-db",
      onReady: async (signal) => {
        await runClaudeAgent({
          prompt: "重构数据库迁移层",
          cwd: signal.worktreePath,
        });
        signal.done();
      },
      onConflict: async (conflict) => {
        return runClaudeAgent({
          prompt: buildConflictPrompt(conflict),
          cwd: conflict.worktreePath,
        });
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

---

## 13. 未决问题 / 未来方向

| 方向 | 说明 |
|------|------|
| **DAG 依赖排序** | 通过代码分析预判 Agent 之间修改的文件依赖关系，自动决定最优合并顺序 |
| **冲突预检** | Agent 开始工作前，分析其任务描述和现有代码，预估可能冲突的 Agent 对，提前告警 |
| **部分回滚** | 某个 Agent 合并后发现引入 bug，支持只回滚该 Agent 的 commit 而不影响其他 Agent |
| **CLI** | 后续可加 CLI，但核心保持 library-first |
| **Remote 模式** | 支持从远端 clone 仓库，但合并仍在本地 |
| **Checkpoint** | 在 rebase 前自动拍 checkpoint，方便回滚 |
| **Agent 工作流模板** | 预置常见的 onConflict prompt 模板，减少调用方重复编写 prompt |

---

## 14. 设计理念

gitmesh 内部的 worktree 层是自包含的轻量实现，不依赖外部工具。Session 生命周期、事件系统和 Agent 协议共同构成了 gitmesh 的核心价值——在单仓库内协调多个 Agent 的并行编码和自动合并。
