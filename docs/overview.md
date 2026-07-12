# 概述

gitmesh 是一个用于多 Agent 并行编码的 git 编排工具。它在单仓库内为多个 Agent 创建隔离的 [git worktree](https://git-scm.com/docs/git-worktree)，Agent 各自完成编码后，自动将变更合回主干。遇到冲突时，gitmesh 将冲突路由回对应的 Agent 自行解决，循环直到全部合并成功。

## 解决的问题

当你让多个 AI Agent 同时在一个代码仓库中完成不同任务时，会遇到几个问题：

1. **工作区隔离** — 多个 Agent 不能在同一目录中并行工作，文件会相互覆盖
2. **合并顺序** — Agent 完成时间不同，谁的代码先合入？后来的代码需要变基到新的主干
3. **冲突处理** — 不同 Agent 可能修改了同一个文件，需要有人来解决冲突
4. **失败隔离** — 某个 Agent 的代码有问题时，不能阻塞其他 Agent 的正常合并

gitmesh 把这些事情都做了。

## 核心设计

- **Agent 协议** — gitmesh 不实现 Agent，只定义信号协议。支持 Claude SDK、shell 脚本、HTTP 回调等任意 Agent 实现
- **Rebase-First 合并** — 保持线性 git 历史，冲突在 worktree 内解决，不污染主干
- **冲突路由** — 自动检测冲突，通知对应 Agent 解决，支持重试循环
- **事件驱动** — 完整的 typed 事件系统，可观测全流程进度
- **失败隔离** — 单个 Agent 失败不阻塞其他 Agent

## 它不是什么

- 不是 Agent 框架 — 不实现 AI Agent，不与任何 LLM SDK 耦合
- 不是分布式系统 — 仅支持本地单仓库
- 不是 git 替代品 — 所有 git 操作由原生 git 命令执行，gitmesh 只做编排
- 不是 CI/CD 工具 — 不管理 Agent 生命周期，不调度任务

## 适用场景

| 场景 | 说明 |
|------|------|
| 多 Agent 并行编码 | 同时运行多个 AI Agent，各自修改不同功能，自动合并回主干 |
| Agent 流水线 | 多个 Agent 按顺序工作，每个等待前一个完成 |
| 批量重构 | 多个 Agent 各改一个模块，统一合并 |

## 下一步

- [快速开始](./getting-started.md) — 5 分钟跑通第一个 session
- [核心概念](./core-concepts.md) — 理解 worktree、Agent、合并引擎的关系
- [API 参考](./api-reference.md) — 完整的类型和函数文档
