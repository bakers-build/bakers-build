import { spaces, panes, terminals, shared, run } from "herdr";
import { activeRun, focusedTicket, runTerminal } from "./derive.js";
import { machineOf, showAgentPlan } from "./remote.js";
import { store, ticketOf } from "./store.js";
import { dialog, popup, showTerminal } from "./open.js";

// The ticket the person is on: the active ticket tab's, the list's selected row, or a run terminal's.
export const focused = () => focusedTicket(spaces().find((s) => s.active), panes(), terminals(), shared("bakers.selected") ?? null);

export const newTicket = () => dialog("new", { parent: focused() }, 560);
export const goToTicket = () => popup("goto", {}, 480);
export const toggleSidebar = () => run("layout.toggle", { id: "sidebar" });
export const confirm = (action, ticket, extra) => dialog("confirm", { action, ticket, ...extra });

const runOf = (identifier) => activeRun(store.details[identifier]?.runs) ?? store.runs[identifier] ?? null;

// Show agent: the run's terminal beside the ticket; your machine Herdr does not know yet is added first.
export function showAgent(identifier) {
  const conductor = store.conductors.find((c) => c.uuid === runOf(identifier)?.conductor);
  const plan = showAgentPlan({
    terminal: runTerminal(terminals(), identifier), machine: machineOf(conductor, store.machines, store.local),
    machines: store.machines, herdrMachines: store.herdrMachines,
  });
  if (plan.action === "show") showTerminal(plan.terminal);
  if (plan.action === "add") confirm("add-machine", identifier, { conductor: conductor.uuid });
  return plan;
}

// The actions of the Agent and conductor section, the same from the panel, the tab's line and the keys R and G.
export const AGENT_ACTIONS = {
  "run-on": (identifier) => popup("picker", { ticket: identifier }, 560),
  "move-to": (identifier) => popup("picker", { ticket: identifier }, 560),
  "stop-dispatch": (identifier) => confirm("stop", identifier, { conductor: ticketOf(identifier)?.conductor }),
  "cancel-run": (identifier) => confirm("cancel", identifier),
  "show-agent": (identifier) => showAgent(identifier),
};
