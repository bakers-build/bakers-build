// Pure logic for the board and the ticket: no gpui and no herdr imports, so node:test can run it.

export const STATE_ORDER = ["qualification", "plan", "working", "review"];

const ASKED = { question: "Asked a question", "technical problem": "Technical problem" };
const CLOSED_STATES = new Set(["done", "cancelled"]);
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

export const isClosed = (ticket) => Boolean(ticket?.closed ?? CLOSED_STATES.has(ticket?.state));

// Why a ticket needs a person: the agent asked (frozen with the label), or its plan waits for approval.
export function needsMe(ticket, planReady) {
  if (isClosed(ticket)) return null;
  const asked = ticket.frozen ? (ticket.labels ?? []).map((l) => ASKED[String(l).toLowerCase()]).find(Boolean) : null;
  return asked ?? (planReady ? "Plan ready for approval" : null);
}

export const planWaits = (ticket, run, comments) => ticket?.state === "plan" && !run && (comments ?? []).some((c) => c.type === "plan");

export function ago(unixSeconds, nowMs) {
  const minutes = Math.floor(Math.max(0, nowMs / 1000 - unixSeconds) / 60);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

export const toUnix = (value) => (typeof value === "number" ? value : Date.parse(value) / 1000);

const VIEW_LABELS = { "needs-me": "Needs me", mine: "Mine", open: "Open by state", closed: "Recently closed" };

export const viewLabel = (view) => VIEW_LABELS[view] ?? stateLabel(String(view).replace(/^state:/, ""));

const openStates = (tickets) => [...new Set([...STATE_ORDER, ...tickets.map((t) => t.state)])];

// The sidebar's saved views; Mine and Recently closed need fields the API does not have yet.
export function sidebarViews(tickets, needing) {
  const open = (tickets ?? []).filter((t) => !isClosed(t));
  return [
    { id: "needs-me", label: "Needs me", count: needing.length },
    { id: "mine", label: "Mine", api: true },
    { id: "open", label: "Open by state", count: open.length },
    ...openStates(open).map((s) => ({ id: `state:${s}`, label: stateLabel(s), count: open.filter((t) => t.state === s).length, indent: true })),
    { id: "closed", label: "Recently closed", api: true },
  ];
}

export function statusLine({ project, needs, updated, error }, nowMs) {
  const since = updated ? ago(updated / 1000, nowMs) : null;
  const fresh = error ? "bakers offline" : since && (since === "now" ? "updated just now" : `updated ${since} ago`);
  return { project, needs: `${needs} need${needs === 1 ? "s" : ""} you`, fresh: fresh ?? "" };
}

const when = (ticket, events) => {
  const at = ticket.frozen_at ? toUnix(ticket.frozen_at) : Math.max(...events.filter((e) => e.ticket === ticket.identifier).map((e) => e.created));
  return Number.isFinite(at) ? at : null;
};

// The rows of a view: identifier, title, why it needs me (or its state), the agent and how long it waits.
export function ticketRows(tickets, { reasons, events, agents }, view, filter, showClosed, nowMs) {
  const needle = String(filter ?? "").trim().toLowerCase();
  const order = openStates(tickets ?? []);
  const inView = {
    "needs-me": (t) => Boolean(reasons[t.identifier]),
    open: (t) => !isClosed(t) || showClosed,
    closed: isClosed,
  }[view] ?? ((t) => view.startsWith("state:") && (t.state === view.slice(6) || (showClosed && isClosed(t))));
  return (tickets ?? [])
    .filter((t) => inView(t) && `${t.identifier} ${t.title}`.toLowerCase().includes(needle))
    .map((t) => ({ t, at: when(t, events ?? []) }))
    .sort((a, b) => isClosed(a.t) - isClosed(b.t) || (view === "needs-me" ? 0 : order.indexOf(a.t.state) - order.indexOf(b.t.state)) || (a.at ?? Infinity) - (b.at ?? Infinity))
    .map(({ t, at }) => ({
      id: t.id, identifier: t.identifier, title: t.title, state: t.state,
      why: reasons[t.identifier] ?? stateLabel(t.state),
      agent: agents?.[t.identifier] ?? { status: null, text: "No active run" },
      age: at === null ? null : ago(at, nowMs),
    }));
}

export const tabName = (ticket) => `${ticket.identifier} ${isClosed(ticket) ? "closed" : ticket.state}`;
export const tabTicket = (name) => /^([A-Z][A-Z0-9_]*-\d+) /.exec(name ?? "")?.[1] ?? null;
const bakersPane = (panes, tab) => (panes ?? []).some((p) => p.tab === tab.id && p.mod === "bakers");
export const ticketTab = (space, panes, identifier) => (identifier && (space?.tabs ?? []).find((t) => tabTicket(t.name) === identifier && bakersPane(panes, t))) || null;
export const listTab = (space, panes) => (space?.tabs ?? []).find((t) => t.name === "Tickets" && bakersPane(panes, t)) ?? null;

// Close ticket tabs: only those that hold nothing but the ticket, since closing a run's terminal pane ends the run.
export const ticketTabsToClose = (space, panes, finishedOnly) => (space?.tabs ?? [])
  .filter((t) => tabTicket(t.name) && (!finishedOnly || t.name.endsWith(" closed")))
  .filter((t) => (panes ?? []).filter((p) => p.tab === t.id).every((p) => p.mod === "bakers"))
  .map((t) => t.id);

// The Tickets tab is tab 1 of its space: selected if open, else made (in a new space when none is open).
export function listSteps(space, panes) {
  const tab = listTab(space, panes);
  const newTab = ["tab.new", { name: "Tickets", mod: "bakers", props: { view: "list" } }];
  if (tab) return [...(tab.index > 1 ? [["tab.move", { id: tab.id, index: 1 }]] : []), ["tab.select", { id: tab.id }]];
  return space ? [newTab] : [["space.new", {}], newTab];
}

// Enter opens the preview tab (replaced by the next Enter), cmd-Enter a pinned one; an open ticket only gets selected.
// Every ticket tab carries its ticket in its props: a copy cannot learn its own tab, and props stay.
export function openSteps(space, panes, identifier, name, preview, pinned) {
  const open = ticketTab(space, panes, identifier);
  if (open) return { steps: [["tab.select", { id: open.id }]], preview: pinned && preview === identifier ? null : preview };
  const old = !pinned && ticketTab(space, panes, preview);
  const replace = old && ticketTabsToClose(space, panes, false).includes(old.id) ? [["tab.close", { id: old.id, confirmed: true }]] : [];
  const steps = [["tab.new", { name, mod: "bakers", props: { view: "ticket", ticket: identifier } }], ...replace];
  return { steps: space ? steps : [["space.new", {}], ...steps], preview: pinned ? preview : identifier };
}

// The ticket the right panel shows: the active ticket tab's, the list's selected row, or a run terminal's ticket.
export function focusedTicket(space, panes, terminals, selected) {
  const tab = space?.tabs.find((t) => t.active);
  if (!tab) return null;
  if (listTab(space, panes)?.id === tab.id) return selected ?? null;
  if (bakersPane(panes, tab) && tabTicket(tab.name)) return tabTicket(tab.name);
  const shown = new Set((panes ?? []).filter((p) => p.tab === tab.id).map((p) => p.terminal));
  return (terminals ?? []).map((t) => shown.has(t.address) && terminalLabel(t, "bakers.ticket")).find(Boolean) ?? null;
}

export function activeRun(runs) {
  return (runs ?? []).find((r) => ACTIVE_RUN.has(r.state) && !r.closed) ?? null;
}

export function newestComment(comments, type) {
  return (comments ?? []).filter((c) => !type || c.type === type).reduce((a, c) => (!a || toUnix(c.created) > toUnix(a.created) ? c : a), null);
}

export const askedComment = (comments) => newestComment(comments, "question") ?? newestComment(comments);

// "Asked a question, 35m ago", "Asked a question just now".
const since = (prefix, at, nowMs, comma = ",") => {
  const age = at ? ago(toUnix(at), nowMs) : null;
  return age === null ? prefix : age === "now" ? `${prefix} just now` : `${prefix}${comma} ${age} ago`;
};

const CARDS = {
  "Asked a question": (ticket, comments, nowMs) => ({ kind: "question", title: since("Asked a question", ticket.frozen_at, nowMs), comment: askedComment(comments) }),
  "Technical problem": (ticket, comments, nowMs) => ({ kind: "question", title: since("Reported a technical problem", ticket.frozen_at, nowMs), comment: askedComment(comments) }),
  "Plan ready for approval": (_ticket, comments, nowMs) => {
    const plan = newestComment(comments, "plan");
    return { kind: "plan", title: "Plan ready for approval", comment: plan, body: `${since("Published", plan?.created, nowMs, "")}. Read it, then approve or ask for changes.` };
  },
};

// The Needs you card at the top of a ticket tab: why, since when, and the comment it is about.
export function needsCard(ticket, reason, comments, nowMs) {
  const card = CARDS[reason]?.(ticket, comments, nowMs);
  return card ? { kind: card.kind, title: card.title, body: card.body ?? card.comment?.body?.trim() ?? "", comment: card.comment?.id ?? null } : null;
}

const FULL = new Set(["comment", "question"]);
const firstLine = (body) => String(body ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";

// The comments thread, oldest first; plan, spec and summary comments fold to their first line.
export const commentRows = (comments, me, nowMs) => [...(comments ?? [])]
  .sort((a, b) => toUnix(a.created) - toUnix(b.created))
  .map((c) => ({
    id: c.id, author: c.author === me ? "You" : c.author, type: c.type, age: ago(toUnix(c.created), nowMs),
    body: c.body, first: firstLine(c.body), folded: !FULL.has(c.type),
  }));

const TOASTS = { "Asked a question": "asks a question", "Technical problem": "reports a technical problem", "Plan ready for approval": "has a plan ready for approval" };

export const newlyNeeding = (before, reasons) => (before ? Object.entries(reasons).filter(([id]) => !before.includes(id)) : []);

export const needsToast = (identifier, reason, body) => ({
  title: `${identifier} ${TOASTS[reason]}`, body, level: "warning", action: { name: `bakers.open:${identifier}` },
});

export function findNode(node, id) {
  if (node?.id === id) return node;
  return (node?.children ?? []).map((child) => findNode(child, id)).find(Boolean) ?? null;
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

// This computer's machine_id, from the bakers machine config (read only, never written).
export const machineIdOf = (source) => /\bmachine_id\s*:\s*["']([^"']+)["']/.exec(source ?? "")?.[1] ?? null;

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
