import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, closeOverlay } from "herdr";
import { store, client } from "./store.js";
import { openTicket } from "./open.js";
import { field, hint, menuRow, mono } from "./ui.js";

// Go to ticket: by identifier or words of the title (ticket_search). Enter opens it as a tab, or selects its open tab.
export class GoTo {
  init(p, cx) {
    this.p = p;
    this.at = 0;
    this.found = [];
    this.query = InputState.new({ placeholder: "Identifier or words of the title" });
    this.query.on("change", (_e, cx) => this.search(cx));
    this.query.on("submit", () => this.go(this.rows()[this.at]));
    this.query.focus();
  }

  // Waits for a pause in typing, then asks bakers; tickets the store knows by identifier show at once.
  search(cx) {
    const query = this.query.value().trim(), asked = (this.asked = Symbol("search"));
    this.at = 0;
    cx.notify();
    if (query.length < 2) return void (this.found = []);
    cx.spawn(async (cx) => {
      await cx.sleep(250);
      if (asked !== this.asked) return;
      try {
        const found = await client.search(query, store.project);
        if (asked === this.asked) Object.assign(this, { found, error: null });
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  rows() {
    const needle = this.query.value().trim().toLowerCase();
    const known = needle ? store.tickets.filter((t) => t.identifier.toLowerCase().startsWith(needle)) : [];
    const rows = [...known, ...this.found].map((t) => ({ identifier: t.identifier, title: t.title, state: t.state }));
    return rows.filter((r, i) => rows.findIndex((x) => x.identifier === r.identifier) === i).slice(0, 12);
  }

  go(row) {
    if (!row) return;
    closeOverlay(this.p.overlay);
    openTicket(row, true);
  }

  render() {
    const t = theme(), rows = this.rows();
    return v_flex().id("bakers-goto").w_full().p(12).gap(8).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(this.p.overlay);
        else if (e.key === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (e.key === "up") this.at = Math.max(this.at - 1, 0);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().gap(8).items_center().child(div().text_size(12).text_color(t.muted).child("Go to ticket")).child(div().font_family(mono()).text_size(11.5).text_color(t.dim).child("cmd-shift-O")))
      .child(field(t, true).child(Input.new(this.query).w_full().text_size(13)))
      .when(rows.length > 0, (e) => e.child(v_flex().gap(1).children(rows.map((r, i) => menuRow(`bakers-goto-${i}`, t, i === this.at, () => this.go(r))
        .child(div().flex_none().font_family(mono()).text_size(12).child(r.identifier))
        .child(div().flex_1().min_w(0).truncate().child(r.title))
        .child(div().flex_none().text_size(12).text_color(t.muted).child(r.state))))))
      .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
      .child(hint("Identifier or words of the title. Enter opens it as a tab, or selects its tab if it is open.", t));
  }
}
