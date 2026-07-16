# Changelog

## [0.1.22] - 2026-07-16

_Rebase dirty-tree 保护 — 消除 autoCommitWorktree workaround。_

- feat: `rebaseBranch` 执行前检查 worktree 是否干净，脏时抛清晰错误
- feat: `GitmeshOptions` 新增 `onBeforeRebase` 回调 — 每次 rebase 前调用，允许适配器清理 worktree 未提交的改动
- docs: 高级用法新增「进度追踪」章节 — 用构造函数回调做粒度化状态展示
- test: 新增 2 个测试（rebase dirty check、onBeforeRebase hook）

## [0.1.21] - 2026-07-16

_Merge 策略可插拔 — squash merge + conflict strategy。_

- feat: `AgentDefinition` 新增 `conflictStrategy` — `"route-to-agent"`（默认）/ `"accept-agent"` / `"accept-trunk"`，非 route 模式直接 git checkout --ours/--theirs 解决，跳过 agent 回调
- feat: `AgentDefinition` 新增 `mergeStrategy` — `"ff-only"`（默认）/ `"squash"`，squash 将所有 agent commits 压缩为一条
- feat: `AgentDefinition` 新增 `squashMessage` — mergeStrategy 为 "squash" 时必填
- feat: 新增 `autoResolveConflicts()` 公开函数 — 处理 rebase 上下文中的 git ours/theirs 语义反转
- feat: 新增 `squashMerge()` 公开函数 — squash merge 的底层实现
- feat: 校验：squash 无 message 时抛 SessionError；conflictStrategy 非 route 时 onConflict/resolveConflict 可选
- test: 新增 5 个测试（squashMerge、conflictStrategy accept-trunk/accept-agent、端到端）
- docs: API 参考更新 AgentDefinition 新字段和导出清单

## [0.1.20] - 2026-07-16

_脏工作树处理 — 三层方案解决 merge 时主仓库脏文件导致的合并失败。_

- feat: `fastForwardMerge` 合并前检测 working tree 是否干净，不干净时抛出清晰错误（含脏文件列表）
- feat: `GitmeshOptions` 新增 `onBeforeMerge` 回调 — 每次 merge 前调用，允许适配器清理主仓库脏文件
- feat: `GitmeshOptions` 新增 `mergeMode: 'full' | 'ref-only'` — ref-only 模式仅用 `git update-ref` 更新 ref，完全跳过 working tree 操作
- feat: 新增 `refOnlyMerge()` 公开函数 — ref-only 合并的底层实现
- feat: 新增 `checkWorkingTreeClean()` 公开函数 — 检查 working tree 是否有脏文件
- docs: API 参考新增 `onBeforeMerge`、`mergeMode` 文档
- docs: 高级用法新增「脏工作树处理」章节，含三种方案对比和 spark-hub 迁移示例
- test: 新增 8 个测试用例（脏树检测、onBeforeMerge hook、ref-only merge）

## [0.1.19] - 2026-07-13

_resolveConflict session 复用 — runPrompt 透传。_

- feat: `AgentDefinition` 新增 `runPrompt` 回调 — 定义一次，gitmesh 自动透传到 `resolveConflict` 的 params 中
- feat: `ConflictResolutionParams` 新增 `runPrompt` 字段 — 适配器可复用 `onReady` 中创建的 agent session，无需每次冲突都 fork 新进程
- feat: 新增 `RunPromptResult` 类型 `{ success: boolean; output: string }` 并导出
- test: 新增 runPrompt 透传集成测试（共 121 个测试）
- docs: 冲突解决文档新增「复用 Agent Session」章节，含对比表和使用示例

## [0.1.18] - 2026-07-13

_冲突解决循环内建 — resolveConflict 模式。_

- feat: 新增 `resolveConflict` 回调 — gitmesh 自动构建 prompt、管理冲突循环，Agent 只需关注解决冲突本身
- feat: 新增 `buildConflictPrompt()` 公开 API — 将 ConflictInfo 翻译为 LLM/人类可读的冲突描述（纯函数，不依赖任何 SDK）
- feat: prompt 生成支持自定义（`ConflictPromptOptions`）：header、hints（追加模式检测）、maxFileContent 截断
- feat: `AgentDefinition.onConflict` 改为可选 — 可仅提供 `resolveConflict`，优先级 onConflict > resolveConflict > 默认放弃
- test: 新增 7 个 `buildConflictPrompt` 单测 + 4 个 `resolveConflict` 集成测试（共 120 个测试）
- docs: 更新冲突解决文档，补充两种模式的循环流程图和使用指南

## [0.1.17] - 2026-07-13

_SDK 集成 & 包体积优化。_

- docs: 新增 `docs/sdk-integration.md` — gitmesh 与 simple-git、isomorphic-git、nodegit 等主流 Git SDK 的集成指南
- test: 新增 6 个 SDK 集成测试（`test/sdk-integration.test.ts`）— simple-git 基本操作、并行 Agent、冲突解决、混合 SDK 场景
- perf: 移除 sourceMap 和 declarationMap，包体积 42.1 kB → 28.4 kB（-33%），文件数 67 → 35
- feat: package.json 新增 `exports` 字段和 `sideEffects: false`
- docs: README 新增「与其他 Git SDK 集成」章节 + SDK 对照表

## [0.1.16] - 2026-07-13

_API: worktreePath 审计增强。_

- feat: `AgentResult` 新增 `worktreePath` 字段，`onDone` 回调中直接拿到每个 agent 的 worktree 路径
- feat: `mesh:failed` 事件和 `onFailed` 回调新增第三个参数 `worktreePath`，调用方无需手动维护 name→path 映射
- 调用方只需监听 `onDone`，从 `SessionSummary.results` 即可获得完整审计信息（路径 + 清理状态）

## [0.1.15] - 2026-07-13

_生命周期可靠性修复。_

- fix: `engine.abort()` 直接 resolve done promise，防止 `Session.done()` 在 abort 后永久挂起
- fix: `engine.start()` 增加三次 `isAborted` 检查（启动前、getTrunkHead 后、Promise 构造函数内），防止 abort 后重入
- fix: `onReady` 抛出异常时自动触发 `mesh:failed` 并通知引擎，防止 session 挂起
- feat: `MergeEngine.markFailed()` 方法，支持直接将 Agent 标记为失败（无需经过 rebase/merge）
- feat: `SessionImpl.abort()` 设置 `finished = true`，确保 `done()` 和 `abort()` 互斥
- docs: 补充 `workspaceDir` 路径规则、`abort()`/`done()` 互斥行为、`onReady` 异常处理说明
- test: 新增 3 个 abort/done 生命周期测试用例（共 103 个测试）

## [0.1.14] - 2026-07-13

_CI/CD 结构优化。_

- ci: merge publish into CI pipeline，tag push 先跑矩阵测试，通过后自动发布
- docs: 新增 CLAUDE.md，含项目结构、常用命令、发布流程

## [0.1.13] - 2026-07-13

_首个通过 OIDC Trusted Publishing 发布的版本。_

- feat: API v2 — `signal.done()` 成为生命周期锚点，onReady 改为 fire-and-forget
- feat: `signal.done()` 返回 `Promise<boolean>`，调用方可直接 await merge 结果
- feat: `GitmeshOptions` 新增 `onMerged` / `onFailed` / `onConflict` / `onDone` 构造器回调，消除 `session.on()` 时序竞争
- fix: `start()` 中 onReady 失败不再被 `allSettled` 静默吞掉
- fix: abort 与 start 竞态——worktree 创建循环中检查 abort 标志
- fix: `enqueue()` 在引擎运行后自动触发 `processQueue()`，消除 setTimeout(10ms) 竞态
- ci: 修复 vitest CLI 参数名 (`--testTimeout` 驼峰) + 删掉 CJS/ESM 冲突的 `vitest.config.ts`
- ci: npm 发布改为 Trusted Publishing (OIDC)，不再需要 `NPM_TOKEN`

## [0.1.0] - 2026-07-12

_初始发布。_

- 核心功能：多 Agent worktree 隔离、rebase-first 合并、冲突路由与重试
- 两种合并策略：`rebase-first`、`sequential`
- 8 个 typed 事件覆盖全流程
- 14 个错误类型的结构化错误体系
- API 文档、落地页、SDK 文档页
