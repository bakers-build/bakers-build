import test from "node:test";
import assert from "node:assert/strict";
import {
  isClosed, needsMe, planWaits, sidebarViews, viewLabel, statusLine, ticketRows,
  tabName, tabTicket, ticketTab, listTab, listSteps, openSteps, focusedTicket, newlyNeeding, needsToast, askedComment, ticketTabsToClose,
} from "../mods/bakers/derive.js";

const NOW = 1_700_000_000_000;
const secondsAgo = (s) => NOW / 1000 - s;
const ticket = (identifier, state, extra = {}) => ({
  id: `u-${identifier}`, identifier, title: `Title of ${identifier}`, state, labels: [], frozen: false, frozen_at: null, closed: false, ...extra,
});

test("isClosed reads the list's flag, else done and cancelled", () => {
  assert.equal(isClosed({ state: "working", closed: true }), true);
  assert.equal(isClosed({ state: "done" }), true);
  assert.equal(isClosed({ state: "cancelled" }), true);
  assert.equal(isClosed({ state: "review" }), false);
});

test("needsMe gives the reason a ticket needs a person", () => {
  assert.equal(needsMe(ticket("S-1", "working", { frozen: true, labels: ["Question"] }), false), "Asked a question");
  assert.equal(needsMe(ticket("S-2", "working", { frozen: true, labels: ["technical problem"] }), false), "Technical problem");
  assert.equal(needsMe(ticket("S-3", "plan"), true), "Plan ready for approval");
  assert.equal(needsMe(ticket("S-4", "working", { labels: ["Question"] }), false), null, "a question needs the freeze too");
  assert.equal(needsMe(ticket("S-5", "done", { frozen: true, labels: ["Question"], closed: true }), false), null);
});

test("planWaits: a plan comment and no run in plan", () => {
  const plan = [{ type: "plan", body: "x" }];
  assert.equal(planWaits(ticket("S-1", "plan"), null, plan), true);
  assert.equal(planWaits(ticket("S-1", "plan"), { state: "running" }, plan), false);
  assert.equal(planWaits(ticket("S-1", "plan"), null, [{ type: "comment" }]), false);
  assert.equal(planWaits(ticket("S-1", "working"), null, plan), false);
});

test("sidebarViews: the saved views with counts, one row per open state", () => {
  const tickets = [ticket("S-1", "plan"), ticket("S-2", "plan"), ticket("S-3", "working"), ticket("S-4", "pre_deployment"), ticket("S-5", "done", { closed: true })];
  assert.deepEqual(sidebarViews(tickets, ["S-1"]), [
    { id: "needs-me", label: "Needs me", count: 1 },
    { id: "mine", label: "Mine", api: true },
    { id: "open", label: "Open by state", count: 4 },
    { id: "state:qualification", label: "Qualification", count: 0, indent: true },
    { id: "state:plan", label: "Plan", count: 2, indent: true },
    { id: "state:working", label: "Working", count: 1, indent: true },
    { id: "state:review", label: "Review", count: 0, indent: true },
    { id: "state:pre_deployment", label: "Pre deployment", count: 1, indent: true },
    { id: "closed", label: "Recently closed", api: true },
  ]);
});

test("viewLabel names a view", () => {
  assert.equal(viewLabel("needs-me"), "Needs me");
  assert.equal(viewLabel("open"), "Open by state");
  assert.equal(viewLabel("state:plan"), "Plan");
  assert.equal(viewLabel("closed"), "Recently closed");
});

test("statusLine: project, Needs me count and how fresh, or offline", () => {
  assert.deepEqual(statusLine({ project: "acme-shop", needs: 2, updated: NOW - 90_000 }, NOW), { project: "acme-shop", needs: "2 need you", fresh: "updated 1m ago" });
  assert.deepEqual(statusLine({ project: "acme-shop", needs: 1, updated: NOW }, NOW), { project: "acme-shop", needs: "1 needs you", fresh: "updated just now" });
  assert.equal(statusLine({ project: "acme-shop", needs: 0, updated: NOW, error: "Run bakers login first" }, NOW).fresh, "bakers offline");
  assert.equal(statusLine({ project: null, needs: 0, updated: null }, NOW).fresh, "");
});

test("ticketRows lists a view: Needs me longest waiting first, with why, agent and age", () => {
  const tickets = [
    ticket("S-41", "working", { frozen: true, frozen_at: new Date((NOW - 35 * 60_000)).toISOString(), labels: ["Question"] }),
    ticket("S-56", "plan"),
    ticket("S-60", "qualification", { title: "Import legacy customer accounts" }),
    ticket("S-53", "done", { closed: true }),
  ];
  const data = {
    reasons: { "S-41": "Asked a question", "S-56": "Plan ready for approval" },
    events: [{ ticket: "S-56", created: secondsAgo(12 * 60) }, { ticket: "S-60", created: secondsAgo(3600) }],
    agents: { "S-41": { status: "blocked", text: "Claude Code needs you, studio-mac" } },
  };
  const rows = ticketRows(tickets, data, "needs-me", "", false, NOW);
  assert.deepEqual(rows.map((r) => [r.identifier, r.why, r.age]), [["S-41", "Asked a question", "35m"], ["S-56", "Plan ready for approval", "12m"]]);
  assert.deepEqual(rows[0].agent, { status: "blocked", text: "Claude Code needs you, studio-mac" });
  assert.deepEqual(rows[1].agent, { status: null, text: "No active run" });
  assert.deepEqual(ticketRows(tickets, data, "open", "", false, NOW).map((r) => [r.identifier, r.why]),
    [["S-60", "Qualification"], ["S-56", "Plan ready for approval"], ["S-41", "Asked a question"]], "other views show the state unless it needs you");
  assert.deepEqual(ticketRows(tickets, data, "state:plan", "", false, NOW).map((r) => r.identifier), ["S-56"]);
  assert.deepEqual(ticketRows(tickets, data, "mine", "", false, NOW), [], "Mine needs the API");
  assert.deepEqual(ticketRows(tickets, data, "open", "legacy", false, NOW).map((r) => r.identifier), ["S-60"]);
  assert.deepEqual(ticketRows(tickets, data, "open", "s-41", false, NOW).map((r) => r.identifier), ["S-41"]);
  assert.deepEqual(ticketRows(tickets, data, "open", "", true, NOW).map((r) => r.identifier), ["S-60", "S-56", "S-41", "S-53"], "Show closed tickets adds them last");
  assert.equal(ticketRows(tickets, data, "open", "", true, NOW)[3].why, "Done");
});

test("tabName and tabTicket: a ticket tab is named by identifier and state", () => {
  assert.equal(tabName({ identifier: "SHOP-41", state: "working" }), "SHOP-41 working");
  assert.equal(tabName({ identifier: "SHOP-49", state: "done" }), "SHOP-49 closed");
  assert.equal(tabTicket("SHOP-41 working"), "SHOP-41");
  assert.equal(tabTicket("Tickets"), null);
  assert.equal(tabTicket("2"), null);
});

const SPACE = { id: "w1", tabs: [
  { id: "w1:t1", name: "Tickets", active: false, index: 1 },
  { id: "w1:t2", name: "1", active: false, index: 2 },
  { id: "w1:t3", name: "SHOP-41 working", active: true, index: 3 },
  { id: "w1:t4", name: "SHOP-56 plan", active: false, index: 4 },
] };
const PANES = [
  { pane: "p1", tab: "w1:t1", mod: "bakers", terminal: null },
  { pane: "p2", tab: "w1:t2", terminal: "t7" },
  { pane: "p3", tab: "w1:t3", mod: "bakers", terminal: null },
  { pane: "p4", tab: "w1:t4", mod: "bakers", terminal: null },
];

test("ticketTab and listTab find the bakers tabs of a space", () => {
  assert.equal(ticketTab(SPACE, PANES, "SHOP-56").id, "w1:t4");
  assert.equal(ticketTab(SPACE, PANES, "SHOP-99"), null);
  assert.equal(ticketTab(SPACE, PANES.filter((p) => p.pane !== "p4"), "SHOP-56"), null, "a terminal tab named like a ticket is not one");
  assert.equal(ticketTab(SPACE, PANES, null), null);
  assert.equal(listTab(SPACE, PANES).id, "w1:t1");
});

test("listSteps selects the Tickets tab, or makes it first in its space", () => {
  const newTab = ["tab.new", { name: "Tickets", mod: "bakers", props: { view: "list" } }];
  assert.deepEqual(listSteps(SPACE, PANES), [["tab.select", { id: "w1:t1" }]]);
  assert.deepEqual(listSteps({ tabs: [] }, []), [newTab]);
  assert.deepEqual(listSteps(undefined, []), [["space.new", {}], newTab], "with no space open, tab.new needs one first");
  assert.deepEqual(listSteps({ tabs: [{ id: "w1:t9", name: "2" }, { id: "w1:t1", name: "Tickets", index: 2 }] }, PANES), [["tab.move", { id: "w1:t1", index: 1 }], ["tab.select", { id: "w1:t1" }]]);
});

test("openSteps: Enter previews, cmd-Enter pins, an open ticket keeps its one tab", () => {
  assert.deepEqual(openSteps(SPACE, PANES, "SHOP-41", "SHOP-41 working", null, false), { steps: [["tab.select", { id: "w1:t3" }]], preview: null });
  assert.deepEqual(openSteps(SPACE, PANES, "SHOP-60", "SHOP-60 qualification", "SHOP-56", false), {
    steps: [["tab.rename", { id: "w1:t4", name: "SHOP-60 qualification" }], ["tab.select", { id: "w1:t4" }]], preview: "SHOP-60",
  }, "the next Enter reuses the preview tab");
  assert.deepEqual(openSteps(SPACE, PANES, "SHOP-60", "SHOP-60 qualification", null, false), {
    steps: [["tab.new", { name: "SHOP-60 qualification", mod: "bakers", props: { view: "ticket", preview: true } }]], preview: "SHOP-60",
  });
  assert.deepEqual(openSteps(SPACE, PANES, "SHOP-60", "SHOP-60 qualification", "SHOP-56", true), {
    steps: [["tab.new", { name: "SHOP-60 qualification", mod: "bakers", props: { view: "ticket", ticket: "SHOP-60" } }]], preview: "SHOP-56",
  }, "cmd-Enter leaves the preview tab alone");
  assert.deepEqual(openSteps(SPACE, PANES, "SHOP-56", "SHOP-56 plan", "SHOP-56", true), { steps: [["tab.select", { id: "w1:t4" }]], preview: null }, "cmd-Enter on the preview's ticket pins it");
  assert.deepEqual(openSteps(undefined, [], "SHOP-60", "SHOP-60 plan", null, true).steps[0], ["space.new", {}]);
});

test("focusedTicket follows the active tab: a ticket tab, the list's selection, or a run's terminal", () => {
  assert.equal(focusedTicket(SPACE, PANES, [], "SHOP-56"), "SHOP-41");
  const on = (id) => ({ ...SPACE, tabs: SPACE.tabs.map((t) => ({ ...t, active: t.id === id })) });
  assert.equal(focusedTicket(on("w1:t1"), PANES, [], "SHOP-56"), "SHOP-56");
  const terminals = [{ address: "t7", labels: { "bakers.ticket": "SHOP-41" } }];
  assert.equal(focusedTicket(on("w1:t2"), PANES, terminals, null), "SHOP-41");
  assert.equal(focusedTicket(on("w1:t2"), PANES, [], null), null);
  assert.equal(focusedTicket(undefined, PANES, [], null), null);
});

test("newlyNeeding: only tickets that start to need you, nothing on the first load", () => {
  assert.deepEqual(newlyNeeding(null, { "S-1": "Asked a question" }), []);
  assert.deepEqual(newlyNeeding(["S-1"], { "S-1": "Asked a question", "S-2": "Plan ready for approval" }), [["S-2", "Plan ready for approval"]]);
});

test("needsToast says who needs you and opens its tab on click", () => {
  assert.deepEqual(needsToast("SHOP-41", "Asked a question", "Should an empty cart redirect?"), {
    title: "SHOP-41 asks a question", body: "Should an empty cart redirect?", level: "warning", action: { name: "bakers.open:SHOP-41" },
  });
  assert.equal(needsToast("SHOP-56", "Plan ready for approval", "x").title, "SHOP-56 has a plan ready for approval");
  assert.equal(needsToast("SHOP-57", "Technical problem", "x").title, "SHOP-57 reports a technical problem");
});

test("askedComment: the agent's newest question, else its newest comment", () => {
  const comments = [
    { type: "summary", created: "2026-11-11T10:00:00Z", body: "old" },
    { type: "question", created: "2026-11-11T11:00:00Z", body: "Which carrier?\nMore" },
    { type: "comment", created: "2026-11-11T12:00:00Z", body: "later remark" },
  ];
  assert.equal(askedComment(comments).body, "Which carrier?\nMore");
  assert.equal(askedComment(comments.filter((c) => c.type !== "question")).body, "later remark");
  assert.equal(askedComment([]), null);
});

test("ticketTabsToClose: only tabs that hold nothing but a ticket, so no run's terminal ends", () => {
  const space = { tabs: [
    { id: "t1", name: "Tickets" }, { id: "t2", name: "SHOP-41 working" }, { id: "t3", name: "SHOP-49 closed" },
    { id: "t4", name: "SHOP-50 closed" }, { id: "t5", name: "1" },
  ] };
  const panes = [
    { tab: "t1", mod: "bakers" }, { tab: "t2", mod: "bakers" }, { tab: "t3", mod: "bakers" },
    { tab: "t4", mod: "bakers" }, { tab: "t4", terminal: "t7" }, { tab: "t5", terminal: "t8" },
  ];
  assert.deepEqual(ticketTabsToClose(space, panes, true), ["t3"]);
  assert.deepEqual(ticketTabsToClose(space, panes, false), ["t2", "t3"]);
});
