import { run, panes, spaces, shared, setShared, exec, openOverlay, layout } from "herdr";
import { findNode, listSteps, openSteps, safeUrl, tabName } from "./derive.js";

const activeSpace = () => spaces().find((s) => s.active);
const steps = (list) => list.forEach(([command, args]) => run(command, args));

export function openList(view) {
  if (view) setShared("bakers.view", view);
  steps(listSteps(activeSpace(), panes()));
}

// Enter opens the preview tab, a pinned tab otherwise; an open ticket only gets selected.
export function openTicket(ticket, pinned) {
  const preview = shared("bakers.preview") ?? null;
  const result = openSteps(activeSpace(), panes(), ticket.identifier, tabName(ticket), preview, pinned);
  if (result.preview !== preview) setShared("bakers.preview", result.preview);
  steps(result.steps);
}

export const pinPreview = () => setShared("bakers.preview", null);

export function showPanel() {
  run("layout.select", { stack: "panel-body", child: "ticket" });
  run("layout.show", { id: "panel" });
}

export function togglePanel() {
  const tree = layout(), shown = !findNode(tree, "panel")?.hidden && findNode(tree, "panel-body")?.active === "ticket";
  if (shown) run("layout.hide", { id: "panel" });
  else showPanel();
}

// A run's terminal: its pane if it has one, else a pane right of the focused one (for good: closing it ends the run).
export function showTerminal(address) {
  const pane = panes().find((p) => p.terminal === address);
  if (pane) run("pane.focus", { terminal: address });
  else run("terminal.keep", { terminal: address, place: "right" });
}

export const dialog = (view, props, width = 480) => openOverlay({ mod: "bakers", kind: "dialog", width, props: { view, ...props } });
export const popup = (view, props, width = 260) => openOverlay({ mod: "bakers", kind: "popup", width, props: { view, ...props } });

export function openLink(url) {
  const safe = safeUrl(url);
  if (safe) exec("open", ["--", safe]).catch(() => {});
}
