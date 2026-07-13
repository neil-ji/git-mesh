# 与其他 Git SDK 集成

gitmesh 不封装任何 git 操作 — 它只负责**多 Agent 并行变更的合并编排**。Agent 在隔离的 worktree 内完成编码和提交，gitmesh 在背后负责 rebase、merge 和冲突路由。

这种设计让 gitmesh 可以与任何 Git SDK（或 raw CLI）无缝协作 — Agent 在你的 worktree 里用什么工具做 git 操作，gitmesh 完全不管。它只要求在 `signal.done()` 被调用时，worktree 分支上有已提交的变更。

## 架构关系

```
┌──────────────────────────────────────────┐
│              gitmesh（编排层）              │
│  • 创建 worktree  • rebase • merge       │
│  • 冲突检测      • 冲突路由 • 重试        │
└────────────┬─────────────────────────────┘
             │ signal.worktreePath
             ▼
┌──────────────────────────────────────────┐
│       你的 Agent（任意 Git SDK）           │
│  • simple-git  • isomorphic-git          │
│  • nodegit     • raw git CLI             │
│  • 其他任何能操作 git 仓库的工具           │
└──────────────────────────────────────────┘
```

gitmesh 提供 **`signal.worktreePath`** — 一个普通的文件系统路径，指向一个完整的 git 工作区。Agent 在这里可以用任何喜欢的工具完成工作。

## 推荐方案：simple-git

[simple-git](https://github.com/steveukx/git-js) 是最流行的 Node.js git 库，也是与 gitmesh 搭配最自然的选择。

### 基本用法

```typescript
import { gitmesh } from "gitmesh";
import simpleGit from "simple-git";
import * as fs from "fs";

const session = await gitmesh({
  cwd: "/path/to/repo",
  agents: [
    {
      name: "add-feature",
      onReady: async (signal) => {
        // 在 worktree 内使用 simple-git
        const git = simpleGit(signal.worktreePath);

        // 完成编码工作...
        fs.writeFileSync(
          `${signal.worktreePath}/feature.ts`,
          'export const feature = () => "hello";\n'
        );

        // 用 simple-git 提交
        await git.add("feature.ts");
        await git.commit("feat: add new feature");

        // 通知 gitmesh 编码完成
        signal.done();
      },
      onConflict: async (conflict) => {
        // 冲突解决...
        return { resolved: true };
      },
    },
  ],
});

const summary = await session.done();
```

### 冲突解决中使用 simple-git

```typescript
onConflict: async (conflict) => {
  const git = simpleGit(conflict.worktreePath);

  // 用 simple-git 检查仓库状态
  const status = await git.status();
  console.log("冲突文件:", status.conflicted);

  // 读取并解决冲突
  for (const file of conflict.files) {
    const resolved = resolveContent(file.content);
    fs.writeFileSync(`${conflict.worktreePath}/${file.path}`, resolved);
  }

  // 注意：gitmesh 的 continueRebase 内部已调用 git add .，
  // 通常不需要手动 git add，但手动操作也不会有副作用

  return { resolved: true };
};
```

## 使用其他 Git SDK

### isomorphic-git

[isomorphic-git](https://isomorphic-git.org/) 是纯 JavaScript 实现的 git，适合在浏览器或受限环境中运行。

```typescript
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import * as fs from "fs";

const session = await gitmesh({
  agents: [
    {
      name: "iso-agent",
      onReady: async (signal) => {
        const dir = signal.worktreePath;

        // 编写代码
        fs.writeFileSync(`${dir}/module.ts`, "export const x = 1;\n");

        // 用 isomorphic-git 提交
        await git.add({ fs, dir, filepath: "module.ts" });
        await git.commit({
          fs,
          dir,
          message: "feat: add module",
          author: { name: "agent", email: "agent@gitmesh.local" },
        });

        signal.done();
      },
      onConflict: async (conflict) => {
        // 解决冲突
        return { resolved: true };
      },
    },
  ],
});
```

### Raw Git CLI

如果不想引入额外依赖，直接使用 `child_process` 调用 git CLI 也完全可以。

```typescript
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

const session = await gitmesh({
  agents: [
    {
      name: "cli-agent",
      onReady: async (signal) => {
        const cwd = signal.worktreePath;

        fs.writeFileSync(`${cwd}/cli-work.md`, "# CLI Agent Work\n");

        await exec("git", ["add", "cli-work.md"], { cwd });
        await exec("git", ["commit", "-m", "feat: cli agent work"], { cwd });

        signal.done();
      },
      onConflict: async (conflict) => {
        return { resolved: true };
      },
    },
  ],
});
```

## 混合使用

同一个 session 中的不同 Agent 可以使用不同的 Git SDK — gitmesh 不关心每个 Agent 的内部实现。

```typescript
const session = await gitmesh({
  agents: [
    {
      name: "simple-git-agent",
      onReady: async (signal) => {
        const git = simpleGit(signal.worktreePath);
        // ... 用 simple-git 工作
        signal.done();
      },
      onConflict: async (c) => ({ resolved: true }),
    },
    {
      name: "cli-agent",
      onReady: async (signal) => {
        // ... 用 raw git CLI 工作
        signal.done();
      },
      onConflict: async (c) => ({ resolved: true }),
    },
  ],
});
```

## 关键约束

无论你使用哪个 Git SDK，以下约束不变：

| 约束 | 说明 |
|------|------|
| **提交到分支** | 在 `signal.done()` 之前，变更必须已 commit 到 worktree 的分支上 |
| **不要切换分支** | worktree 已绑定到专属分支（`mesh/<agent-name>`），Agent 不应切换分支 |
| **不要修改 .git** | worktree 的 `.git` 是指向主仓库的引用文件，Agent 不应修改它 |
| **设置 git 用户** | 提交需要 `user.name` 和 `user.email`。gitmesh 不自动配置 — 在 `onReady` 中初始化 |
| **文件路径** | 使用 worktree 内的相对路径，不要使用主仓库的绝对路径 |

## 与 gitmesh 内部实现的关系

gitmesh 内部使用 raw `git` CLI 执行编排操作（create worktree、rebase、merge、conflict detection）。这和 Agent 使用的 SDK 是完全独立的两个层面：

- **编排层**（gitmesh 内部）— 使用 raw git CLI。对调用方完全透明
- **Agent 层**（你的代码）— 使用任意 git 工具。gitmesh 不干涉

两个层面通过文件系统（worktree 目录 + git 分支）通信，没有 API 耦合。

## 下一步

- [Agent 协议](./agent-protocol.md) — 理解 onReady/onConflict 的生命周期
- [冲突解决](./conflict-resolution.md) — 深入了解冲突处理流程
- [API 参考](./api-reference.md) — 完整的类型定义
