import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, closeOverlay, shared, setShared, spaces, panes, run, notify } from "herdr";
import { store, client, refresh, changed, ticketOf } from "./store.js";
import { activeRun, isClosed, sidebarViews, ticketTabsToClose } from "./derive.js";
import { RECIPES, TYPES, WRITES, stateMenu } from "./flows.js";
import { openList } from "./open.js";
import { confirm, goToTicket, newTicket, toggleSidebar } from "./actions.js";
import { chip, menuRow } from "./ui.js";

const options = (list, current) => [...new Set([...list, current].filter(Boolean))];

const closeTabs = (finishedOnly) => ticketTabsToClose(spaces().find((s) => s.active), panes(), finishedOnly)
  .forEach((id) => run("tab.close", { id, confirmed: true }));

// Each popup menu's items: label, then what it shows on the right and what it does.
const classify = (p, field, list) => options(list, ticketOf(p.ticket)?.[field]).map((value) => ({
  label: value, current: value === ticketOf(p.ticket)?.[field], done: `${p.ticket}: ${field} ${value}`,
  write: (io) => WRITES.classify(io, ticketOf(p.ticket), { [field]: value }),
}));

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
  state: (p) => stateMenu(ticketOf(p.ticket)?.state).map((s, i, all) => ({
    label: s.label, current: s.current, disabled: s.current, muted: s.earlier, start: i === all.findIndex((x) => x.current) + 1,
    run: () => confirm("state", p.ticket, { target: s.state }),
  })),
  more: (p, cx) => {
    const d = ticketOf(p.ticket), running = activeRun(store.details[p.ticket]?.runs);
    return [
      { label: d?.frozen ? "Unfreeze..." : "Freeze...", disabled: isClosed(d), run: () => confirm(d?.frozen ? "unfreeze" : "freeze", p.ticket) },
      { label: "Cancel run...", disabled: !running, run: () => confirm("cancel", p.ticket) },
      { label: "Copy identifier", run: () => cx.write_to_clipboard(p.ticket) },
      { label: "Open on web", chip: "needs API", disabled: true },
    ];
  },
  type: (p) => classify(p, "type", TYPES),
  recipe: (p) => classify(p, "recipe", RECIPES),
  list: (_p, cx) => [
    { label: "Refresh", hint: "R", run: () => refresh(cx, true) },
    { label: "Show closed tickets", checked: Boolean(shared("bakers.closed")), run: () => setShared("bakers.closed", !shared("bakers.closed")) },
    { separator: true },
    { label: "Close finished ticket tabs", run: () => closeTabs(true) },
    { label: "Close all ticket tabs", run: () => closeTabs(false) },
  ],
};

export const menuItems = MENUS;

export class Menu {
  init(p, cx) {
    this.p = p;
    this.at = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  items(cx) {
    return (MENUS[this.p.menu]?.(this.p, cx) ?? []);
  }

  // A pick that saves keeps the menu open until bakers answers, so the write is not cut off.
  choose(item, cx) {
    if (!item?.write) {
      closeOverlay(this.p.overlay);
      return item?.run?.(cx);
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await item.write({ client });
        notify({ title: item.done, level: "success" });
        changed(this.p.ticket, cx);
        closeOverlay(this.p.overlay);
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.busy = false;
      }
      cx.notify();
    });
  }

  render(cx) {
    const t = theme(), items = this.items(cx), pickable = items.filter((i) => !i.separator && !i.disabled && !this.busy);
    if (this.at === null) this.at = Math.max(0, pickable.findIndex((i) => i.start));
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
          .when(Boolean(item.checked), (e) => e.child(svg("mods/workspace-chrome/check.svg").size(13).text_color(t.foreground)))
          .when(Boolean(item.current) && !item.hint, (e) => e.child(div().text_size(12).text_color(t.muted).child("current")))
          .when(Boolean(item.hint), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(item.hint))))))
      .when(Boolean(this.error), (e) => e.child(div().px(8).py(4).text_size(11.5).text_color(t.ansi1).child(this.error)))
      .when(Boolean(this.p.note), (e) => e.child(div().h(1).my(4).mx(4).bg(t.border))
        .child(v_flex().px(8).pb(4).gap(4).child(div().text_size(11.5).text_color(t.dim).child(this.p.note)).when(Boolean(this.p.noteChip), (e) => e.child(chip(this.p.noteChip ?? "", t)))));
  }
}
