import { isValidMachineConnectionUrl } from '@bakers-build/core';
import type {
  ConductorStartContext,
  HookListener,
  MachineRegistrationData,
} from '../plugins/executor.js';

/** Dispatch atomically: failures retain the validated baseline, never partial data. */
export async function runStartHooks(
  listeners: readonly HookListener[],
  machine: MachineRegistrationData,
  conductor: Readonly<ConductorStartContext>,
  warn: (reason: string) => void,
): Promise<MachineRegistrationData> {
  const baseline = { ...machine };
  if (
    baseline.connection_url !== undefined &&
    baseline.connection_url !== null &&
    !isValidMachineConnectionUrl(baseline.connection_url)
  ) {
    delete baseline.connection_url;
    warn('invalid manual connection URL; start hooks skipped');
    return baseline;
  }
  const shared = { ...baseline };
  const context = Object.freeze({ ...conductor });
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const validate = () => {
    if (
      Reflect.ownKeys(shared).some(
        (key) =>
          !['host_key', 'machine_label', 'connection_url'].includes(
            String(key),
          ),
      ) ||
      shared.host_key !== baseline.host_key ||
      (shared.machine_label !== undefined &&
        (typeof shared.machine_label !== 'string' ||
          !shared.machine_label.trim() ||
          shared.machine_label.length > 255)) ||
      (shared.connection_url !== undefined &&
        shared.connection_url !== null &&
        !isValidMachineConnectionUrl(shared.connection_url)) ||
      (baseline.connection_url !== undefined &&
        shared.connection_url !== baseline.connection_url)
    )
      throw new Error('invalid start hook data');
  };
  try {
    return await Promise.race([
      (async () => {
        for (const listener of listeners) {
          if (closed) return baseline;
          await listener.before_conductor_start?.(shared, context);
          if (closed) return baseline;
          validate();
        }
        validate();
        return { ...shared };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          closed = true;
          reject(new Error('deadline'));
        }, 5000);
      }),
    ]);
  } catch {
    warn('start hooks discarded after failure, invalid data or timeout');
    return baseline;
  } finally {
    closed = true;
    clearTimeout(timer);
  }
}
