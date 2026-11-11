import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, shared, setShared, terminals } from "herdr";
import { makeClient } from "./bakers.js";
import { ago, boardColumns, conductorLabel, resolveProject } from "./derive.js";
import { openTicket } from "./open.js";

const REFRESH_MS = 60000;
const client = makeClient(exec);

// The Tickets board: one column per open workflow state, "Needs you" first.
export class Board {
  init(p, cx) {
    this.project = p.project ?? shared("bakers.project") ?? null;
    this.projectName = null;
    this.tickets = []; this.conductors = []; this.events = []; this.projects = [];
    this.generation = 0; this.error = null; this.loading = false; this.updated = null;
    this.changed = shared("bakers.changed") ?? null;
    this.filter = InputState.new({ placeholder: "Filter tickets" });
    this.filter.on("change", (_e, cx) => cx.notify());
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    // Keeps "Updated … ago" current without asking bakers.
    cx.timer.every(15000, (cx) => cx.notify());
  }

  refresh(cx) {
    const generation = ++this.generation, project = this.project, needName = !this.projectName;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        let uuid = project;
        if (!project || needName) {
          const projects = await client.projects(), hit = resolveProject(projects, project);
          if (generation === this.generation) {
            this.projects = projects;
            this.projectName = hit?.name ?? null;
            if (hit) this.project = hit.uuid;
          }
          uuid = hit?.uuid ?? project;
        }
        if (uuid) {
          const [tickets, conductors, events] = await Promise.all([client.allTickets(uuid), client.conductors(uuid), client.activity({ project: uuid })]);
          if (generation === this.generation) Object.assign(this, { tickets, conductors, events, updated: Date.now() });
        }
        if (generation === this.generation) this.error = null;
      } catch (e) {
        if (generation === this.generation) this.error = String(e?.message ?? e);
      } finally {
        if (generation === this.generation) this.loading = false;
        cx.notify();
      }
    });
    cx.notify();
  }

  pick(project, cx) {
    setShared("bakers.project", project.uuid);
    Object.assign(this, { project: project.uuid, projectName: project.name, tickets: [], conductors: [], events: [] });
    this.refresh(cx);
  }

  statusText() {
    if (this.error) return this.error;
    if (!this.updated) return this.loading ? "Loading…" : "";
    const since = ago(this.updated / 1000, Date.now());
    return since === "now" ? "Updated just now" : `Updated ${since} ago`;
  }

  chip(c, t) {
    const online = c.status === "online";
    return h_flex().id(`bakers-chip-${c.uuid}`).h(30).px(10).gap(8).flex_none().items_center().rounded(8).border_1().border_color(t.border)
      .child(div().w(8).h(8).rounded(4).bg(online ? t.ansi2 : t.dim))
      .child(div().child(conductorLabel(c)))
      .child(div().text_size(12).text_color(t.muted).child(c.status ?? "offline"));
  }

  toolbar(t) {
    return h_flex().h(52).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().child(this.projectName ?? "Tickets"))
      .child(div().w(260).flex_none().h(30).px(10).flex().items_center().rounded(8).border_1().border_color(t.border).bg(t.raised)
        .child(Input.new(this.filter).h_full().text_size(12).text_color(t.foreground)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(this.error ? t.ansi1 : t.dim).child(this.statusText()))
      .children(this.conductors.map((c) => this.chip(c, t)))
      .child(div().id("bakers-refresh").flex_none().px(8).h(28).flex().items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.muted)
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.refresh(cx)).child(this.loading ? "…" : "Refresh"));
  }

  card(card, urgent, t) {
    return v_flex().id(`bakers-card-${card.identifier}`).flex_none().p(12).gap(8).rounded(10).border_1()
      .border_color(urgent ? t.blocked : t.border).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => openTicket(card.identifier))
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(12).text_color(t.muted).child(card.identifier))
        .child(div().flex_1())
        .when(card.runningHere, (e) => e.child(div().px(6).h(18).flex().items_center().rounded(5).border_1().border_color(t.border)
          .text_size(11).text_color(t.muted).child("Running here"))))
      .child(div().child(card.title))
      .when(Boolean(card.reason || card.age), (e) => e.child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(card.reason ?? ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(card.age ?? ""))));
  }

  column(c, t) {
    return v_flex().id(`bakers-col-${c.id}`).w(260).flex_none().h_full().min_h(0).gap(8)
      .child(h_flex().px(4).gap(8).items_center()
        .child(div().font_semibold().child(c.label))
        .child(div().text_color(t.dim).child(String(c.cards.length))))
      .child(v_flex().id(`bakers-cards-${c.id}`).flex_1().min_h(0).overflow_y_scrollbar().gap(8)
        .children(c.cards.map((card) => this.card(card, c.id === "needs-you", t))));
  }

  projectPicker(t) {
    const note = this.error ?? (this.projects.length ? "" : "Loading…");
    return v_flex().id("bakers-projects").p(16).gap(6).max_w(420)
      .child(div().px(10).font_semibold().child("Choose a bakers project"))
      .when(Boolean(note), (e) => e.child(div().px(10).text_size(12).text_color(this.error ? t.ansi1 : t.dim).child(note)))
      .children(this.projects.map((p) => h_flex().id(`bakers-project-${p.uuid}`).h(32).px(10).gap(8).items_center().rounded(8).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(p, cx))
        .child(div().child(p.name)).child(div().text_size(12).text_color(t.dim).child(p.key))));
  }

  render(cx) {
    const changed = shared("bakers.changed") ?? null;
    if (changed !== this.changed) {
      this.changed = changed;
      this.refresh(cx);
    }
    const t = theme();
    const root = v_flex().id("bakers-board").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13);
    if (!this.project) return root.child(this.projectPicker(t));
    const columns = boardColumns(this.tickets, this.events, terminals(), this.filter.value(), Date.now());
    const empty = this.error ?? (this.loading ? "Loading…" : "No open tickets");
    return root.child(this.toolbar(t)).child(
      h_flex().id("bakers-columns").flex_1().min_h(0).overflow_x_scrollbar().p(16).gap(12)
        .children(columns.map((c) => this.column(c, t)))
        .when(!columns.length, (e) => e.child(div().text_color(this.error ? t.ansi1 : t.dim).child(empty))));
  }
}
