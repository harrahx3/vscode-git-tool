import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusyTracker } from "../../src/extension/git/busy";

describe("BusyTracker", () => {
  let starts = 0;
  let stops = 0;
  let tracker: BusyTracker;
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    starts = stops = 0;
    tracker = new BusyTracker(() => {
      starts++;
      return () => stops++;
    }, 150);
  });
  afterEach(() => vi.useRealTimers());

  it("shows one activity for overlapping commands, ended once all are done and settled", async () => {
    const a = deferred();
    const b = deferred();
    const pa = tracker.track(() => a.promise);
    const pb = tracker.track(() => b.promise);
    expect([starts, tracker.busy]).toEqual([1, true]);
    a.resolve();
    await pa;
    await vi.advanceTimersByTimeAsync(500);
    expect(stops).toBe(0); // b still runs
    b.resolve();
    await pb;
    await vi.advanceTimersByTimeAsync(100);
    expect(stops).toBe(0); // settling
    await vi.advanceTimersByTimeAsync(100);
    expect([starts, stops, tracker.busy]).toEqual([1, 1, false]);
  });

  it("merges a burst of consecutive commands into one activity", async () => {
    await tracker.track(async () => "status");
    await vi.advanceTimersByTimeAsync(50);
    await tracker.track(async () => "log");
    await vi.advanceTimersByTimeAsync(200);
    expect([starts, stops]).toEqual([1, 1]);
    await tracker.track(async () => "later");
    await vi.advanceTimersByTimeAsync(200);
    expect([starts, stops]).toEqual([2, 2]);
  });

  it("ends the activity when a command fails, and passes the error on", async () => {
    await expect(tracker.track(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(200);
    expect([starts, stops, tracker.busy]).toEqual([1, 1, false]);
  });

  it("dispose ends a running activity", () => {
    void tracker.track(() => new Promise(() => undefined));
    tracker.dispose();
    expect([starts, stops]).toEqual([1, 1]);
  });
});
