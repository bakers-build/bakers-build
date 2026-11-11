import { spaces, panes, terminals, shared, run } from "herdr";
import { focusedTicket } from "./derive.js";
import { dialog, popup } from "./open.js";

// The ticket the person is on: the active ticket tab's, the list's selected row, or a run terminal's.
export const focused = () => focusedTicket(spaces().find((s) => s.active), panes(), terminals(), shared("bakers.selected") ?? null);

export const newTicket = () => dialog("new", { parent: focused() }, 560);
export const goToTicket = () => popup("goto", {}, 480);
export const toggleSidebar = () => run("layout.toggle", { id: "sidebar" });
