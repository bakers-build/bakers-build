// Pure logic for the board and the ticket: no gpui and no herdr imports, so node:test can run it.

export const STATE_ORDER = ["qualification", "plan", "working", "review"];

const NEEDS_YOU = { question: "Question", "technical problem": "Technical problem" };
const ACTIVE_RUN = new Set(["claimed", "running"]);

export function stateLabel(state) {
  const words = String(state).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// hc reports labels as an object; accept a "key=value" list too.
export function terminalLabel(terminal, key) {
  const labels = terminal?.labels;
  if (Array.isArray(labels)) {
    const hit = labels.find((l) => String(l).startsWith(`${key}=`));
    return hit ? String(hit).slice(key.length + 1) : null;
  }
  return labels?.[key] ?? null;
}

export function runTerminal(terminals, identifier) {
  const hit = (terminals ?? []).find((t) => (t.state ?? "live") === "live" && terminalLabel(t, "bakers.ticket") === identifier);
  return hit ? { address: hit.address, run: terminalLabel(hit, "bakers.run"), status: hit.status, name: hit.program?.name } : null;
}

export function needsYou(ticket) {
  if (!ticket?.frozen) return null;
  for (const label of ticket.labels ?? []) {
    const hit = NEEDS_YOU[String(label).toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

export function ago(unixSeconds, nowMs) {
  const minutes = Math.floor(Math.max(0, nowMs / 1000 - unixSeconds) / 60);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

export const toUnix = (value) => (typeof value === "number" ? value : Date.parse(value) / 1000);

export function boardColumns(tickets, events, terminals, filter, nowMs, runs) {
  const newest = new Map();
  for (const e of events ?? []) {
    if (!newest.has(e.ticket) || e.created > newest.get(e.ticket).created) newest.set(e.ticket, e);
  }
  const needle = String(filter ?? "").trim().toLowerCase();
  const columns = new Map([["needs-you", { id: "needs-you", label: "Needs you", cards: [] }]]);
  for (const state of STATE_ORDER) columns.set(state, { id: state, label: stateLabel(state), cards: [] });
  for (const t of tickets ?? []) {
    if (t.closed) continue;
    if (needle && !`${t.identifier} ${t.title}`.toLowerCase().includes(needle)) continue;
    const asks = needsYou(t), event = newest.get(t.identifier);
    const when = event?.created ?? (t.frozen_at ? toUnix(t.frozen_at) : null);
    const card = {
      id: t.id, identifier: t.identifier, title: t.title,
      reason: asks ?? (t.frozen ? "Frozen" : event?.message ?? null),
      age: when == null || Number.isNaN(when) ? null : ago(when, nowMs),
      agent: agentOf(runTerminal(terminals, t.identifier), runs?.[t.identifier] ?? null, [], nowMs),
    };
    const id = asks ? "needs-you" : t.state;
    if (!columns.has(id)) columns.set(id, { id, label: stateLabel(id), cards: [] });
    columns.get(id).cards.push(card);
  }
  return [...columns.values()].filter((c) => c.cards.length);
}

export const needsYouCount = (tickets) => (tickets ?? []).filter((t) => !t.closed && needsYou(t)).length;

// The board is the active space's tab named "Tickets" that shows the bakers mod.
// The commands that show the board: its tab if open, else a new one, in a new space when none is open.
export function boardSteps(space, panes) {
  const tab = (space?.tabs ?? []).find((t) => t.name === "Tickets" && (panes ?? []).some((p) => p.tab === t.id && p.mod === "bakers"));
  const newTab = ["tab.new", { name: "Tickets", mod: "bakers", props: { view: "board" } }];
  if (tab) return [["tab.select", { id: tab.id }]];
  return space ? [newTab] : [["space.new", {}], newTab];
}

export function activeRun(runs) {
  return (runs ?? []).find((r) => ACTIVE_RUN.has(r.state) && !r.closed) ?? null;
}

export function newestComment(comments, type) {
  return (comments ?? []).filter((c) => c.type === type).reduce((a, c) => (!a || c.created > a.created ? c : a), null);
}

export function attention(ticket, comments, nowMs) {
  const list = comments ?? [];
  const latest = list.reduce((a, c) => (!a || c.created > a.created ? c : a), null);
  const asks = needsYou(ticket);
  if (asks) return { kind: "question", title: asks, body: (latest?.body ?? "").trim().split("\n")[0] };
  if (latest) return { kind: "newest", title: `Newest: ${latest.type}, ${ago(toUnix(latest.created), nowMs)}`, body: "" };
  return { kind: "none", title: "", body: "" };
}

export function openPlan(identifier, terminals, panes) {
  const run = runTerminal(terminals, identifier);
  if (!run) return { action: "tab" };
  const pane = (panes ?? []).find((p) => p.terminal === run.address);
  return pane ? { action: "select", tab: pane.tab } : { action: "adopt", terminal: run.address, run: run.run };
}

// Links come from tickets and comments anyone may edit: only https reaches the system's opener.
export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

// ticket_list wants the project's UUID; props may give its key.
export function resolveProject(projects, value) {
  const hit = (projects ?? []).find((p) => p.uuid === value || p.key === value);
  return hit ? { uuid: hit.uuid, name: hit.name } : null;
}

export const conductorLabel = (conductor) => conductor.label ?? conductor.conductor_id;

export function machineOf(run, conductors, local) {
  if (local) return "This computer";
  const conductor = (conductors ?? []).find((c) => c.uuid === run?.conductor);
  return conductor ? conductorLabel(conductor) : null;
}

// Who works on the ticket: its terminal in Herdr with the live status, else its active run in bakers.
// Terminals on this computer have bare ids (t3); others carry their machine's name.
export function agentOf(terminal, run, conductors, nowMs) {
  if (!terminal && !run) return null;
  return {
    name: terminal?.name ?? run?.agent ?? "Agent",
    status: terminal?.status ?? (run?.state === "claimed" ? "starting" : "working"),
    where: machineOf(run, conductors, /^t\d+$/.test(terminal?.address ?? "")),
    since: run?.started_at ? ago(toUnix(run.started_at), nowMs) : null,
  };
}

export const statusLabel = (status) => (status === "blocked" ? "needs you" : status);

// Claude Code's own colors: claude while working, permission when it needs you, inactive when idle, success when done.
const CLAUDE_COLORS = {
  dark: { working: "#d77757", blocked: "#b1b9f9", idle: "#999999", done: "#4eba65" },
  light: { working: "#d77757", blocked: "#5769f7", idle: "#666666", done: "#2c7a39" },
};

export function claudeColor(status, background) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
  return CLAUDE_COLORS[r + g + b < 384 ? "dark" : "light"][status] ?? null;
}

// What the confirm dialog says and does for each action on a ticket.
export const CONFIRM = {
  cancel: {
    title: (id) => `Cancel the running run on ${id}?`,
    body: (id, state) => `The agent stops in the run's terminal. Its work stays in the worktree and ${id} stays in ${state}, so it can run again.`,
    yes: "Cancel run", busy: "Cancelling…", no: "Keep running", reason: true,
    run: (client, ticket, reason) => client.cancelRun(ticket, reason),
  },
  freeze: {
    title: (id) => `Freeze ${id}?`,
    body: () => "No conductor picks it up while it is frozen.",
    yes: "Freeze", busy: "Freezing…", no: "Keep",
    run: (client, ticket) => client.setFrozen(ticket, true),
  },
  unfreeze: {
    title: (id) => `Unfreeze ${id}?`,
    body: () => "Conductors can pick it up again.",
    yes: "Unfreeze", busy: "Unfreezing…", no: "Keep frozen",
    run: (client, ticket) => client.setFrozen(ticket, false),
  },
};

export function friendlyError(output) {
  let text = String(output ?? "");
  try {
    text = JSON.parse(text)?.error?.message ?? text;
  } catch {
    // Not a bakers error object: read the text as it is.
  }
  if (/ENOENT|command not found/i.test(text)) return "bakers is not installed or not on PATH";
  if (/\b401\b|log ?in/i.test(text)) return "Run bakers login first";
  return text.split("\n").map((l) => l.trim()).find(Boolean) ?? "bakers failed";
}
