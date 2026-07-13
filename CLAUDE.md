# gitmesh

> Agent 并行编码时的 git 管道工 — 在单仓库内为多个 Agent 创建隔离 worktree，自动将变更合回主干。

## 项目结构

```
src/           TypeScript 源码（入口 index.ts，核心 session.ts + merge-engine.ts）
test/          vitest 测试（14 文件，100 用例）
docs/          SDK 文档源（.md），供 sdk.html fetch 渲染
www/           落地页 + SDK 文档页（.html/.css/.js 分离）
dist/          构建产物（gitignored，prepublishOnly 时 tsc 生成）
```

## 常用命令

```bash
npm test                 # 跑全部测试
npx tsc --noEmit         # 类型检查
npm run build            # 构建 dist/
npm version patch        # bump 版本号 + 打 tag
```

## 发布流程

**只有 push tag 才会触发 npm 发布。** 普通 push 不发布。

```bash
# 1. 确认改动已提交，测试通过
npm test

# 2. bump 版本 + 推送 tag（自动触发 CD pipeline）
npm version patch && git push --follow-tags
```

CD pipeline 流程：`tag push → npm ci → tsc --noEmit → vitest run → npm publish (OIDC Trusted Publishing)`

- 发布不需要 token——用的是 npm Trusted Publishing (OIDC)
- 版本号不可覆盖，每次发布必须 bump

## 关键设计

- **signal.done() 是生命周期锚点** — onReady 是 fire-and-forget，gitmesh 不等待它返回
- **signal.done() 返回 `Promise<boolean>`** — true = 成功合入，false = 失败
- **构造器回调** — `onMerged`/`onFailed`/`onConflict`/`onDone` 在 GitmeshOptions 传入，避免 session.on() 的 race condition

## CI/CD

| Pipeline | 触发条件 | 做什么 |
|----------|---------|--------|
| `ci.yml` | push main / PR / tag `v*` | 矩阵测试 + tag 时自动发布 npm |
| `pages.yml` | push main, docs/ 或 www/ 变更 | 部署 `_site/` 到 GitHub Pages |

**发布流程**：push tag → CI 矩阵测试通过 → `publish` job 发布 npm。CI 不通过则发布不触发。
