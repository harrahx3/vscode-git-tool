// Tracks running git commands, so the views can show that git is working (the turning arrows
// on the activity-bar icon, like VS Code's Source Control). No `vscode` import: unit-testable.

/**
 * Counts running tasks. `onBusy` is called when the first one starts and returns the function
 * that ends the activity; it is called once all tasks are done for `settleMs`, so a burst of
 * commands (a refresh runs several) shows as one activity instead of flickering.
 */
export class BusyTracker {
  private running = 0;
  private stop?: () => void;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly onBusy: () => () => void,
    private readonly settleMs = 150,
  ) {}

  get busy(): boolean {
    return this.stop !== undefined;
  }

  async track<T>(task: () => Promise<T>): Promise<T> {
    this.running++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.stop ??= this.onBusy();
    try {
      return await task();
    } finally {
      if (--this.running === 0) this.timer = setTimeout(() => this.end(), this.settleMs);
    }
  }

  private end(): void {
    this.timer = undefined;
    if (this.running) return;
    const stop = this.stop;
    this.stop = undefined;
    stop?.();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.running = 0;
    this.end();
  }
}
