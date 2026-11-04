import { readdirSync, readFileSync, statSync } from 'node:fs';

/**
 * The platform-facing half of pid verification, injected so tests never touch a
 * real process.
 */
export interface ProcProbe {
  /** Whether this platform can report a running process's identity at all. */
  readonly supported: boolean;
  /**
   * The full command line of a running process (its argv, joined with single
   * spaces), or `undefined` when it cannot be read — the process is gone, or
   * (on some platforms) owned by another user.
   */
  cmdlineOf(pid: number): string | undefined;
  /** The uid that owns a running process, or `undefined` when it cannot be read. */
  uidOf(pid: number): number | undefined;
  /** Deliver a signal. Throws what the platform throws. */
  send(pid: number, signal: NodeJS.Signals): void;
}

export type SignalFailureReason =
  /** Nothing on record to signal — the conductor never reported a pid. */
  | 'no-pid'
  /** The pid is gone, or belongs to something that is not this conductor. */
  | 'stale-pid'
  /** The record's host_key is not this machine's — never signal another host's conductor. */
  | 'host-mismatch'
  /** This platform cannot prove what a pid is, so we refuse to guess. */
  | 'unverifiable-platform'
  /** Verified, but the OS refused the signal (permissions, race). */
  | 'signal-failed';

export type SignalOutcome =
  | { ok: true; pid: number; signal: NodeJS.Signals }
  | { ok: false; reason: SignalFailureReason; message: string };

export interface SignalVerifiedInput {
  /** The last pid the conductor reported, if any. */
  pid: number | undefined;
  /** The conductor's `host_key`, read off its related `bb_machine`. */
  hostKey: string | undefined;
  /** This machine's own host_key, to compare the record against. */
  thisHostKey: string;
  signal: NodeJS.Signals;
  probe?: ProcProbe;
}

/** The same identity proof `signalVerifiedProcess` requires, without the signal. */
export type VerifyProcessInput = Omit<SignalVerifiedInput, 'signal'>;

export type VerifyOutcome =
  | { ok: true; pid: number }
  | {
      ok: false;
      reason: Exclude<SignalFailureReason, 'signal-failed'>;
      message: string;
    };

/**
 * Substrings a live bakers-conductor foreground process's command line must all
 * contain (see `cmdStartBody`'s `fgCmd`: `bakers oven … start --foreground
 * --no-update-check`). Deliberately loose — the proof this function performs
 * is "is a bakers conductor foreground loop", not an exact argv match.
 */
const CONDUCTOR_CMDLINE_MARKERS = ['oven', 'start', '--foreground'];

function looksLikeBbConductor(cmdline: string): boolean {
  return CONDUCTOR_CMDLINE_MARKERS.every((marker) => cmdline.includes(marker));
}

/**
 * Signals a process only after proving it is a bakers conductor owned by the
 * caller, on this host.
 *
 * BB-450 D1: the proof used to be the process's working directory — herdr
 * starts a conductor with the checkout root as cwd, and that is what
 * `workspace_root` stored — but `workspace_root` and a process's cwd are two
 * different KINDS of value that only coincide over a herdr spawn; over any
 * other start (`--foreground` run by hand, systemd, a container) they diverge
 * and the comparison misreads a perfectly good conductor as a recycled pid.
 * The proof is now process identity: the pid is alive, its command line
 * identifies a bakers-conductor foreground loop, it is owned by the same OS user
 * as the caller, and the record's `host_key` names this machine.
 *
 * The alternative — trusting `last_pid` alone — is unsafe in a way that only
 * shows up rarely and badly: pids are recycled, so a stale one eventually names
 * an unrelated program, and the "stop" would kill it. Refusing to signal an
 * unverified pid costs a stopped conductor nothing (the operator sees why and
 * the lease reaper marks it offline anyway) and costs a mis-signalled process
 * everything.
 *
 * Deliberately never throws: a cockpit calls this from a keypress handler and
 * must render the reason on the row rather than unwind.
 */
function identifyProcess(input: VerifyProcessInput): VerifyOutcome {
  const { pid, hostKey, thisHostKey } = input;
  const probe = input.probe ?? defaultProcProbe();

  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    return {
      ok: false,
      reason: 'no-pid',
      message:
        'no pid on record for this conductor — it must have been started in a way that records one',
    };
  }

  if (!hostKey || hostKey !== thisHostKey) {
    return {
      ok: false,
      reason: 'host-mismatch',
      message: `conductor's host_key (${hostKey ?? '(none)'}) is not this machine's (${thisHostKey}) — refusing to signal a conductor on another host`,
    };
  }

  if (!probe.supported) {
    return {
      ok: false,
      reason: 'unverifiable-platform',
      message: `cannot verify on this platform that pid ${pid} is a bakers conductor; refusing to signal an unverified pid`,
    };
  }

  const cmdline = probe.cmdlineOf(pid);
  if (cmdline === undefined) {
    return {
      ok: false,
      reason: 'stale-pid',
      message: `pid ${pid} is not running; it is the last known pid, not a live one`,
    };
  }

  if (!looksLikeBbConductor(cmdline)) {
    return {
      ok: false,
      reason: 'stale-pid',
      message: `pid ${pid} is running something else (not a bakers conductor) — the pid was recycled by another process; not signalling it`,
    };
  }

  const uid = probe.uidOf(pid);
  const callerUid = process.getuid?.();
  if (uid === undefined || callerUid === undefined || uid !== callerUid) {
    return {
      ok: false,
      reason: 'stale-pid',
      message: `pid ${pid} does not belong to this user — the pid was recycled by another process; not signalling it`,
    };
  }

  return { ok: true, pid };
}

/**
 * Proves a recorded pid is a live bakers-conductor foreground loop owned by the
 * caller on this host — the same identity chain `signalVerifiedProcess` uses
 * (pid + `host_key` + `/proc/<pid>/cmdline` + owning uid) — **without**
 * sending it a signal. A start-time guard must observe liveness without
 * touching the process it observes.
 */
export function verifyConductorProcess(
  input: VerifyProcessInput,
): VerifyOutcome {
  return identifyProcess(input);
}

export function signalVerifiedProcess(
  input: SignalVerifiedInput,
): SignalOutcome {
  const identified = identifyProcess(input);
  if (!identified.ok) return identified;

  const probe = input.probe ?? defaultProcProbe();
  try {
    probe.send(identified.pid, input.signal);
  } catch (err) {
    return {
      ok: false,
      reason: 'signal-failed',
      message: `verified pid ${identified.pid} but could not deliver ${input.signal}: ${String(err)}`,
    };
  }
  return { ok: true, pid: identified.pid, signal: input.signal };
}

/**
 * The real probe: `/proc/<pid>/cmdline` and the owning uid of `/proc/<pid>`
 * itself on Linux.
 *
 * Only Linux is claimed as supported. macOS could shell out to `ps`, but a
 * wrong answer here signals the wrong process, so an unimplemented platform
 * reports `supported: false` and stop degrades with a message rather than
 * guessing. Start is unaffected everywhere.
 */
export function defaultProcProbe(): ProcProbe {
  const supported = process.platform === 'linux';
  return {
    supported,
    cmdlineOf(pid: number): string | undefined {
      if (!supported) return undefined;
      try {
        return readFileSync(`/proc/${pid}/cmdline`, 'utf8')
          .split('\0')
          .filter((part) => part.length > 0)
          .join(' ');
      } catch {
        // ESRCH (gone) and EACCES (another user's process) are both "cannot
        // prove it is ours", which is the same answer for our purposes.
        return undefined;
      }
    },
    uidOf(pid: number): number | undefined {
      if (!supported) return undefined;
      try {
        // The /proc/<pid> directory itself is owned by the process's real uid.
        return statSync(`/proc/${pid}`).uid;
      } catch {
        return undefined;
      }
    },
    send(pid: number, signal: NodeJS.Signals): void {
      process.kill(pid, signal);
    },
  };
}

/** What `killRunProcesses` needs from the platform, injected for tests. */
export interface RunProcessProbe {
  readonly supported: boolean;
  /** Every running pid. */
  pids(): number[];
  /** A process's environment entries, or `undefined` when gone or unreadable. */
  environOf(pid: number): string[] | undefined;
  uidOf(pid: number): number | undefined;
  send(pid: number, signal: NodeJS.Signals): void;
}

export function defaultRunProcessProbe(): RunProcessProbe {
  const base = defaultProcProbe();
  return {
    supported: base.supported,
    pids() {
      if (!base.supported) return [];
      return readdirSync('/proc')
        .filter((name) => /^\d+$/.test(name))
        .map(Number);
    },
    environOf(pid) {
      try {
        return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      } catch {
        return undefined;
      }
    },
    uidOf: (pid) => base.uidOf(pid),
    send: (pid, signal) => base.send(pid, signal),
  };
}

/**
 * Ends every process of this OS user that carries `BB_RUN_UUID=<runUuid>`:
 * the run's agent, its sandbox and background commands that outlive the
 * PTY. SIGTERM first, SIGKILL for survivors after `graceMs`. Best-effort.
 * shortcut: a process that clears its environment is not found; track
 * process groups or cgroups if that ever matters.
 */
export async function killRunProcesses(
  runUuid: string,
  probe: RunProcessProbe = defaultRunProcessProbe(),
  graceMs = 2000,
): Promise<{ supported: boolean; pids: number[] }> {
  if (!probe.supported || runUuid === '') {
    return { supported: probe.supported, pids: [] };
  }
  const marker = `BB_RUN_UUID=${runUuid}`;
  const uid = process.getuid?.();
  const ofRun = (pid: number) =>
    probe.environOf(pid)?.includes(marker) === true;
  const pids = probe
    .pids()
    .filter(
      (pid) => pid !== process.pid && probe.uidOf(pid) === uid && ofRun(pid),
    );
  const signal = (signal: NodeJS.Signals) => (pid: number) => {
    try {
      probe.send(pid, signal);
    } catch {
      // Gone already.
    }
  };
  if (pids.length === 0) return { supported: true, pids };
  pids.forEach(signal('SIGTERM'));
  if (graceMs > 0) await new Promise((r) => setTimeout(r, graceMs));
  pids.filter(ofRun).forEach(signal('SIGKILL'));
  return { supported: true, pids };
}
