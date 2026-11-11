// Where a ticket runs or would run: its run, conductor and machine, and every action on that (R3-1 to R3-3).
import { ago, conductorLabel, statusLabel, toUnix } from "./derive.js";

const AGENTS = { claude: "Claude Code", codex: "Codex" };
const NOT_YOURS = "Not available: only the machine's owner can connect to it.";
const OUTSIDE = "Its terminal runs outside Herdr.";
const RUN_ON = { id: "run-on", label: "Run on..." };
const MOVE = { id: "move-to", label: "Move to..." };
const CANCEL = { id: "cancel-run", label: "Cancel run..." };
const STOP = { id: "stop-dispatch", label: "Stop dispatch..." };

export const agentName = (terminal, run) => terminal?.name ?? AGENTS[run?.agent] ?? run?.agent ?? "Agent";

// A conductor's machine. `mine` is null when bakers cannot list machines yet; only your own have load and URL.
export function machineOf(conductor, machines, local) {
  const id = conductor?.machine;
  if (!id) return null;
  const own = (machines ?? []).find((m) => m.machine_id === id);
  return {
    id, label: own?.label ?? id, mine: own ? true : machines ? false : null, here: id === local, url: own?.connection_url ?? null,
    load: own ? `${own.current_load} of ${own.max_parallel} busy` : null, full: Boolean(own) && own.current_load >= own.max_parallel,
  };
}

const machineName = (m) => m && (m.here ? "this computer" : m.mine === false ? "a teammate's machine" : m.label);
const where = (label, m) => [...new Set([label, machineName(m)])].filter(Boolean).join(", ");

export function sshTarget(url) {
  const target = String(url ?? "").trim().replace(/^ssh:\/\//, "").replace(/^ssh\s+/, "").replace(/\/$/, "");
  return /^[\w.-]+(@[\w.-]+)?(:\d+)?$/.test(target) && !target.startsWith("-") ? target : null;
}

export function showAgentPlan({ terminal, machine, machines, herdrMachines }) {
  if (terminal) return { action: "show", terminal: terminal.address };
  if (machines === null) return { disabled: "Needs API: bakers does not list machines yet." };
  if (machine?.mine === false) return { disabled: NOT_YOURS };
  if (!machine || machine.here || (herdrMachines ?? []).includes(machine.id)) return { disabled: OUTSIDE };
  if (!sshTarget(machine.url)) return { disabled: `bakers has no connection URL for ${machine.label}.` };
  return { action: "add", machine };
}

function running({ run, terminal, conductor, machine, machines, herdrMachines, nowMs }) {
  const status = terminal?.status ?? (run.state === "claimed" ? "starting" : "working");
  const since = run.started_at ? ago(toUnix(run.started_at), nowMs) : "now";
  const when = status !== "starting" ? since : `claimed ${since === "now" ? "just now" : `${since} ago`}`;
  const label = conductor ? conductorLabel(conductor) : "a conductor";
  const title = `${agentName(terminal, run)} ${statusLabel(status)}`;
  const show = showAgentPlan({ terminal, machine, machines, herdrMachines });
  return {
    kind: "run", status, title, detail: `on ${[where(label, machine), machine?.load, when].filter(Boolean).join(", ")}`,
    line: `${title} on ${label}, ${when}`, cell: `${title}, ${label}`, chip: null,
    note: show.action === "add" ? `${machine.label} is not in Herdr yet: Show agent asks to add it first.` : null,
    actions: [{ id: "show-agent", label: "Show agent", ...(show.disabled ? { disabled: show.disabled } : {}) }, MOVE, CANCEL],
  };
}

// Why a ticket with a conductor has no run yet; full is derived (no queue field), so it says so.
function waiting({ ticket, conductor, machine }) {
  const title = `Waiting for ${conductor ? conductorLabel(conductor) : "a conductor"}`;
  const reasons = [
    { when: !conductor, detail: "its conductor is not in this project's list" },
    { when: ticket.frozen, detail: "frozen; no conductor picks it up until it is unfrozen" },
    { when: conductor?.status !== "online", detail: "offline; the run starts when it is back" },
    { when: machine?.full, detail: `${machine?.load}; starts when a slot frees`, chip: "derived, no queue field" },
    { when: true, detail: `${["online", machine?.load].filter(Boolean).join(", ")}; the run starts when it claims ${ticket.identifier}` },
  ];
  const { detail, chip = null } = reasons.find((r) => r.when);
  return { kind: "waiting", status: null, title, detail, line: title, cell: title, chip, note: null, actions: [MOVE, STOP] };
}

export function agentSection({ ticket, run, terminal, conductors, machines, local, herdrMachines, nowMs, moveFailed }) {
  const conductor = (conductors ?? []).find((c) => c.uuid === (run?.conductor ?? ticket?.conductor));
  const machine = machineOf(conductor, machines, local);
  if (run) return running({ run, terminal, conductor, machine, machines, herdrMachines, nowMs });
  if (ticket?.conductor && !moveFailed) return waiting({ ticket, conductor, machine });
  // A ticket from ticket_list has no conductor field: say only what is known.
  const idle = [
    { when: moveFailed, title: `Run cancelled, not started on ${moveFailed}`, detail: "" },
    { when: ticket && !("conductor" in ticket), title: "No active run", detail: "" },
    { when: true, title: "No active run", detail: "no conductor, nothing starts until one is set", line: "No active run, no conductor" },
  ].find((s) => s.when);
  const line = idle.line ?? idle.title;
  return { kind: "idle", status: null, title: idle.title, detail: idle.detail, line, cell: line, chip: null, note: null, actions: [RUN_ON] };
}

export function pickerRows(conductors, machines, local, filter) {
  const needle = String(filter ?? "").trim().toLowerCase();
  return (conductors ?? []).filter((c) => c.active).map((c) => {
    const m = machineOf(c, machines, local), online = c.status === "online";
    const load = online && m ? m.load ?? (m.mine === false ? "not yours, no load" : "-") : "-";
    return { uuid: c.uuid, label: conductorLabel(c), machine: m && (m.here ? "this computer" : m.label), online, status: online ? "online" : "offline", load };
  }).filter((r) => `${r.label} ${r.machine ?? ""}`.toLowerCase().includes(needle));
}
