import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { theme, shared, setShared, spaces, panes, run, nextCommand, settings } from "herdr";
import { store, refresh, agentOf } from "./store.js";
import { listTab, ticketRows, ticketTab, viewLabel } from "./derive.js";
import { openTicket, popup } from "./open.js";
import { newTicket } from "./actions.js";
import { agentDot, button, chevron, hint, label, mono, statusColor, tint } from "./ui.js";

// Column widths: Title takes what the others leave; Why and Agent shrink with a narrow tab.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const columns = (width) => [["Ticket", 92], ["Title", 0], ["Why", clamp(width * 0.16, 96, 200)], ["Agent", clamp(width * 0.24, 130, 280)], ["Age", 40]];
const EMPTY = {
  "needs-me": "Nothing else needs you. Switch the view for Mine or Open by state.",
  mine: "Mine needs the API: no tool says who a ticket is assigned to.",
  closed: "Recently closed needs the API: no tool says when a ticket was closed.",
};

// The Tickets tab: the rows of the chosen view. The Ticket panel, when shown, follows the selected row.
export class List {
  init(_p, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.filter = InputState.new({ placeholder: "Filter, / focuses" });
    this.filter.on("change", (_e, cx) => { this.at = 0; cx.notify(); });
    this.filter.on("submit", (_e, cx) => { this.handle.focus(); cx.notify(); });
    this.filter.on("focus", () => { this.typing = true; });
    this.filter.on("blur", () => { this.typing = false; });
    this.handle.focus();
    if (!store.updated) refresh(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  rows() {
    const agents = Object.fromEntries(store.tickets.map((t) => [t.identifier, agentOf(t.identifier, Date.now())]).filter(([, a]) => a)
      .map(([id, a]) => [id, { status: a.kind === "run" ? a.status : null, text: a.cell, kind: a.kind }]));
    const view = shared("bakers.view") ?? "needs-me";
    return ticketRows(store.tickets, { reasons: store.reasons, events: store.events, agents }, view, this.filter.value(), Boolean(shared("bakers.closed")), Date.now());
  }

  select(rows, at) {
    this.at = Math.max(0, Math.min(at, rows.length - 1));
    if (rows[this.at]) setShared("bakers.selected", rows[this.at].identifier);
    this.scroll.scroll_to_item(this.at);
  }

  onKey(e, rows, cx) {
    const row = rows[this.at];
    const keys = {
      down: () => this.select(rows, this.at + 1),
      up: () => this.select(rows, this.at - 1),
      enter: () => row && openTicket(row, false),
      "cmd-enter": () => row && openTicket(row, true),
      n: () => newTicket(),
      r: () => refresh(cx, true),
      "/": () => this.filter.focus(),
      escape: () => { this.filter.set_value(""); this.handle.focus(); },
    };
    const action = keys[e.keystroke];
    // While the filter has the keyboard, letters type; arrows, Enter and Esc still drive the list.
    if (!action || (this.typing && e.keystroke.length === 1)) return;
    action();
    cx.stop_propagation();
    cx.notify();
  }

  header(t) {
    const view = shared("bakers.view") ?? "needs-me";
    return h_flex().h(52).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(h_flex().id("bakers-view-menu").h(30).px(10).gap(6).items_center().rounded(6).border_1().border_color(t.input)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => popup("menu", { menu: "view" }, 240))
        .child(div().font_semibold().child(viewLabel(view))).child(chevron(t)))
      .child(div().w(260).h(30).px(10).flex().items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.filter).h_full().text_size(12.5).text_color(t.foreground)))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(store.error ? t.ansi1 : t.dim).child(store.error ?? (store.loading ? "Loading…" : "")))
      .child(button("bakers-list-menu", "...", t, () => popup("menu", { menu: "list" }, 240)))
      .child(button("bakers-new", "New ticket", t, () => newTicket(), "primary"));
  }

  row(r, i, selected, t, cols) {
    const open = Boolean(ticketTab(spaces().find((s) => s.active), panes(), r.identifier));
    const needs = Boolean(store.reasons[r.identifier]);
    const cell = (width, child) => div().when(width > 0, (e) => e.w(width).flex_none()).when(!width, (e) => e.flex_1()).min_w(0).child(child);
    return h_flex().id(`bakers-row-${r.identifier}`).h(44).px(14).gap(12).items_center().border_1().cursor_pointer()
      .border_color(selected ? t.accent : t.background).bg(selected ? tint(t.accent, "14") : t.background).hover((s) => s.bg(t.hover))
      .on_click((e, cx) => {
        this.select(this.rows(), i);
        openTicket(r, e.click_count === 2);
        cx.notify();
      })
      .child(cell(cols[0][1], div().font_family(mono()).text_size(12).child(r.identifier)))
      .child(cell(0, h_flex().gap(6).items_center().min_w(0).child(div().min_w(0).truncate().child(r.title))
        .when(open, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child("open in a tab")))))
      .child(cell(cols[2][1], div().truncate().text_color(needs ? statusColor("blocked", t) : t.muted).when(needs, (e) => e.font_semibold()).child(r.why)))
      .child(cell(cols[3][1], h_flex().gap(6).items_center().min_w(0).child(agentDot(r.agent, t))
        .child(div().min_w(0).truncate().text_size(12).text_color(r.agent.status ? statusColor(r.agent.status, t) : t.muted).child(r.agent.text))))
      .child(cell(cols[4][1], div().text_size(12).text_color(t.dim).child(r.age ?? "")));
  }

  projectPicker(t) {
    return v_flex().id("bakers-projects").p(16).gap(6).max_w(420)
      .child(div().px(10).font_semibold().child("Choose a bakers project"))
      .when(!store.projects.length, (e) => e.child(div().px(10).text_size(12).text_color(store.error ? t.ansi1 : t.dim).child(store.error ?? "Loading…")))
      .children(store.projects.map((p) => h_flex().id(`bakers-project-${p.uuid}`).h(32).px(10).gap(8).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click(() => setShared("bakers.project", p.uuid))
        .child(div().child(p.name)).child(div().text_size(12).text_color(t.dim).child(p.key))));
  }

  render(cx) {
    const t = theme(), view = shared("bakers.view") ?? "needs-me";
    const space = spaces().find((s) => s.active), tab = listTab(space, panes());
    // The Tickets tab is always tab 1 of its space.
    if (tab?.active && tab.index > 1) run("tab.move", { id: tab.id, index: 1 });
    const root = v_flex().id("bakers-list").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.width = size.width / settings().zoom; cx.notify(); });
    const cols = columns(this.width ?? 1100);
    if (!store.project && (store.updated || !shared("bakers.project"))) return root.child(this.projectPicker(t));
    const rows = this.rows(), selected = Math.min(this.at, rows.length - 1);
    if (tab?.active && rows[selected] && shared("bakers.selected") !== rows[selected].identifier) setShared("bakers.selected", rows[selected].identifier);
    const empty = store.error ?? (store.loading && !store.updated ? "Loading…" : EMPTY[view] ?? "No tickets in this view.");
    return root.on_key_down((e, cx) => this.onKey(e, rows, cx))
      .child(this.header(t))
      .child(h_flex().h(30).flex_none().px(15).gap(12).items_center().border_b(1).border_color(t.border)
        .children(cols.map(([name, width]) => div().when(width > 0, (e) => e.w(width).flex_none()).when(!width, (e) => e.flex_1())
          .child(label(view === "needs-me" || name !== "Why" ? name : "State", t)))))
      .child(v_flex().id("bakers-rows").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.map((r, i) => this.row(r, i, i === selected, t, cols)))
        .child(v_flex().px(14).py(12).gap(6)
          .child(div().text_size(13).text_color(store.error ? t.ansi1 : t.muted).child(view === "needs-me" && rows.length ? EMPTY[view] : rows.length ? "" : empty))
          .child(hint("Enter opens the preview tab, cmd-Enter a pinned tab, N a new ticket, / the filter, R refreshes. Up and down move the selection; the Ticket panel, when shown, follows it.", t))));
  }
}
