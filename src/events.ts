/**
 * 最小化的 typed EventEmitter。
 * 不依赖外部库，纯 Node.js EventEmitter 封装。
 */

import { EventEmitter } from "events";

export class TypedEventEmitter<
  Events extends Record<string, (...args: any[]) => void>
> {
  private emitter = new EventEmitter();

  on<E extends keyof Events>(event: E, handler: Events[E]): void {
    this.emitter.on(event as string, handler);
  }

  off<E extends keyof Events>(event: E, handler: Events[E]): void {
    this.emitter.off(event as string, handler);
  }

  protected emit<E extends keyof Events>(
    event: E,
    ...args: Parameters<Events[E]>
  ): void {
    this.emitter.emit(event as string, ...args);
  }

  protected removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
