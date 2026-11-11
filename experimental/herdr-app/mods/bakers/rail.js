import { div, svg, image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, shared, run, window, nextCommand } from "herdr";
import { refresh, ticketOf } from "./store.js";
import { openList, openTicket, pinPreview, popup, togglePanel } from "./open.js";
import { newTicket, goToTicket } from "./actions.js";
import { mark } from "./ui.js";

const REFRESH_MS = 60000;
// The rail block drags the window; its buttons keep their clicks.
const stop = (_e, cx) => cx.stop_propagation();

// The rail is always shown in the bakers layout, so it keeps the project fresh and takes the bakers keys.
const COMMANDS = {
  new: () => newTicket(),
  goto: () => goToTicket(),
  panel: () => togglePanel(),
  pin: () => pinPreview(),
  open: (identifier) => openTicket(ticketOf(identifier) ?? { identifier, state: "open" }, true),
  view: (view) => openList(view),
};

export class Rail {
  init(_p, cx) {
    this.project = shared("bakers.project") ?? null;
    refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const [name, arg] = String(await nextCommand()).split(":");
        COMMANDS[name]?.(arg);
        cx.notify();
      }
    });
  }

  button(id, tip, child, onClick, t) {
    return div().id(id).w(36).h(36).flex_none().flex().items_center().justify_center().rounded(8).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop).on_click(() => onClick()).child(child);
  }

  render(cx) {
    const project = shared("bakers.project") ?? null;
    if (project !== this.project) {
      this.project = project;
      refresh(cx, true);
    }
    const t = theme(), mac = window()?.platform === "macos", count = Number(shared("bakers.needs") || 0);
    const bakers = div().relative().child(mark())
      .when(count > 0, (e) => e.child(div().absolute().top(-7).right(-9).min_w(14).h(14).px(3).rounded(7).bg(t.blocked)
        .flex().items_center().justify_center().text_size(9.5).font_semibold().text_color(t.background).child(String(count))));
    const tip = count > 0 ? `bakers: ${count} need${count === 1 ? "s" : ""} you` : "bakers tickets";
    return v_flex().id("bakers-rail").size_full().items_center().gap(6).pt(mac ? 44 : 13).bg(t.chrome)
      .child(image("frame/welcome/herdr.png").size(20).rounded(5).mb(14))
      .child(this.button("bakers-rail-spaces", "Spaces", svg("mods/workspace-chrome/panel-left.svg").size(16), () => run("layout.toggle", { id: "sidebar" }), t))
      .child(this.button("bakers-rail-bakers", tip, bakers, () => openList("needs-me"), t)
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); popup("menu", { menu: "rail" }, 200); }));
  }
}
