// Milliseconds between two poller passes, from PM_BOT_POLL_INTERVAL in seconds.

export const DEFAULT_POLL_SECONDS = 15;

export function pollInterval(value) {
  return Number(value || DEFAULT_POLL_SECONDS) * 1000;
}
