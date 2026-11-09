// Milliseconds between two poller passes, from PM_BOT_POLL_INTERVAL in seconds, and the
// heartbeat's quiet time, from PM_BOT_HEARTBEAT_INTERVAL in seconds.

export const DEFAULT_POLL_SECONDS = 15;
export const DEFAULT_HEARTBEAT_SECONDS = 1800;

export function pollInterval(value) {
  return Number(value || DEFAULT_POLL_SECONDS) * 1000;
}

export function heartbeatInterval(value) {
  return Number(value || DEFAULT_HEARTBEAT_SECONDS) * 1000;
}
