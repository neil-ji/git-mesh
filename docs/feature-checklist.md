# 功能快速预览

## 核心能力

- [x] **多 worktree 隔离** — 每个 Agent 获得独立 git worktree，并行工作互不干扰
- [x] **自动合并** — Agent 完成后自动 rebase → fast-forward 合入主干
- [x] **冲突路由** — 冲突自动检测，通知对应 Agent 解决，不污染主干
- [x] **重试循环** — 冲突解决后可重试 rebase，直到成功或超限
- [x] **失败隔离** — 单个 Agent 失败不阻塞其他 Agent，独立标记

## 合并策略

- [x] **rebase-first（默认）** — 并发 rebase，串行合并，先完成先合入，主干线性历史
- [x] **sequential** — 严格按顺序逐个合并，有依赖关系的任务专用

## Agent 协议

- [x] `onReady` — 工作区就绪信号，Agent 在此启动编码
- [x] `signal.done()` — Agent 完成信号，通知 gitmesh 开始合并
- [x] `onConflict` — 冲突解决回调，Agent 收到冲突信息自行解决
- [x] `baseRef` — 可指定 worktree 的起点 ref（tag / commit）
- [x] 协议无关实现 — 支持 Claude SDK / shell / HTTP / 任意 Agent

## 冲突处理

- [x] **5 种冲突类型** — conflicted / deleted-by-us / deleted-by-them / deleted-by-both / added-by-both
- [x] **ConflictInfo** — 提供冲突内容 + 主干 diff + Agent diff，Agent 有完整上下文
- [x] **可配置重试次数** — `maxRetries` 控制冲突解决上限
- [x] **超时控制** — `conflictTimeout` 防止 Agent 无限等待
- [x] **失败保留现场** — worktree + 分支不自动删除，支持人工介入
- [x] **降级策略** — Agent 可返回 `{ resolved: false }` 主动放弃

## 事件系统

- [x] **8 个 typed 事件** — 完整覆盖从启动到完成的全流程
- [x] `worktree:ready` — worktree 创建完成
- [x] `agent:done` — Agent 编码完成
- [x] `mesh:rebase` — 开始 rebase
- [x] `mesh:conflict` — 检测到冲突
- [x] `mesh:retry` — 冲突解决后重试
- [x] `mesh:merged` — 成功合入主干
- [x] `mesh:failed` — 合并失败
- [x] `session:done` — 全流程结束
- [x] 事件监听可移除 (`session.off()`)

## 错误体系

- [x] **结构化错误类** — 14 个错误类型，精确捕获
- [x] **错误链保留** — `cause` 属性保留下层 git 原始错误
- [x] `WorktreeError` + 子类 — worktree 创建/删除失败
- [x] `MergeEngineError` + 子类 — rebase/merge/strategy 异常
- [x] `AgentError` + 子类 — 超时/异常/放弃
- [x] `SessionError` + 子类 — 中断/整体失败

## Session 控制

- [x] `session.done()` — 等待全部完成，返回结果摘要
- [x] `session.abort()` — 中断 session，清理所有 worktree
- [x] **SessionSummary** — 整体状态 + 每个 Agent 的详细结果
- [x] **AgentResult** — 合并状态、commit hash、失败原因、清理状态

## 配置选项

- [x] `cwd` — 仓库路径
- [x] `strategy` — 合并策略选择
- [x] `maxRetries` — 每个 Agent 最大重试次数
- [x] `conflictTimeout` — 冲突解决超时时间
- [x] `workspaceDir` — worktree 存储目录
- [x] `trunkBranch` — 主干分支名
- [x] `branchPrefix` — Agent 分支名前缀

## 使用模式

- [x] 编程式 API（TypeScript / JavaScript）
- [x] Promise-based，完整 async/await 支持
- [x] 事件驱动进度追踪
- [x] 批量 Agent 管理
- [x] 工厂模式创建可复用 Agent
- [x] 多轮重试（失败的 Agent 在新 session 中重试）
- [x] CI/CD 集成友好（结构化输出、退出码、日志格式）
- [x] 指标采集（耗时、冲突次数、成功率）

## 文档

- [x] 概述 — 项目介绍和适用场景
- [x] 快速开始 — 5 分钟跑通第一个 session
- [x] 核心概念 — worktree / Agent 协议 / 合并引擎
- [x] API 参考 — 完整类型和函数文档
- [x] Agent 协议 — 接入指南和典型模式
- [x] 合并策略 — rebase-first vs sequential 详解
- [x] 冲突解决 — 检测、路由、重试完整流程
- [x] 事件系统 — 8 个事件详解和用法示例
- [x] 错误处理 — 14 个错误类型和捕获模式
- [x] 高级用法 — 批量管理、工厂模式、CI 集成、指标
