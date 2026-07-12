/**
 * 内存异步锁。
 * 用于序列化主干合并操作，确保同一时间只有一个 Agent 写入主干。
 */

export class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  /**
   * 获取锁。如果锁已被持有，等待直到释放。
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * 释放锁，唤醒下一个等待者。
   */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // 锁保持被持有状态，直接转交给下一个等待者
      next();
    } else {
      this.locked = false;
    }
  }

  /**
   * 当前是否被锁定
   */
  get isLocked(): boolean {
    return this.locked;
  }
}
