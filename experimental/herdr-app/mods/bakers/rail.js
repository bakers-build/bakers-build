import { div, svg, image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { exec, theme, shared, setShared, run, window } from "herdr";
import { makeClient } from "./bakers.js";
import { needsYouCount } from "./derive.js";
import { openBoard } from "./open.js";
import { mark } from "./ui.js";

const REFRESH_MS = 60000;
const client = makeClient(exec);
// The rail block drags the window; its buttons keep their clicks.
const stop = (_e, cx) => cx.stop_propagation();

// The first draft's narrow rail: Herdr, Spaces (Herdr's own sidebar), and bakers with a dot while a ticket needs you.
export class Rail {
  init(_p, cx) {
    this.count = 0;
    this.project = undefined;
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    const project = shared("bakers.project") ?? null;
    this.project = project;
    if (!project) return;
    cx.spawn(async (cx) => {
      try {
        const count = needsYouCount(await client.allTickets(project));
        if (this.project === project) this.count = count;
        setShared("bakers.needs", count);
      } catch {
        // Keeps the last count; the board shows the error line.
      }
      cx.notify();
    });
  }

  button(id, tip, child, onClick, t) {
    return div().id(id).w(36).h(36).flex_none().flex().items_center().justify_center().rounded(8).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop).on_click(() => onClick()).child(child);
  }

  render(cx) {
    if ((shared("bakers.project") ?? null) !== this.project) this.refresh(cx);
    const t = theme(), mac = window()?.platform === "macos";
    const bakers = div().relative().child(mark())
      .when(this.count > 0, (e) => e.child(div().absolute().top(-5).right(-5).w(8).h(8).rounded(4).bg(t.blocked)));
    const tip = this.count > 0 ? `bakers: ${this.count} need${this.count === 1 ? "s" : ""} you` : "bakers tickets";
    return v_flex().id("bakers-rail").size_full().items_center().gap(6).pt(mac ? 44 : 13).bg(t.chrome)
      .child(image("frame/welcome/herdr.png").size(20).rounded(5).mb(14))
      .child(this.button("bakers-rail-spaces", "Spaces", svg("mods/workspace-chrome/panel-left.svg").size(16), () => run("layout.toggle", { id: "sidebar" }), t))
      .child(this.button("bakers-rail-bakers", tip, bakers, openBoard, t));
  }
}
