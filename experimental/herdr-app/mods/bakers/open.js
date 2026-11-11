import { run, terminals, panes, spaces, exec, setShared } from "herdr";
import { boardSteps, openPlan, safeUrl } from "./derive.js";

export function openBoard() {
  boardSteps(spaces().find((s) => s.active), panes()).forEach(([command, args]) => run(command, args));
}

export function openLink(url) {
  const safe = safeUrl(url);
  if (safe) exec("open", ["--", safe]).catch(() => {});
}

// The ticket shows in the right panel; its run's terminal on this machine comes to the front beside it.
// Adopting that terminal is for good: closing its pane ends the run.
export function openTicket(identifier) {
  const plan = openPlan(identifier, terminals(), panes());
  setShared("bakers.ticket", identifier);
  if (plan.action === "select") run("tab.select", { id: plan.tab });
  if (plan.action === "adopt") run("terminal.keep", { terminal: plan.terminal, place: "tab" });
  run("layout.select", { stack: "panel-body", child: "ticket" });
  run("layout.show", { id: "panel" });
}
