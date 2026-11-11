import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, closeOverlay, notify, hc, terminals } from "herdr";
import { store, client, changed, ticketOf } from "./store.js";
import { activeRun, ago, conductorLabel, runTerminal, toUnix } from "./derive.js";
import { machineOf } from "./remote.js";
import { DIALOGS } from "./flows.js";
import { showTerminal } from "./open.js";
import { button, chip, dialogBox, dialogButtons, field, fromTo, mono } from "./ui.js";

const conductor = (uuid) => {
  const c = store.conductors.find((c) => c.uuid === uuid);
  return c ? { uuid: c.uuid, label: conductorLabel(c), status: c.status, raw: c } : null;
};

// What a dialog needs to say what happens: the ticket, the target conductor and machine, the run it would cancel.
function context(p) {
  const run = activeRun(store.details[p.ticket]?.runs) ?? store.runs[p.ticket] ?? null, target = conductor(p.conductor);
  return {
    ticket: ticketOf(p.ticket), target: p.target, conductor: target, machine: machineOf(target?.raw, store.machines, store.local),
    from: conductor(run?.conductor) ?? { label: "its conductor" }, since: run?.started_at ? ago(toUnix(run.started_at), Date.now()) : "now",
  };
}

// Every confirmation: it says what happens, in the order it happens, then does it. Esc closes without a change.
export class Confirm {
  init(p, cx) {
    this.p = p;
    this.copy = DIALOGS[p.action](context(p));
    this.busy = false;
    this.error = null;
    const f = this.copy.field;
    this.field = f && (f.multiline ? TextareaState.new({ placeholder: f.placeholder ?? "", rows: 2 }) : InputState.new({ placeholder: f.placeholder ?? "" }));
    if (this.copy.enter === "yes") this.field?.on("submit", (_e, cx) => this.confirm(cx));
    this.field?.on("focus", () => { this.typing = true; });
    this.field?.on("blur", () => { this.typing = false; });
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() {
    closeOverlay(this.p.overlay);
  }

  // After Add machine, the run's terminal shows up once Herdr lists the machine's terminals.
  async showAdded(cx) {
    for (let i = 0; i < 20 && !runTerminal(terminals(), this.p.ticket); i++) await cx.sleep(500);
    const terminal = runTerminal(terminals(), this.p.ticket);
    if (terminal) showTerminal(terminal.address);
  }

  confirm(cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        await this.copy.run({ client, hc }, { text: this.field?.value() ?? "" });
        delete store.moveFailed[this.p.ticket];
        if (this.p.action === "add-machine") await this.showAdded(cx);
        notify({ title: this.copy.done, level: "success" });
        changed(this.p.ticket, cx);
        this.close();
      } catch (e) {
        if (e.moveFailed) store.moveFailed[this.p.ticket] = e.moveFailed;
        this.error = String(e?.message ?? e);
        this.busy = false;
      }
      cx.notify();
    });
    cx.notify();
  }

  render() {
    const t = theme(), { copy } = this;
    const yesKind = copy.enter === "yes" ? "primary" : this.p.action === "cancel" ? "danger" : "plain";
    const yes = button("bakers-confirm-yes", this.busy ? "Working…" : copy.yes, t, (cx) => this.confirm(cx), yesKind, this.busy);
    const no = button("bakers-confirm-no", copy.no, t, () => this.close(), copy.enter === "no" ? "primary" : "plain", this.busy);
    // Enter does what the dialog's default is (outside its field); cmd-Enter always confirms; Esc never changes anything.
    const keys = {
      escape: () => this.close(),
      enter: (cx) => !this.typing && (copy.enter === "yes" ? this.confirm(cx) : this.close()),
      "cmd-enter": (cx) => this.confirm(cx),
    };
    return dialogBox("bakers-confirm", t, this.handle, (e, cx) => {
      if (!keys[e.keystroke]) return;
      keys[e.keystroke](cx);
      cx.stop_propagation();
    })
      .child(div().text_size(16).font_semibold().child(copy.title))
      .when(Boolean(copy.from), (e) => e.child(fromTo(copy.from, copy.to, t, copy.extra)))
      .child(div().text_color(t.muted).child(copy.body))
      .when(Boolean(copy.rows), (e) => e.child(v_flex().gap(4).p(10).rounded(6).bg(t.raised).children((copy.rows ?? []).map(([name, value]) =>
        h_flex().gap(10).child(div().w(90).flex_none().text_size(12).text_color(t.dim).child(name))
          .child(div().flex_1().min_w(0).font_family(mono()).text_size(12).child(value))))))
      .when(Boolean(copy.field), (e) => e.child(v_flex().gap(6)
        .child(div().text_size(12).text_color(t.muted).child(copy.field.label))
        .child(field(t, false).child((copy.field.multiline ? Textarea : Input).new(this.field).w_full().text_size(12.5)))))
      .when(Boolean(copy.chip), (e) => e.child(h_flex().child(chip(copy.chip, t))))
      .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
      .child(dialogButtons(copy.esc, t, copy.primaryFirst ? [yes, no] : [no, yes]));
  }
}
