/**
 * AsyncLock 单元测试
 */

import { describe, it, expect } from "vitest";
import { AsyncLock } from "../src/lock";

describe("AsyncLock", () => {
  it("should acquire and release", () => {
    const lock = new AsyncLock();
    expect(lock.isLocked).toBe(false);

    lock.acquire(); // returns immediately (unlocked)
    expect(lock.isLocked).toBe(true);

    lock.release();
    expect(lock.isLocked).toBe(false);
  });

  it("should queue concurrent acquires", async () => {
    const lock = new AsyncLock();
    const order: string[] = [];

    // First acquire — immediate
    await lock.acquire();
    order.push("first-acquired");

    // Second acquire — queued
    const secondPromise = lock.acquire().then(() => {
      order.push("second-acquired");
    });

    // Third acquire — queued
    const thirdPromise = lock.acquire().then(() => {
      order.push("third-acquired");
    });

    // Give time for promises to queue
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["first-acquired"]);

    // Release first — second should acquire
    lock.release();
    await secondPromise;
    expect(order).toEqual(["first-acquired", "second-acquired"]);

    // Release second — third should acquire
    lock.release();
    await thirdPromise;
    expect(order).toEqual(["first-acquired", "second-acquired", "third-acquired"]);

    lock.release();
    expect(lock.isLocked).toBe(false);
  });

  it("should maintain FIFO order with multiple waiters", async () => {
    const lock = new AsyncLock();
    const acquired: number[] = [];

    // First holder
    await lock.acquire();

    // Queue 5 waiters
    const promises = [1, 2, 3, 4, 5].map((i) =>
      lock.acquire().then(() => {
        acquired.push(i);
      })
    );

    await new Promise((r) => setTimeout(r, 10));

    // Release in sequence
    for (let i = 0; i < 5; i++) {
      lock.release();
      await new Promise((r) => setTimeout(r, 5));
    }
    lock.release();

    await Promise.all(promises);
    expect(acquired).toEqual([1, 2, 3, 4, 5]);
  });

  it("should correctly report isLocked throughout lifecycle", async () => {
    const lock = new AsyncLock();
    expect(lock.isLocked).toBe(false);

    await lock.acquire();
    expect(lock.isLocked).toBe(true);

    // Queue another
    const p = lock.acquire();
    expect(lock.isLocked).toBe(true);

    lock.release();
    await p;
    expect(lock.isLocked).toBe(true);

    lock.release();
    expect(lock.isLocked).toBe(false);
  });

  it("should handle release with empty queue gracefully", () => {
    const lock = new AsyncLock();
    lock.release(); // no-op on unlocked lock
    expect(lock.isLocked).toBe(false);

    lock.acquire();
    lock.release();
    lock.release(); // double release
    expect(lock.isLocked).toBe(false);
  });
});
