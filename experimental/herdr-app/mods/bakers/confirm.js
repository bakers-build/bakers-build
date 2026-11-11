import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, setShared, closeOverlay } from "herdr";
import { makeClient } from "./bakers.js";
import { CONFIRM } from "./derive.js";
import { button } from "./ui.js";

const client = makeClient(exec);
const DEFAULT_REASON = "Cancelled from Herdr";

// The dialog behind Cancel run, Freeze and Unfreeze: it says what happens, then does it.
export class Confirm {
  init(p) {
    this.p = p;
    this.copy = CONFIRM[p.action];
    this.busy = false;
    this.error = null;
    this.reason = InputState.new({ placeholder: "Wrong branch, restarting with a smaller scope" });
  }

  confirm(cx) {
    this.busy = true;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        await this.copy.run(client, this.p.ticket, this.reason.value().trim() || DEFAULT_REASON);
        setShared("bakers.changed", Date.now());
        closeOverlay(this.p.overlay);
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.busy = false;
      }
      cx.notify();
    });
    cx.notify();
  }

  render() {
    const t = theme(), { copy, p } = this;
    return v_flex().p(20).gap(12).text_color(t.foreground).text_size(13)
      .child(div().text_size(15).font_semibold().child(copy.title(p.identifier)))
      .child(div().text_color(t.muted).child(copy.body(p.identifier, p.state)))
      .when(Boolean(copy.reason), (e) => e.child(v_flex().gap(6)
        .child(div().text_size(12).text_color(t.muted).child("Reason (optional, recorded on the run)"))
        .child(div().h(32).px(10).flex().items_center().rounded(8).border_1().border_color(t.border).bg(t.background)
          .child(Input.new(this.reason).h_full().text_size(12)))))
      .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
      .child(h_flex().pt(4).gap(8).justify_end()
        .child(button("bakers-confirm-yes", this.busy ? copy.busy : copy.yes, t, (cx) => this.confirm(cx), "danger", this.busy))
        .child(button("bakers-confirm-no", copy.no, t, () => closeOverlay(p.overlay), "primary", this.busy)));
  }
}
