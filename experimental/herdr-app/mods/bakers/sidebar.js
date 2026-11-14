import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { store } from "./store.js";
import { sidebarViews } from "./derive.js";
import { openList, popup } from "./open.js";
import { chevron, chip, statusColor } from "./ui.js";

// The bakers section of Herdr's sidebar: the project and the saved views. A view fills the Tickets tab.
export class Sidebar {
  init() {}

  row(view, current, t) {
    const needs = view.id === "needs-me" && view.count > 0, on = view.id === current;
    return h_flex().id(`bakers-view-${view.id}`).h(28).pl(view.indent ? 24 : 10).pr(10).gap(6).items_center().rounded(6)
      .when(on, (e) => e.bg(t.selected))
      .when(!view.api, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openList(view.id)))
      .child(div().flex_1().min_w(0).truncate().text_size(view.indent ? 12.5 : 13)
        .text_color(view.api ? t.dim : needs ? statusColor("blocked", t) : on ? t.foreground : t.muted).when(needs, (e) => e.font_semibold())
        .child(view.label))
      .when(Boolean(view.api), (e) => e.child(chip("API", t)))
      .when(view.count !== undefined, (e) => e.child(div().text_size(12).text_color(needs ? statusColor("blocked", t) : t.dim).child(String(view.count))));
  }

  render() {
    const t = theme(), current = shared("bakers.view") ?? "needs-me";
    const online = store.conductors.filter((c) => c.active && c.status === "online").length;
    const total = store.conductors.filter((c) => c.active).length;
    return v_flex().id("bakers-sidebar").size_full().min_h(0).px(10).pt(10).gap(2).bg(t.chrome).text_color(t.foreground)
      .child(h_flex().h(28).pl(10).pr(4).gap(6).items_center()
        .child(div().flex_1().text_size(13).text_color(t.muted).child("Tickets"))
        .child(h_flex().id("bakers-project").h(24).px(8).gap(4).items_center().rounded(6).border_1().border_color(t.border)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => popup("menu", { menu: "project" }, 240))
          .child(div().max_w(120).truncate().text_size(12).child(store.projectName ?? "Choose project")).child(chevron(t))))
      .child(v_flex().id("bakers-views-list").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .children(sidebarViews(store.tickets, Object.keys(store.reasons)).map((v) => this.row(v, current, t))))
      .child(h_flex().id("bakers-conductors").h(32).mb(8).px(10).gap(6).items_center().rounded(6).border_t(1).border_color(t.border)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => popup("picker", { readonly: true }, 380))
        .child(div().flex_1().text_size(13).text_color(t.muted).child("Conductors"))
        .child(div().text_size(12).text_color(t.dim).child(total ? `${online} of ${total} online` : "-")));
  }
}
