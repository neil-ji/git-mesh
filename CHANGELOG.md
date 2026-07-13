# Changelog

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
