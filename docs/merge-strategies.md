# 合并策略

合并策略决定了 Agent 完成后的代码何时、以何种顺序合入主干。

gitmesh v1 提供两种内置策略。策略接口可扩展，后续版本将支持自定义策略。

## rebase-first（默认）

Agent 完成后立即执行 rebase，rebase 成功则合并，冲突则通知 Agent 解决后重试。

### 流程

```
Agent-A 完成         Agent-B 完成         Agent-C 完成
    │                    │                    │
    ▼                    ▼                    ▼
 rebase 到 main       rebase 到 main       rebase 到 main
    │                    │                    │
    ├─ 成功              ├─ 冲突              ├─ 成功
    │                    │                    │
    ▼                    ▼                    ▼
 合并到主干           通知 Agent-B        等待合并锁
    │                解决冲突...               │
    ▼                    │                    ▼
 主干 HEAD 更新          ▼              重新 rebase 到
    │              重新 rebase           新主干 HEAD
    │                    │                    │
    │                    ├─ 成功              ▼
    │                    │                合并到主干
    │                    ▼                    │
    │                合并到主干               ▼
    │                    │              主干 HEAD 更新
    │                    ▼
    │              主干 HEAD 更新
    │
    └─────────────────────┬───────────────────
                          ▼
                     全部完成
```

### 特性

| 特性 | 说明 |
|------|------|
| **并发 rebase** | 多个 Agent 可以同时 rebase（各自 worktree 独立） |
| **串行合并** | 写入主干串行化，通过 lockfile 保护 |
| **先成功先合并** | 不阻塞在慢 Agent 上 |
| **主干线性历史** | 没有 merge commit，历史干净 |
| **动态变基** | 每次主干更新后，等待中的 Agent 重新 rebase 到新 HEAD |

### 适用场景

- 多个 Agent 修改的文件没有太多重叠
- 希望保持线性 git 历史
- Agent 完成时间不可预测，需要最大化吞吐

### 选择此策略

```typescript
const session = await gitmesh({
  agents: [...],
  strategy: "rebase-first", // 默认值，可省略
});
```

---

## sequential

严格按 Agent 定义顺序逐个合并。前一个 Agent 完全完成（合并到主干）后，下一个才开始。

### 流程

```
Agent[0] 完成 → rebase → merge → 主干更新
                                     │
Agent[1] 完成 ───────────────────── Wait ─→ rebase → merge → 主干更新
                                                               │
Agent[2] 完成 ─────────────────────────────────────────── Wait ─→ rebase → merge
```

### 特性

| 特性 | 说明 |
|------|------|
| **严格顺序** | 按 Agent 数组顺序逐个处理 |
| **简单可预测** | 不会出现动态变基的情况 |
| **吞吐较低** | 慢 Agent 阻塞后续所有 Agent |
| **主干线性历史** | 同样是 rebase → fast-forward，无 merge commit |

### 适用场景

- Agent 之间有强依赖关系（后一个依赖前一个的输出）
- 需要严格控制合并顺序
- Agent 数量少，完成时间可预测

### 选择此策略

```typescript
const session = await gitmesh({
  agents: [...],
  strategy: "sequential",
});
```

---

## 策略对比

| 维度 | rebase-first | sequential |
|------|-------------|------------|
| 合并顺序 | 先完成先合并 | 固定顺序 |
| 并发 rebase | 是 | 否 |
| 吞吐量 | 高 | 低 |
| git 历史 | 线性 | 线性 |
| 慢 Agent 影响 | 不阻塞其他 | 阻塞后续所有 |
| 复杂度 | 较高 | 低 |
| 适用场景 | 独立任务并行 | 有依赖关系的任务 |

---

## 策略接口（扩展）

策略是可插拔的。未来版本将开放自定义策略接口：

```typescript
// 未来版本的计划接口（v1 暂不开放）
interface MergeStrategy {
  name: string;
  /** 决定下一个应该处理哪个 Agent */
  next(queue: QueueItem[], trunkHead: string): QueueItem | null;
  /** 某个 Agent 合并后通知策略 */
  onMerged(agentName: string, commit: string): void;
  /** 某个 Agent 失败后通知策略 */
  onFailed(agentName: string, reason: string): void;
}
```

计划中的策略方向：

| 方向 | 说明 |
|------|------|
| **DAG 依赖排序** | 通过代码分析预判文件依赖关系，自动决定最优合并顺序 |
| **冲突预检** | Agent 开始前分析任务描述，预估冲突对，提前告警 |
| **分组策略** | 将 Agent 分组，组内 parallel，组间 sequential |

## 下一步

- [冲突解决](./conflict-resolution.md) — 深入了解冲突检测和解决
- [事件系统](./events.md) — 通过事件监控合并进度
