import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, closeOverlay, notify } from "herdr";
import { store, client, changed, ticketOf } from "./store.js";
import { WRITES } from "./flows.js";
import { field, menuRow } from "./ui.js";

// The label picker: the workspace's labels, the ticket's checked. A pick adds or removes at once; Esc closes.
export class Labels {
  init(p, cx) {
    this.p = p;
    this.at = 0;
    this.labels = null;
    this.filter = InputState.new({ placeholder: "Filter labels" });
    this.filter.on("change", (_e, cx) => { this.at = 0; cx.notify(); });
    this.filter.on("submit", (_e, cx) => this.toggle(this.rows()[this.at], cx));
    this.filter.focus();
    cx.spawn(async (cx) => {
      try {
        const workspaces = await client.workspaces();
        this.labels = (await Promise.all(workspaces.map((w) => client.labels(w)))).flat().map((l) => l.name);
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  rows() {
    const needle = this.filter.value().trim().toLowerCase(), on = ticketOf(this.p.ticket)?.labels ?? [];
    return [...new Set([...on, ...(this.labels ?? [])])].filter((name) => name.toLowerCase().includes(needle)).map((name) => ({ name, on: on.includes(name) }));
  }

  toggle(row, cx) {
    if (!row || this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await WRITES[row.on ? "removeLabel" : "addLabel"]({ client }, ticketOf(this.p.ticket), { name: row.name });
        notify({ title: `${this.p.ticket}: label ${row.name} ${row.on ? "removed" : "added"}`, level: "success" });
        changed(this.p.ticket, cx);
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.busy = false;
      cx.notify();
    });
  }

  render() {
    const t = theme(), rows = this.rows();
    return v_flex().id("bakers-labels").w_full().p(8).gap(6).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(this.p.overlay);
        else if (e.key === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (e.key === "up") this.at = Math.max(this.at - 1, 0);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(field(t, true).child(Input.new(this.filter).w_full().text_size(12.5)))
      .child(v_flex().id("bakers-label-rows").max_h(260).overflow_y_scrollbar().gap(1)
        .when(this.labels === null && !this.error, (e) => e.child(div().px(8).py(4).text_size(12).text_color(t.dim).child("Loading…")))
        .children(rows.map((r, i) => menuRow(`bakers-label-${i}`, t, i === this.at, (cx) => this.toggle(r, cx))
          .child(div().w(14).child(r.on ? svg("mods/workspace-chrome/check.svg").size(13).text_color(t.foreground) : div()))
          .child(div().flex_1().min_w(0).truncate().child(r.name)))))
      .when(Boolean(this.error), (e) => e.child(div().px(8).text_size(12).text_color(t.ansi1).child(this.error)));
  }
}
