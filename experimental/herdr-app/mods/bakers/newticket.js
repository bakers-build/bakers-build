import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { theme, closeOverlay, notify } from "herdr";
import { store, client, refresh, ticketOf } from "./store.js";
import { DEFAULT_RECIPE, RECIPES, TYPES, WRITES } from "./flows.js";
import { openTicket } from "./open.js";
import { button, chevron, chip, dialogBox, dialogButtons, field, hint, mono } from "./ui.js";

// New ticket: title, project, type, recipe, parent, description. Create opens it as a pinned tab.
export class NewTicket {
  init(p, cx) {
    this.p = p;
    this.project = store.project;
    this.type = null;
    this.recipe = null;
    this.parent = ticketOf(p.parent) ? p.parent : null;
    this.open = null;
    this.write = "write";
    this.title = InputState.new({ placeholder: "What should change" });
    this.body = TextareaState.new({ placeholder: "What, why, and how you will know it is done", rows: 8 });
    for (const s of [this.title, this.body]) {
      s.on("focus", () => { this.typing = true; });
      s.on("blur", () => { this.typing = false; });
    }
    this.title.focus();
    this.handle = cx.focus_handle();
  }

  // ticket_create wants the workflow, which no tool names for a project: take it from one of its tickets.
  async workflow() {
    const loaded = Object.values(store.details).find((d) => d.data?.project === this.project && d.data.workflow);
    if (loaded) return loaded.data.workflow;
    const [first] = await client.allTickets(this.project);
    return first ? (await client.ticket(first.identifier)).workflow : null;
  }

  create(cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        const made = await WRITES.create({ client }, null, {
          title: this.title.value(), project: this.project, workflow: await this.workflow(), type: this.type, recipe: this.recipe,
          parent: this.parent, description: this.body.value().trim(),
        });
        notify({ title: `${made.identifier} created`, level: "success" });
        closeOverlay(this.p.overlay);
        openTicket({ identifier: made.identifier, state: made.state }, true);
        refresh(cx, true);
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.busy = false;
      }
      cx.notify();
    });
    cx.notify();
  }

  // A pick inside the dialog: the button opens its options below the row, a click picks one.
  picker(id, name, value, t) {
    return v_flex().flex_1().min_w(0).gap(4)
      .child(div().text_size(12).text_color(t.muted).child(name))
      .child(h_flex().id(`bakers-new-${id}`).h(30).px(10).gap(6).items_center().rounded(6).border_1().border_color(this.open === id ? t.accent : t.input)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.open = this.open === id ? null : id; cx.notify(); })
        .child(div().flex_1().min_w(0).truncate().child(value)).child(chevron(t)));
  }

  options(t) {
    const lists = {
      project: store.projects.map((p) => [p.uuid, p.name]),
      type: [[null, "Let qualification decide"], ...TYPES.map((v) => [v, v])],
      recipe: [[null, `${DEFAULT_RECIPE}, default`], ...RECIPES.map((v) => [v, v])],
    };
    const current = { project: this.project, type: this.type, recipe: this.recipe }[this.open];
    return v_flex().p(4).gap(1).rounded(6).border_1().border_color(t.border).bg(t.raised)
      .children((lists[this.open] ?? []).map(([value, text], i) => h_flex().id(`bakers-new-option-${i}`).h(26).px(8).items_center().rounded(5).cursor_pointer()
        .when(value === current, (e) => e.bg(t.selected).font_semibold()).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this[this.open] = value;
          if (this.open === "project") this.parent = null;
          this.open = null;
          cx.notify();
        })
        .child(text)));
  }

  render() {
    const t = theme(), project = store.projects.find((p) => p.uuid === this.project), parent = ticketOf(this.parent);
    const tab = (id, text) => div().id(`bakers-new-desc-${id}`).px(8).h(22).flex().items_center().rounded(5).text_size(12).cursor_pointer()
      .when(this.write === id, (e) => e.bg(t.selected).text_color(t.foreground)).when(this.write !== id, (e) => e.text_color(t.muted))
      .on_click((_e, cx) => { this.write = id; cx.notify(); }).child(text);
    const keys = {
      escape: () => closeOverlay(this.p.overlay), "cmd-enter": (cx) => this.create(cx),
      tab: () => this.body.focus(), "shift-tab": () => this.title.focus(),
    };
    return dialogBox("bakers-new", t, this.handle, (e, cx) => {
      if (!keys[e.keystroke]) return;
      keys[e.keystroke](cx);
      cx.stop_propagation();
    })
      .child(h_flex().items_center().child(div().flex_1().text_size(16).font_semibold().child(`New ticket in ${project?.name ?? "a project"}`))
        .child(div().id("bakers-new-close").size(24).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.muted)
          .hover((s) => s.bg(t.hover)).on_click(() => closeOverlay(this.p.overlay)).child(svg("mods/pane/close.svg").size(12))))
      .child(v_flex().gap(4).child(div().text_size(12).text_color(t.muted).child("Title")).child(field(t, true).child(Input.new(this.title).w_full().text_size(13))))
      .child(h_flex().gap(10)
        .child(this.picker("project", "Project", project?.name ?? "-", t))
        .child(this.picker("type", "Type", this.type ?? "-", t))
        .child(this.picker("recipe", "Recipe", this.recipe ?? `${DEFAULT_RECIPE}, default`, t)))
      .when(Boolean(this.open), (e) => e.child(this.options(t)))
      .child(h_flex().gap(10)
        .child(v_flex().flex_1().min_w(0).gap(4).child(div().text_size(12).text_color(t.muted).child("Parent, optional"))
          .child(h_flex().h(30).px(10).gap(6).items_center().rounded(6).border_1().border_color(t.input)
            .child(div().font_family(mono()).text_size(12).child(parent?.identifier ?? "-"))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(parent?.title ?? "none"))
            .when(Boolean(parent), (e) => e.child(div().id("bakers-new-parent-clear").cursor_pointer().text_color(t.muted)
              .on_click((_e, cx) => { this.parent = null; cx.notify(); }).child(svg("mods/pane/close.svg").size(11))))))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(h_flex().gap(6).items_center().child(div().text_size(12).text_color(t.muted).child("Assignee")).child(chip("needs API: change later", t)))
          .child(h_flex().h(30).px(10).items_center().rounded(6).border_1().border_dashed().border_color(t.input).text_color(t.muted).child("Me"))))
      .child(v_flex().gap(6)
        .child(h_flex().gap(8).items_center().child(div().text_size(12).text_color(t.muted).child("Description, Markdown")).child(div().flex_1())
          .child(tab("write", "Write")).child(tab("preview", "Preview")))
        .child(this.write === "write"
          ? field(t, false).child(Textarea.new(this.body).w_full().text_size(13))
          : div().min_h(150).p(10).rounded(6).border_1().border_color(t.border).child(TextView.markdown("bakers-new-preview", this.body.value()).selectable())))
      .child(h_flex().gap(8).items_center().child(hint("Workflow: taken from the project's other tickets.", t)).child(chip("needs API: project workflow", t)))
      .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
      .child(dialogButtons("Opens as a tab once created. cmd-Enter creates, Esc closes.", t, [
        button("bakers-new-cancel", "Cancel", t, () => closeOverlay(this.p.overlay)),
        button("bakers-new-create", this.busy ? "Creating…" : "Create ticket", t, (cx) => this.create(cx), "primary", this.busy),
      ]));
  }
}
