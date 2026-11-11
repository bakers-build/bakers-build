import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { store, loadTicket, stale, ticketOf } from "./store.js";
import { isClosed } from "./derive.js";
import { focused } from "./actions.js";
import { mono } from "./ui.js";

// The right panel: the context of the focused ticket. It follows the focus and keeps the last ticket otherwise.
export class Panel {
  init() {
    this.key = shared("bakers.ticket") ?? null;
  }

  render(cx) {
    const t = theme(), key = focused() ?? this.key;
    this.key = key;
    if (stale(key)) loadTicket(key, cx);
    const d = ticketOf(key);
    const root = v_flex().id("bakers-panel").size_full().min_h(0).rounded(10).overflow_hidden().border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground).text_size(13);
    if (!d) return root.child(div().p(14).text_color(t.dim).child(key ? store.details[key]?.error ?? "Loading…" : "Open a ticket to see its context here."));
    return root.child(h_flex().h(42).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().font_family(mono()).font_semibold().text_size(12.5).child(d.identifier))
      .child(div().text_size(12).text_color(t.muted).child([isClosed(d) ? "closed" : d.state, d.frozen && "frozen"].filter(Boolean).join(", "))));
  }
}
