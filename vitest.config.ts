import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,          // CI runners are slower for git rebase ops
    hookTimeout: 30_000,
  },
});
