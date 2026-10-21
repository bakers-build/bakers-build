// The conductor's per-item work: the tick only reads what is due and enqueues
// one action per item. Every action starts at once, fails and logs on its own;
// actions of one lane (a ticket) run in order, lanes run in parallel.

import type { ConductorLogger } from '@bakers-build/core';

export interface Action {
  /** An action whose key is queued or running is not enqueued again. */
  key: string;
  /** Actions of one lane run one after another; lanes run in parallel. */
  lane: string;
  run: () => Promise<void>;
}

export class ActionQueue {
  private readonly keys = new Set<string>();
  private readonly lanes = new Map<string, Promise<void>>();
  /** Running action key → start (ms). */
  private readonly running = new Map<string, number>();

  constructor(
    private readonly logger: ConductorLogger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Queued or running actions. */
  get size(): number {
    return this.keys.size;
  }

  /** Starts the action after its lane's last one; false when its key is pending. */
  enqueue(action: Action): boolean {
    if (this.keys.has(action.key)) return false;
    this.keys.add(action.key);
    const tail = (this.lanes.get(action.lane) ?? Promise.resolve()).then(() =>
      this.execute(action),
    );
    this.lanes.set(action.lane, tail);
    void tail.then(() => {
      if (this.lanes.get(action.lane) === tail) this.lanes.delete(action.lane);
    });
    return true;
  }

  /** Resolves once every queued and running action has settled. */
  async drain(): Promise<void> {
    while (this.lanes.size > 0) await Promise.all(this.lanes.values());
  }

  /**
   * Warns once per call about each action running longer than `limitMs`: only
   * addon handlers time out, so a hung hook would otherwise block its ticket's
   * lane without a trace while the heartbeat keeps the conductor healthy.
   */
  warnOverdue(limitMs: number): void {
    const now = this.now();
    for (const [key, started] of this.running) {
      const ms = now - started;
      if (ms > limitMs) {
        this.logger.warn(
          { action: key, ms },
          `action ${key} running for ${ms}ms`,
        );
      }
    }
  }

  /** Never rejects: a lane's chain must survive a failing action. */
  private async execute(action: Action): Promise<void> {
    const started = this.now();
    this.running.set(action.key, started);
    try {
      await action.run();
      const ms = this.now() - started;
      this.logger.debug(
        { action: action.key, ms },
        `action ${action.key} done in ${ms}ms`,
      );
    } catch (err) {
      const ms = this.now() - started;
      this.logger.warn(
        { action: action.key, ms, err: String(err) },
        `action ${action.key} failed after ${ms}ms`,
      );
    } finally {
      this.running.delete(action.key);
      this.keys.delete(action.key);
    }
  }
}
