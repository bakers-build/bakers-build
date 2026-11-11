import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { theme, shared, spaces, panes, run, notify, nextCommand } from "herdr";
import { store, client, changed, loadTicket, stale, ticketOf, agentOf } from "./store.js";
import { commentRows, isClosed, needsCard, tabName, ticketTab } from "./derive.js";
import { WRITES } from "./flows.js";
import { openLink, pinPreview, popup } from "./open.js";
import { AGENT_ACTIONS, confirm, showAgent } from "./actions.js";
import { agentDot, button, chevron, chip, field, hint, label, mono, pill, statusColor, tint } from "./ui.js";

const COMPOSER = {
  comment: { label: "Write a comment", hint: "C focuses, cmd-Enter sends", send: "Comment", write: "comment" },
  answer: { label: "Answer to the agent's question", hint: "cmd-Enter sends, Esc back to a plain comment", send: "Send answer", write: "answer" },
  changes: { label: "Changes you want in the plan", hint: "cmd-Enter sends, Esc back to a plain comment", send: "Request changes", write: "requestChanges" },
};

// A ticket tab: the ticket as a document (title, state, Needs you card, description, comments) with the composer below.
// A preview tab shows bakers.preview; typing in it pins it, and a pinned preview keeps its ticket in localStorage.
export class TicketTab {
  init(p, cx) {
    this.p = p;
    this.pinned = localStorage.getItem("ticket");
    this.key = null;
    this.handle = cx.focus_handle();
    this.mode = "read";
    this.composing = "comment";
    this.unfreeze = true;
    this.unfolded = new Set();
    this.preview = false;
    this.composer = this.state(TextareaState.new({ placeholder: "Write a comment, Markdown", rows: 3 }), cx);
    this.composer.set_auto_grow(2, 10);
    this.title = this.state(InputState.new({}), cx);
    this.body = this.state(TextareaState.new({ rows: 14 }), cx);
    this.body.set_auto_grow(8, 30);
    this.handle.focus();
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  // A text field: typing in it pins the tab, and while it has the keyboard, letters are text, not keys.
  state(s) {
    s.on("change", (_e, cx) => { this.pin(); cx.notify(); });
    s.on("focus", () => { this.typing = true; });
    s.on("blur", () => { this.typing = false; });
    return s;
  }

  ticketKey() {
    return this.pinned ?? this.p.ticket ?? (this.p.preview ? shared("bakers.preview") ?? this.key : null);
  }

  pin() {
    if (!this.p.preview || this.pinned || !this.key) return;
    this.pinned = this.key;
    localStorage.setItem("ticket", this.key);
    if (shared("bakers.preview") === this.key) pinPreview();
  }

  follow(key) {
    // A preview tab whose ticket is no longer the preview was pinned from outside (cmd-Enter, a double click).
    if (this.p.preview && !this.pinned && this.key && shared("bakers.preview") !== this.key && !shared("bakers.preview")) this.pin();
    if (key === this.key) return;
    Object.assign(this, { key, mode: "read", composing: "comment", error: null, unfolded: new Set() });
    this.composer.set_value("");
  }

  edit() {
    const d = ticketOf(this.key);
    if (!d || isClosed(d)) return;
    this.title.set_value(d.title ?? "");
    this.body.set_value(d.description ?? "");
    this.mode = "edit";
    this.write = "write";
    this.pin();
    this.title.focus();
  }

  compose(mode) {
    this.composing = mode;
    this.pin();
    this.composer.focus();
  }

  act(card) {
    if (card?.kind === "question") this.compose("answer");
    if (card?.kind === "plan") confirm("state", this.key, { target: "working" });
  }

  send(write, cx) {
    const d = ticketOf(this.key), key = this.key;
    this.busy = true;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        await WRITES[write]({ client }, d, { body: this.composer.value(), unfreeze: this.unfreeze, title: this.title.value(), description: this.body.value() });
        const done = { answer: this.unfreeze ? `Answered ${key}, the run continues` : `Answered ${key}`, save: `${key} saved` }[write] ?? `Comment posted on ${key}`;
        notify({ title: done, level: "success" });
        if (write === "save") this.mode = "read";
        else this.composer.set_value("");
        this.composing = "comment";
        changed(key, cx);
        this.handle.focus();
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.busy = false;
      cx.notify();
    });
  }

  leave() {
    if (this.mode === "edit") this.mode = "read";
    else this.composing = "comment";
    this.handle.focus();
  }

  onKey(e, d, card, section, cx) {
    const editing = this.mode === "edit";
    const move = section?.actions.find((a) => a.id === "run-on" || a.id === "move-to");
    const keys = {
      e: () => !editing && this.edit(),
      a: () => this.act(card),
      s: () => !isClosed(d) && this.stateMenu(d),
      c: () => this.compose(this.composing),
      r: () => move && AGENT_ACTIONS[move.id](this.key),
      g: () => section?.kind === "run" && showAgent(this.key),
      escape: () => this.leave(),
      "cmd-enter": () => (editing ? this.send("save", cx) : this.send(COMPOSER[this.composing].write, cx)),
    };
    const action = keys[e.keystroke];
    if (!action || (this.typing && e.keystroke.length === 1)) return;
    action();
    cx.stop_propagation();
    cx.notify();
  }

  stateMenu(d) {
    popup("menu", { menu: "state", ticket: d.identifier, note: "All states shown; the server refuses what the workflow forbids.", noteChip: "needs API: allowed states" }, 240);
  }

  // The line under the title: state, agent and conductor, with the one fitting action.
  agentLine(section, card, t) {
    if (!section) return div();
    const color = section.kind === "run" ? statusColor(section.status, t) : t.muted;
    const action = card ? null : section.actions.find((a) => ["run-on", "show-agent"].includes(a.id) && !a.disabled);
    return h_flex().gap(6).items_center().min_w(0).flex_shrink(1)
      .child(agentDot(section, t))
      .child(div().min_w(0).truncate().text_size(12.5).text_color(color).child(section.line))
      .when(Boolean(action), (e) => e.child(div().id("bakers-line-action").flex_none().text_size(12.5).text_color(t.accent).cursor_pointer()
        .hover((s) => s.underline()).on_click(() => AGENT_ACTIONS[action.id](this.key)).child(action.label)));
  }

  header(d, section, card, t) {
    const row = h_flex().h(32).gap(8).items_center().child(div().font_family(mono()).font_semibold().text_size(13).child(d.identifier));
    if (this.mode === "edit") {
      return row.child(div().text_size(12.5).text_color(t.muted).child("Editing")).child(div().flex_1())
        .child(button("bakers-edit-cancel", "Cancel", t, (cx) => { this.mode = "read"; this.handle.focus(); cx.notify(); }))
        .child(button("bakers-edit-save", this.busy ? "Saving…" : "Save", t, (cx) => this.send("save", cx), "primary", this.busy));
    }
    const closed = isClosed(d);
    return row
      .child(h_flex().id("bakers-state").h(24).px(8).gap(4).items_center().rounded(12).border_1().border_color(t.input).text_size(12)
        .when(!closed, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.stateMenu(d)))
        .child(closed ? `closed, ${d.state}` : d.state).when(!closed, (e) => e.child(chevron(t))))
      .when(Boolean(d.frozen), (e) => e.child(pill("Frozen", t, true)))
      .child(this.agentLine(section, card, t))
      .child(div().flex_1())
      .when(!closed, (e) => e.child(button("bakers-edit", "Edit", t, (cx) => { this.edit(); cx.notify(); })))
      .child(button("bakers-more", "...", t, () => popup("menu", { menu: "more", ticket: d.identifier }, 220)));
  }

  card(card, section, t) {
    const blue = statusColor("blocked", t);
    const inRun = section?.actions.find((a) => a.id === "show-agent");
    const buttons = card.kind === "plan"
      ? [button("bakers-approve", "Approve plan...", t, () => this.act(card), "primary"),
        button("bakers-changes", "Request changes", t, (cx) => { this.compose("changes"); cx.notify(); })]
      : [button("bakers-answer", "Answer below", t, (cx) => { this.compose("answer"); cx.notify(); }, "primary"),
        button("bakers-answer-run", "Answer in the run", t, () => showAgent(this.key), "plain", !inRun || Boolean(inRun.disabled))];
    return v_flex().gap(6).p(14).rounded(8).border_1().border_color(blue).bg(tint(blue, "12"))
      .child(div().text_size(11).font_semibold().text_color(blue).child("NEEDS YOU"))
      .child(div().font_semibold().child(card.title))
      .when(Boolean(card.body), (e) => e.child(div().text_color(t.foreground).child(card.body.split("\n\n")[0])))
      .child(h_flex().pt(4).gap(8).items_center().children(buttons).child(hint("A acts on this card", t)));
  }

  description(d, t) {
    const section = v_flex().gap(8).child(label("Description", t));
    if (this.mode === "edit") {
      const tab = (id, text) => div().id(`bakers-desc-${id}`).px(8).h(22).flex().items_center().rounded(5).text_size(12).cursor_pointer()
        .when(this.write === id, (e) => e.bg(t.selected).text_color(t.foreground)).when(this.write !== id, (e) => e.text_color(t.muted))
        .on_click((_e, cx) => { this.write = id; cx.notify(); }).child(text);
      return v_flex().gap(8)
        .child(h_flex().gap(8).items_center().child(div().text_size(12).text_color(t.muted).child("Description, Markdown")).child(div().flex_1())
          .child(tab("write", "Write")).child(tab("preview", "Preview")))
        .child(this.write === "write"
          ? field(t, true).child(Textarea.new(this.body).w_full().text_size(13))
          : div().min_h(120).p(10).rounded(6).border_1().border_color(t.border).child(TextView.markdown("bakers-desc-preview", this.body.value()).selectable()))
        .child(h_flex().gap(8).items_center().child(hint("Saving replaces the whole description.", t)).child(chip("needs API: revision", t)));
    }
    return section
      .child(div().id("bakers-desc").cursor_pointer().on_click((_e, cx) => { this.edit(); cx.notify(); })
        .child(d.description ? TextView.markdown("bakers-desc-text", d.description).selectable().on_link_click((url) => openLink(url)) : div().text_color(t.dim).child("No description yet.")))
      .when(!isClosed(d), (e) => e.child(hint("Click or E to edit.", t)));
  }

  comments(d, card, t) {
    const rows = commentRows(d.comments, store.me?.name, Date.now());
    return v_flex().gap(12).child(label(`Comments ${rows.length}, newest last`, t))
      .when(!rows.length, (e) => e.child(div().text_color(t.dim).child("No comments yet.")))
      .children(rows.map((c) => {
        const open = !c.folded || this.unfolded.has(c.id) || (card?.kind === "plan" && card.comment === c.id);
        const asked = card?.comment === c.id && card.kind === "question";
        return v_flex().id(`bakers-comment-${c.id}`).gap(4).when(asked, (e) => e.pl(10).border_l(2).border_color(statusColor("blocked", t)))
          .child(h_flex().gap(8).items_center()
            .child(div().text_size(12).font_semibold().child(c.author ?? "Someone"))
            .child(div().text_size(12).text_color(t.muted).child(c.type))
            .child(div().text_size(12).text_color(t.dim).child(c.age))
            .when(c.folded, (e) => e.child(div().id(`bakers-fold-${c.id}`).text_size(12).text_color(t.accent).cursor_pointer()
              .on_click((_e, cx) => { this.unfolded[open ? "delete" : "add"](c.id); cx.notify(); }).child(open ? "fold" : "show all"))))
          .child(open ? TextView.markdown(`bakers-comment-text-${c.id}`, c.body ?? "").selectable().on_link_click((url) => openLink(url))
            : div().truncate().text_color(t.muted).child(c.first));
      }));
  }

  composerBox(d, t) {
    const mode = COMPOSER[this.composing], answering = this.composing === "answer", blue = statusColor("blocked", t);
    const check = h_flex().id("bakers-unfreeze").gap(6).items_center().cursor_pointer().on_click((_e, cx) => { this.unfreeze = !this.unfreeze; cx.notify(); })
      .child(div().size(14).flex().items_center().justify_center().rounded(3).border_1().border_color(this.unfreeze ? blue : t.input).bg(this.unfreeze ? blue : t.background)
        .when(this.unfreeze, (e) => e.child(svg("mods/workspace-chrome/check.svg").size(11).text_color(t.background))))
      .child(div().text_size(12).text_color(t.muted).child(`Unfreeze and remove the label ${d.labels?.find((l) => /^question$/i.test(l)) ?? "Question"}`));
    return v_flex().w_full().max_w(760).gap(8)
      .child(div().text_size(12).font_semibold().text_color(this.composing === "comment" ? t.muted : blue).child(mode.label))
      .child(field(t, this.composing !== "comment").child(Textarea.new(this.composer).w_full().text_size(13)))
      .child(h_flex().gap(8).items_center()
        .when(answering, (e) => e.child(check))
        .when(this.composing === "changes", (e) => e.child(chip("needs API: re-plan protocol", t)))
        .child(div().flex_1())
        .child(hint(mode.hint, t))
        .when(answering, (e) => e.child(button("bakers-just-comment", "Just comment", t, (cx) => this.send("comment", cx), "plain", this.busy)))
        .child(button("bakers-send", this.busy ? "Sending…" : mode.send, t, (cx) => this.send(mode.write, cx), "primary", this.busy)));
  }

  saveBar(t) {
    return h_flex().w_full().max_w(760).gap(8).items_center().child(div().flex_1()).child(hint("Esc cancels, cmd-Enter saves", t))
      .child(button("bakers-edit-cancel-2", "Cancel", t, (cx) => { this.mode = "read"; this.handle.focus(); cx.notify(); }))
      .child(button("bakers-edit-save-2", this.busy ? "Saving…" : "Save", t, (cx) => this.send("save", cx), "primary", this.busy));
  }

  // The tab's name says the ticket's state: renamed when it changes.
  rename(d) {
    const tab = ticketTab(spaces().find((s) => s.active), panes(), d.identifier);
    if (tab && tab.name !== tabName(d)) run("tab.rename", { id: tab.id, name: tabName(d) });
  }

  render(cx) {
    this.follow(this.ticketKey());
    if (stale(this.key)) loadTicket(this.key, cx);
    const t = theme(), d = store.details[this.key]?.data;
    const root = v_flex().id("bakers-ticket-tab").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13);
    if (!d) return root.child(div().p(24).text_color(t.dim).child(this.key ? store.details[this.key]?.error ?? "Loading…" : "No ticket."));
    this.rename(d);
    const section = agentOf(this.key, Date.now()), card = needsCard(d, store.reasons[this.key], d.comments, Date.now());
    const composing = this.composing !== "comment";
    return root.on_key_down((e, cx) => this.onKey(e, d, card, section, cx))
      .child(div().id("bakers-doc").flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().w_full().max_w(760 + 56).mx_auto().px(28).py(20).gap(18)
          .child(v_flex().gap(10)
            .child(this.header(d, section, card, t))
            .child(this.mode === "edit"
              ? field(t, true).child(Input.new(this.title).w_full().text_size(20).font_semibold())
              : div().id("bakers-title").text_size(22).font_semibold().cursor_pointer().on_click((_e, cx) => { this.edit(); cx.notify(); }).child(d.title ?? "")))
          .when(Boolean(card) && this.mode !== "edit", (e) => e.child(this.card(card, section, t)))
          .child(this.description(d, t))
          .when(this.mode !== "edit", (e) => e.child(this.comments(d, card, t)))))
      .child(h_flex().flex_none().justify_center().px(28).py(12).border_t(composing ? 2 : 1).border_color(composing ? statusColor("blocked", t) : t.border)
        .child(v_flex().w_full().max_w(760).gap(6)
          .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
          .child(this.mode === "edit" ? this.saveBar(t) : isClosed(d) ? hint("A closed ticket cannot be changed any more.", t) : this.composerBox(d, t))));
  }
}
