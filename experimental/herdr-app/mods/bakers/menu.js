import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, shared, setShared, spaces, panes, run } from "herdr";
import { store, refresh } from "./store.js";
import { sidebarViews, ticketTabsToClose } from "./derive.js";
import { openList } from "./open.js";
import { goToTicket, newTicket, toggleSidebar } from "./actions.js";
import { chip, menuRow } from "./ui.js";

const closeTabs = (finishedOnly) => ticketTabsToClose(spaces().find((s) => s.active), panes(), finishedOnly)
  .forEach((id) => run("tab.close", { id, confirmed: true }));

// Each popup menu's items: label, then what it shows on the right and what it does.
const MENUS = {
  rail: () => [
    { label: "New ticket...", hint: "cmd-shift-N", run: newTicket },
    { label: "Go to ticket...", hint: "cmd-shift-O", run: goToTicket },
    { label: "Tickets sidebar", hint: "cmd-B", run: toggleSidebar },
  ],
  project: () => store.projects.map((p) => ({ label: p.name, hint: p.key, current: p.uuid === store.project, run: () => setShared("bakers.project", p.uuid) })),
  view: () => sidebarViews(store.tickets, Object.keys(store.reasons)).map((v) => ({
    label: v.label, indent: v.indent, hint: v.count === undefined ? "" : String(v.count), chip: v.api && "API", disabled: v.api,
    current: v.id === (shared("bakers.view") ?? "needs-me"), run: () => openList(v.id),
  })),
  list: (_p, cx) => [
    { label: "Refresh", hint: "R", run: () => refresh(cx, true) },
    { label: "Show closed tickets", current: Boolean(shared("bakers.closed")), run: () => setShared("bakers.closed", !shared("bakers.closed")) },
    { separator: true },
    { label: "Close finished ticket tabs", run: () => closeTabs(true) },
    { label: "Close all ticket tabs", run: () => closeTabs(false) },
  ],
};

export const menuItems = MENUS;

export class Menu {
  init(p, cx) {
    this.p = p;
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  items(cx) {
    return (MENUS[this.p.menu]?.(this.p, cx) ?? []);
  }

  choose(item, cx) {
    closeOverlay(this.p.overlay);
    item?.run?.(cx);
  }

  render(cx) {
    const t = theme(), items = this.items(cx), pickable = items.filter((i) => !i.separator && !i.disabled);
    const selected = pickable[Math.min(this.at, pickable.length - 1)];
    return v_flex().id("bakers-menu").track_focus(this.handle).w_full().p(5).gap(1).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(this.p.overlay);
        else if (e.key === "down") this.at = (this.at + 1) % pickable.length;
        else if (e.key === "up") this.at = (this.at + pickable.length - 1) % pickable.length;
        else if (e.key === "enter") this.choose(selected, cx);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(items.map((item, i) => (item.separator
        ? div().h(1).my(4).mx(4).bg(t.border)
        : menuRow(`bakers-menu-${i}`, t, item === selected, (cx) => !item.disabled && this.choose(item, cx))
          .when(Boolean(item.indent), (e) => e.pl(22))
          .child(div().flex_1().min_w(0).truncate().text_color(item.disabled ? t.dim : item.muted ? t.muted : t.foreground)
            .when(Boolean(item.current), (e) => e.font_semibold()).child(item.label))
          .when(Boolean(item.chip), (e) => e.child(chip(item.chip, t)))
          .when(Boolean(item.current) && !item.hint, (e) => e.child(div().text_size(12).text_color(t.muted).child("current")))
          .when(Boolean(item.hint), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(item.hint))))))
      .when(Boolean(this.p.note), (e) => e.child(div().h(1).my(4).mx(4).bg(t.border)).child(div().px(8).pb(4).text_size(11.5).text_color(t.dim).child(this.p.note)));
  }
}
