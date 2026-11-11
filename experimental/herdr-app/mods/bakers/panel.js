import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { store, loadTicket, stale, ticketOf, agentOf } from "./store.js";
import { ago, isClosed, stateLabel, toUnix } from "./derive.js";
import { openLink, popup } from "./open.js";
import { AGENT_ACTIONS, confirm, focused } from "./actions.js";
import { agentDot, button, chip, hint, label, mono, statusColor } from "./ui.js";

const KEY_HINTS = [["move-to", "R moves, G shows the agent."], ["run-on", "R picks a conductor."], ["show-agent", "G shows the agent."]];

// The right panel: the context of the focused ticket (agent and conductor, properties, activity, runs).
// It follows the focus and keeps the last ticket otherwise. Description, comments and composer are the tab's.
export class Panel {
  init() {
    this.key = shared("bakers.ticket") ?? null;
    this.runsOpen = false;
  }

  agent(section, t) {
    const color = section.kind === "run" ? statusColor(section.status, t) : t.foreground;
    const disabled = section.actions.find((a) => a.disabled);
    return v_flex().gap(6).child(label("Agent and conductor", t))
      .child(h_flex().gap(7).items_center().flex_wrap()
        .child(agentDot(section, t))
        .child(div().text_color(color).child(section.title))
        .when(Boolean(section.detail), (e) => e.child(div().text_size(12).text_color(t.muted).child(section.detail)))
        .when(Boolean(section.chip), (e) => e.child(chip(section.chip, t))))
      .child(h_flex().gap(6).pt(2).flex_wrap().children(section.actions.map((a) =>
        button(`bakers-agent-${a.id}`, a.label, t, () => AGENT_ACTIONS[a.id](this.key), "plain", Boolean(a.disabled)))))
      .when(Boolean(disabled), (e) => e.child(hint(disabled?.disabled ?? "", t)))
      .when(Boolean(section.note), (e) => e.child(hint(section.note ?? "", t)))
      .child(hint(KEY_HINTS.find(([id]) => section.actions.some((a) => a.id === id))?.[1] ?? "", t));
  }

  property(name, value, t, api) {
    return v_flex().gap(3).min_w(0)
      .child(h_flex().gap(5).items_center().child(div().text_size(11.5).text_color(t.dim).child(name)).when(Boolean(api), (e) => e.child(chip("API", t))))
      .child(value);
  }

  // A property that changes on a pick, saved at once.
  menuValue(id, value, menu, t, closed) {
    return h_flex().child(h_flex().id(id).h(24).px(7).gap(4).items_center().rounded(5).border_1().border_color(t.input).text_size(12.5)
      .when(!closed, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => popup("menu", { menu, ticket: this.key }, 200)))
      .child(value || "-").child(svg("mods/workspace-chrome/chevron-down.svg").size(10).text_color(t.muted)));
  }

  properties(d, t) {
    const closed = isClosed(d), listed = store.tickets.find((x) => x.identifier === d.identifier);
    const parent = store.tickets.find((x) => x.id === listed?.parent);
    const labels = h_flex().gap(5).flex_wrap().items_center()
      .children((d.labels ?? []).map((l) => div().px(7).h(20).flex().items_center().rounded(10).bg(t.raised).border_1().border_color(t.border).text_size(11.5).child(l)))
      .when(!closed, (e) => e.child(div().id("bakers-label-add").size(20).flex().items_center().justify_center().rounded(10).border_1().border_dashed()
        .border_color(t.input).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => popup("labels", { ticket: this.key }, 300)).child("+")));
    const frozen = h_flex().gap(8).items_center()
      .child(div().text_size(12.5).child(d.frozen ? `Yes${d.frozen_at ? `, ${ago(toUnix(d.frozen_at), Date.now())}` : ""}` : "No"))
      .when(!closed, (e) => e.child(button("bakers-freeze", d.frozen ? "Unfreeze..." : "Freeze...", t, () => confirm(d.frozen ? "unfreeze" : "freeze", this.key))));
    const text = (value, font) => div().min_w(0).truncate().text_size(12.5).when(Boolean(font), (e) => e.font_family(mono()).text_size(12)).child(value || "-");
    const grid = (pairs) => h_flex().gap(14).items_start().children(pairs.map((p) => div().flex_1().min_w(0).child(p)));
    return v_flex().gap(10).child(label("Properties", t))
      .child(grid([this.property("Type", this.menuValue("bakers-type", d.type, "type", t, closed), t), this.property("Recipe", this.menuValue("bakers-recipe", d.recipe, "recipe", t, closed), t)]))
      .child(this.property("Labels", labels, t))
      .child(grid([this.property("Frozen", frozen, t), this.property("Assignee", text("-"), t, true)]))
      .child(grid([this.property("Reviewers", text("-"), t, true), this.property("Parent", text(parent ? `${parent.identifier} ${parent.title}` : "-"), t)]))
      .child(this.property("Branch", text(d.branch_name, true), t))
      .child(this.property("Links", (d.links ?? []).length
        ? v_flex().gap(3).children(d.links.map((l, i) => div().id(`bakers-link-${i}`).truncate().text_size(12.5).text_color(t.accent).cursor_pointer()
          .hover((s) => s.underline()).on_click(() => openLink(l.uri)).child(l.title || l.uri)))
        : text("-"), t));
  }

  activity(events, t) {
    const now = Date.now();
    return v_flex().gap(4).child(label("Activity", t))
      .when(!events.length, (e) => e.child(div().text_size(12.5).text_color(t.dim).child("No activity yet")))
      .children(events.slice(0, 12).map((e) => h_flex().gap(10).items_start()
        .child(div().flex_1().min_w(0).text_size(12.5).child(e.message ?? e.kind))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(ago(e.created, now)))));
  }

  runs(runs, t) {
    const now = Date.now();
    return v_flex().gap(4)
      .child(h_flex().id("bakers-runs").gap(6).items_center().cursor_pointer().on_click((_e, cx) => { this.runsOpen = !this.runsOpen; cx.notify(); })
        .child(svg(`mods/workspace-chrome/chevron-${this.runsOpen ? "down" : "right"}.svg`).size(12).text_color(t.muted))
        .child(div().text_size(12.5).text_color(t.muted).child(`Runs ${runs.length}`)))
      .when(this.runsOpen, (e) => e.children(runs.map((r) => h_flex().pl(18).gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(`${stateLabel(r.state_at_start ?? r.state)}, ${r.agent ?? "agent"}`))
        .child(div().text_size(12).text_color(t.muted).child(r.state))
        .child(div().w(32).flex_none().text_size(12).text_color(t.dim).child(r.started_at ? ago(toUnix(r.started_at), now) : "")))));
  }

  render(cx) {
    const t = theme(), key = focused() ?? this.key;
    this.key = key;
    if (stale(key)) loadTicket(key, cx);
    const detail = store.details[key], d = ticketOf(key), section = agentOf(key, Date.now());
    const root = v_flex().id("bakers-panel").size_full().min_h(0).rounded(10).overflow_hidden().border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground).text_size(13);
    if (!d) return root.child(div().p(14).text_color(t.dim).child(key ? detail?.error ?? "Loading…" : "Open a ticket to see its context here."));
    return root
      .child(h_flex().h(42).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().font_family(mono()).font_semibold().text_size(12.5).child(d.identifier))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child([isClosed(d) ? `closed, ${d.state}` : d.state, d.frozen && "frozen"].filter(Boolean).join(", "))))
      .child(v_flex().id("bakers-panel-body").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(18)
        .when(Boolean(section), (e) => e.child(this.agent(section, t)))
        .child(detail?.data ? this.properties(d, t) : div().text_color(t.dim).child(detail?.error ?? "Loading…"))
        .when(Boolean(detail?.data), (e) => e.child(this.activity(detail.events ?? [], t)).child(this.runs(detail.runs ?? [], t))));
  }
}
