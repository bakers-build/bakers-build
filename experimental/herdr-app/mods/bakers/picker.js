import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, closeOverlay } from "herdr";
import { store, ticketOf } from "./store.js";
import { activeRun } from "./derive.js";
import { pickerRows } from "./remote.js";
import { confirm } from "./actions.js";
import { chip, field, hint, label, tint } from "./ui.js";

const COLUMNS = [["Conductor", 0], ["Machine", 130], ["Status", 80], ["Load", 130]];

// The conductor picker: picking one always leads to a dialog that names what happens (Run on, Move to, Stop dispatch).
// From the sidebar it is the same list, read only, with the tickets that run on each conductor.
export class Picker {
  init(p, cx) {
    this.p = p;
    this.at = null;
    this.filter = InputState.new({ placeholder: "Filter conductors" });
    this.filter.on("change", (_e, cx) => { this.at = null; cx.notify(); });
    this.filter.on("submit", (_e, cx) => this.pick(this.rows()[this.at], cx));
    this.filter.focus();
  }

  running() {
    return activeRun(store.details[this.p.ticket]?.runs) ?? store.runs[this.p.ticket] ?? null;
  }

  rows() {
    const rows = pickerRows(store.conductors, store.machines, store.local, this.filter.value());
    return ticketOf(this.p.ticket)?.conductor && !this.p.readonly ? [...rows, { stop: true, label: "No conductor: stop dispatch" }] : rows;
  }

  pick(row) {
    if (!row || this.p.readonly) return;
    closeOverlay(this.p.overlay);
    if (row.stop) confirm("stop", this.p.ticket, { conductor: ticketOf(this.p.ticket)?.conductor });
    else confirm(this.running() ? "move" : "run-on", this.p.ticket, { conductor: row.uuid });
  }

  readonly(t) {
    const runsOn = (uuid) => Object.entries(store.runs).filter(([, r]) => r?.conductor === uuid).map(([id]) => id);
    return v_flex().id("bakers-conductors").w_full().p(12).gap(8).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(div().font_semibold().child(`Conductors of ${store.projectName ?? "this project"}`))
      .children(pickerRows(store.conductors, store.machines, store.local, "").map((r) => h_flex().gap(10).items_start()
        .child(div().flex_1().min_w(0).child([r.label, r.machine].filter(Boolean).join(", ")))
        .child(div().text_size(12).text_color(r.online ? t.muted : t.dim)
          .child([r.status, r.load !== "-" && r.load.replace(" busy", ""), ...runsOn(r.uuid)].filter(Boolean).join(", ")))));
  }

  render() {
    const t = theme();
    if (this.p.readonly) return this.readonly(t);
    const rows = this.rows(), d = ticketOf(this.p.ticket), noMachine = store.conductors.some((c) => !("machine" in c));
    if (this.at === null) this.at = Math.max(0, rows.findIndex((r) => r.online));
    const cell = (width, child) => div().when(width > 0, (e) => e.w(width).flex_none()).when(!width, (e) => e.flex_1()).min_w(0).child(child);
    return v_flex().id("bakers-picker").w_full().p(12).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(this.p.overlay);
        else if (e.key === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (e.key === "up") this.at = Math.max(this.at - 1, 0);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().font_semibold().child(`${this.running() ? "Move" : "Run"} ${d?.identifier ?? ""} ${this.running() ? "to" : "on"}`))
        .child(div().text_size(12).text_color(t.muted).child(`${store.projectName ?? ""}, ${store.conductors.filter((c) => c.active).length} conductors`)))
      .child(field(t, true).child(Input.new(this.filter).w_full().text_size(12.5)))
      .child(v_flex().gap(1)
        .child(h_flex().px(8).h(24).gap(10).items_center().children(COLUMNS.map(([name, width]) => cell(width,
          h_flex().gap(5).items_center().child(label(name, t)).when(name === "Machine" && noMachine, (e) => e.child(chip("needs API", t)))))))
        .children(rows.map((r, i) => h_flex().id(`bakers-pick-${i}`).h(30).px(8).gap(10).items_center().rounded(6).border_1().cursor_pointer()
          .border_color(i === this.at ? t.accent : t.popover).bg(i === this.at ? tint(t.accent, "14") : t.popover).hover((s) => s.bg(t.hover))
          .on_click(() => this.pick(r))
          .when(Boolean(r.stop), (e) => e.child(div().text_color(t.muted).child(r.label)))
          .when(!r.stop, (e) => e
            .child(cell(0, div().truncate().font_semibold().text_color(r.online ? t.foreground : t.muted).child(r.label)))
            .child(cell(130, div().truncate().text_color(t.muted).child(r.machine ?? "-")))
            .child(cell(80, div().text_color(r.online ? t.foreground : t.dim).child(r.status)))
            .child(cell(130, div().truncate().text_color(t.muted).child(r.load)))))))
      .child(hint("Up and down move, Enter opens the dialog that names what happens, Esc closes without a change. Offline rows can be picked: the run starts when the conductor is back.", t));
  }
}
