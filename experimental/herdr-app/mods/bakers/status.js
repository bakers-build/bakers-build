import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { store } from "./store.js";
import { statusLine } from "./derive.js";
import { openList } from "./open.js";
import { mark, statusColor } from "./ui.js";

// The one bakers item beside Herdr's status bar: project, Needs me count, how fresh. A click shows the Tickets tab.
export class Status {
  init(_p, cx) {
    // Keeps "updated 1m ago" current without asking bakers.
    cx.timer.every(30000, (cx) => cx.notify());
  }

  render() {
    const t = theme(), needs = Number(shared("bakers.needs") || 0);
    const line = statusLine({ project: store.projectName, needs, updated: store.updated, error: store.error }, Date.now());
    return h_flex().id("bakers-status").size_full().px(14).gap(12).items_center().justify_end().bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(11.8).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => openList("needs-me"))
      .child(mark().size(13).text_size(9))
      .child(div().child(line.project ?? "bakers"))
      .when(Boolean(line.project), (e) => e.child(div().text_color(needs ? statusColor("blocked", t) : t.muted).when(needs > 0, (e) => e.font_semibold()).child(line.needs)))
      .child(div().text_color(store.error ? t.ansi1 : t.dim).child(line.fresh));
  }
}
