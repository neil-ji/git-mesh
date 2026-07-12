/**
 * TypedEventEmitter 测试
 */

import { describe, it, expect, vi } from "vitest";
import { TypedEventEmitter } from "../src/events";

type TestEvents = {
  update: (value: number) => void;
  error: (message: string, code: number) => void;
  empty: () => void;
};

class TestEmitter extends TypedEventEmitter<TestEvents> {
  public fireUpdate(value: number) {
    this.emit("update", value);
  }
  public fireError(message: string, code: number) {
    this.emit("error", message, code);
  }
  public fireEmpty() {
    this.emit("empty");
  }
  public clear() {
    this.removeAllListeners();
  }
}

describe("TypedEventEmitter", () => {
  it("should call handler when event is emitted", () => {
    const emitter = new TestEmitter();
    const handler = vi.fn();

    emitter.on("update", handler);
    emitter.fireUpdate(42);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it("should support multiple handlers for the same event", () => {
    const emitter = new TestEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();

    emitter.on("update", h1);
    emitter.on("update", h2);
    emitter.fireUpdate(1);

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("should pass multiple arguments to handler", () => {
    const emitter = new TestEmitter();
    const handler = vi.fn();

    emitter.on("error", handler);
    emitter.fireError("not found", 404);

    expect(handler).toHaveBeenCalledWith("not found", 404);
  });

  it("should support events with no arguments", () => {
    const emitter = new TestEmitter();
    const handler = vi.fn();

    emitter.on("empty", handler);
    emitter.fireEmpty();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith();
  });

  it("should remove handler with off()", () => {
    const emitter = new TestEmitter();
    const handler = vi.fn();

    emitter.on("update", handler);
    emitter.fireUpdate(1);
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("update", handler);
    emitter.fireUpdate(2);
    expect(handler).toHaveBeenCalledTimes(1); // still 1
  });

  it("should not affect other handlers when removing one", () => {
    const emitter = new TestEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();

    emitter.on("update", h1);
    emitter.on("update", h2);
    emitter.off("update", h1);
    emitter.fireUpdate(99);

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith(99);
  });

  it("should remove all listeners with removeAllListeners", () => {
    const emitter = new TestEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();

    emitter.on("update", h1);
    emitter.on("update", h2);
    emitter.clear();

    emitter.fireUpdate(1);

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it("should not throw when emitting with no handlers", () => {
    const emitter = new TestEmitter();
    expect(() => emitter.fireUpdate(1)).not.toThrow();
  });

  it("should not throw when off() called for unregistered handler", () => {
    const emitter = new TestEmitter();
    const handler = vi.fn();
    expect(() => emitter.off("update", handler)).not.toThrow();
  });
});
