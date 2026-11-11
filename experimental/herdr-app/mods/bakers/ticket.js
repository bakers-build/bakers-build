import { div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { exec, theme, terminals, shared, openOverlay } from "herdr";
import { makeClient } from "./bakers.js";
import { activeRun, agentOf, ago, attention, newestComment, runTerminal, stateLabel, statusLabel, toUnix } from "./derive.js";
import { openLink, openTicket } from "./open.js";
import { button, dot, label, mark, mono, pill, statusColor, tint } from "./ui.js";

const client = makeClient(exec);
const TABS = ["Summary", "Plan", "Runs", "Activity"];
const RUN_DOT = { running: (t) => t.accent, claimed: (t) => t.accent, done: (t) => t.ansi2 };

// The ticket in the right panel: the one last opened on the board, shared("bakers.ticket").
export class Ticket {
  init(_p, cx) {
    this.changed = shared("bakers.changed") ?? null;
    this.show(shared("bakers.ticket") ?? null, cx);
  }

  show(key, cx) {
    Object.assign(this, { key, data: null, runs: [], events: [], conductors: [], error: null, tab: TABS[0] });
    this.load(cx);
  }

  load(cx) {
    const key = this.key;
    if (!key) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const data = await client.ticket(key);
        const [runs, events, conductors] = await Promise.all([client.runs(key), client.activity({ ticket: key }), client.conductors(data.project)]);
        if (key === this.key) Object.assign(this, { data, runs, events, conductors, error: null });
      } catch (e) {
        if (key === this.key) this.error = String(e?.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
  }

  confirm(action) {
    const d = this.data;
    openOverlay({ mod: "bakers", kind: "dialog", width: 440, props: { view: "confirm", action, ticket: d.id, identifier: d.identifier, state: d.state } });
  }

  attentionCard(card, local, t) {
    return v_flex().gap(10).p(14).rounded(10).border_1().border_color(tint(t.blocked, "66")).bg(tint(t.blocked, "14"))
      .child(h_flex().gap(10).items_start()
        .child(div().mt(1).size(16).flex_none().flex().items_center().justify_center().rounded(8).bg(t.blocked)
          .text_size(11).font_semibold().text_color(t.background).child("!"))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().font_semibold().child(card.title))
          .child(div().text_size(12).text_color(t.muted).child(card.body))))
      .child(h_flex().pl(26).gap(8)
        .when(local, (e) => e.child(button("bakers-answer", "Answer in the run", t, () => openTicket(this.key), "primary")))
        .child(button("bakers-read-plan", "Read the plan", t, (cx) => { this.tab = "Plan"; cx.notify(); })));
  }

  agentBlock(agent, local, t) {
    const block = v_flex().gap(6).child(label("Agent", t));
    if (!agent) return block.child(div().text_size(12).text_color(t.dim).child("No active run"));
    return block
      .child(h_flex().gap(8).items_center()
        .child(dot(statusColor(agent.status, t)))
        .child(div().font_semibold().child(agent.name))
        .child(div().text_size(12).text_color(statusColor(agent.status, t)).child(statusLabel(agent.status)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child([agent.where, agent.since].filter(Boolean).join(" · ")))
        .when(local, (e) => e.child(button("bakers-show-agent", "Show agent", t, () => openTicket(this.key)))))
      .when(!local, (e) => e.child(div().text_size(12).text_color(t.dim).child("Its terminal runs outside Herdr.")));
  }

  tabStrip(t) {
    return h_flex().gap(4).border_b(1).border_color(t.border).children(TABS.map((name) => {
      const active = this.tab === name;
      return v_flex().id(`bakers-tab-${name}`).cursor_pointer().on_click((_e, cx) => { this.tab = name; cx.notify(); })
        .child(div().h(28).px(10).flex().items_center().text_color(active ? t.foreground : t.muted).child(name))
        .child(div().h(2).bg(active ? t.accent : t.background));
    }));
  }

  markdown(id, comment, empty, t) {
    return comment
      ? TextView.markdown(id, comment.body ?? "").selectable().on_link_click((url) => openLink(url))
      : div().text_color(t.dim).child(empty);
  }

  runList(t) {
    const now = Date.now();
    if (!this.runs.length) return div().text_color(t.dim).child("No runs yet");
    return v_flex().gap(2).children(this.runs.map((r) => h_flex().py(6).gap(10).items_center()
      .child(dot(RUN_DOT[r.state]?.(t) ?? t.dim))
      .child(div().flex_1().min_w(0).truncate().child(stateLabel(r.state_at_start ?? r.state)))
      .child(div().text_size(12).text_color(t.muted).child(`${r.agent ?? ""} · ${r.state}`))
      .child(div().w(36).flex_none().text_size(12).text_color(t.dim).child(r.started_at ? ago(toUnix(r.started_at), now) : ""))));
  }

  activity(t) {
    const now = Date.now();
    if (!this.events.length) return div().text_color(t.dim).child("No activity yet");
    return v_flex().gap(2).children(this.events.map((e) => h_flex().py(4).gap(10)
      .child(div().flex_1().min_w(0).truncate().child(e.message ?? e.kind))
      .child(div().w(36).flex_none().text_size(12).text_color(t.dim).child(ago(e.created, now)))));
  }

  tabContent(d, t) {
    const comments = d.comments ?? [];
    const content = {
      Summary: () => this.markdown("bakers-summary", newestComment(comments, "summary"), "No summary yet", t),
      Plan: () => this.markdown("bakers-plan", newestComment(comments, "plan"), "No plan yet", t),
      Runs: () => this.runList(t),
      Activity: () => this.activity(t),
    };
    return content[this.tab]();
  }

  links(links, t) {
    return v_flex().gap(6).child(label("Links", t))
      .when(!links.length, (e) => e.child(div().text_size(12).text_color(t.dim).child("None yet")))
      .children(links.map((l, i) => div().id(`bakers-link-${i}`).truncate().text_size(12).text_color(t.accent).cursor_pointer()
        .on_click(() => openLink(l.uri)).child(l.title || l.uri)));
  }

  footer(run, terminal, t) {
    const frozen = Boolean(this.data.frozen);
    return h_flex().h(52).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border)
      .when(Boolean(run), (e) => e.child(button("bakers-cancel", terminal?.run ? `Cancel run #${terminal.run}` : "Cancel run", t, () => this.confirm("cancel"), "danger")))
      .child(button("bakers-freeze", frozen ? "Unfreeze" : "Freeze", t, () => this.confirm(frozen ? "unfreeze" : "freeze")));
  }

  render(cx) {
    const wanted = shared("bakers.ticket") ?? null, changed = shared("bakers.changed") ?? null;
    if (wanted !== this.key) this.show(wanted, cx);
    if (changed !== this.changed) this.load(cx);
    this.changed = changed;
    const t = theme(), d = this.data;
    const header = h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(mark()).child(div().child("Ticket"))
      .child(div().font_family(mono()).text_size(12).text_color(t.muted).child(this.key ?? ""))
      .child(div().flex_1())
      .when(Boolean(this.loading && d), (e) => e.child(div().text_size(11).text_color(t.dim).child("…")));
    const root = v_flex().id("bakers-ticket").size_full().min_h(0).rounded(10).overflow_hidden().border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground).text_size(13).child(header);
    const note = this.key ? this.error ?? "Loading…" : "Open a ticket on the board to see it here.";
    if (!d) return root.child(div().p(14).text_color(this.error ? t.ansi1 : t.dim).child(note));
    const terminal = runTerminal(terminals(), this.key), local = Boolean(terminal), run = activeRun(this.runs);
    const card = attention(d, d.comments, Date.now()), tags = [d.type, d.recipe, d.frozen && "Frozen"].filter(Boolean);
    return root
      .child(v_flex().id("bakers-ticket-body").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(14)
        .child(v_flex().gap(8)
          .child(div().text_size(18).font_semibold().child(d.title ?? ""))
          .child(h_flex().flex_wrap().gap(6).child(pill(d.state ?? "", t, true)).children(tags.map((tag) => pill(tag, t, false))))
          .child(div().font_family(mono()).text_size(12).text_color(t.dim).child(d.branch_name ?? "")))
        .child(this.agentBlock(agentOf(terminal, run, this.conductors, Date.now()), local, t))
        .when(card.kind === "question", (e) => e.child(this.attentionCard(card, local, t)))
        .when(card.kind === "newest", (e) => e.child(div().text_size(12).text_color(t.muted).child(card.title)))
        .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
        .child(this.tabStrip(t))
        .child(this.tabContent(d, t))
        .child(this.links(d.links ?? [], t)))
      .child(this.footer(run, terminal, t));
  }
}
