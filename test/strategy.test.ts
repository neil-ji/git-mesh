/**
 * 合并策略测试
 */

import { describe, it, expect } from "vitest";
import { describeStrategy, STRATEGY_REBASE_FIRST, STRATEGY_SEQUENTIAL } from "../src/strategy";

describe("Merge Strategies", () => {
  it("should describe rebase-first strategy", () => {
    const desc = describeStrategy(STRATEGY_REBASE_FIRST);
    expect(desc.toLowerCase()).toContain("rebase");
    expect(desc).toContain("merge");
  });

  it("should describe sequential strategy", () => {
    const desc = describeStrategy(STRATEGY_SEQUENTIAL);
    expect(desc).toContain("definition order");
  });

  it("should handle unknown strategies gracefully", () => {
    const desc = describeStrategy("unknown-strategy");
    expect(desc).toContain("Unknown");
  });
});
