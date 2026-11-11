import test from "node:test";
import assert from "node:assert/strict";
import {
  STATE_ORDER, stateLabel, terminalLabel, runTerminal, needsYou, toUnix, ago, boardColumns,
  activeRun, newestComment, attention, openPlan, friendlyError, safeUrl, resolveProject, conductorLabel,
  needsYouCount, boardSteps, machineOf, CONFIRM,
} from "../mods/bakers/derive.js";

const NOW = 1_700_000_000_000;
const secondsAgo = (s) => NOW / 1000 - s;

test("STATE_ORDER and stateLabel", () => {
  assert.deepEqual(STATE_ORDER, ["qualification", "plan", "working", "review"]);
  assert.equal(stateLabel("plan"), "Plan");
  assert.equal(stateLabel("pre_deployment"), "Pre deployment");
});

test("terminalLabel reads object and list labels", () => {
  assert.equal(terminalLabel({ labels: { "bakers.ticket": "SHOP-56" } }, "bakers.ticket"), "SHOP-56");
  assert.equal(terminalLabel({ labels: ["bakers.ticket=SHOP-56", "bakers.run=412"] }, "bakers.ticket"), "SHOP-56");
  assert.equal(terminalLabel({}, "bakers.ticket"), null);
});

test("runTerminal finds the live run", () => {
  const terminals = [
    { address: "t1", labels: { "bakers.ticket": "SHOP-55" } },
    { address: "t2", state: "exited", labels: { "bakers.ticket": "SHOP-56" } },
    { address: "t3", labels: ["bakers.ticket=SHOP-56", "bakers.run=412"] },
  ];
  assert.deepEqual(runTerminal(terminals, "SHOP-56"), { address: "t3", run: "412" });
  assert.equal(runTerminal(terminals, "SHOP-60"), null);
});

test("needsYou needs frozen and the label", () => {
  assert.equal(needsYou({ frozen: true, labels: ["question"] }), "Question");
  assert.equal(needsYou({ frozen: true, labels: ["Technical Problem"] }), "Technical problem");
  assert.equal(needsYou({ frozen: false, labels: ["Question"] }), null);
  assert.equal(needsYou({ frozen: true, labels: [] }), null);
});

test("toUnix reads unix seconds and ISO dates", () => {
  assert.equal(toUnix(1_700_000_000), 1_700_000_000);
  assert.equal(toUnix("2023-11-14T22:13:20Z"), 1_700_000_000);
  assert.ok(Number.isNaN(toUnix("not a date")));
});

test("ago", () => {
  assert.equal(ago(secondsAgo(30), NOW), "now");
  assert.equal(ago(secondsAgo(300), NOW), "5m");
  assert.equal(ago(secondsAgo(3 * 3600), NOW), "3h");
  assert.equal(ago(secondsAgo(2 * 86400), NOW), "2d");
});

const ticket = (identifier, state, extra = {}) => ({
  id: `u-${identifier}`, identifier, title: `Title of ${identifier}`, state, labels: [], frozen: false, frozen_at: null, closed: false, ...extra,
});

test("boardColumns orders, hides and explains", () => {
  const tickets = [
    ticket("SHOP-49", "review"),
    ticket("SHOP-56", "plan", { frozen: true, labels: ["Question"] }),
    ticket("SHOP-60", "qualification", { title: "Import legacy customer accounts" }),
    ticket("SHOP-61", "pre_deployment"),
    ticket("SHOP-62", "working", { frozen: true }),
    ticket("SHOP-53", "done", { closed: true }),
  ];
  const events = [{ ticket: "SHOP-60", message: "created", created: secondsAgo(3600) }];
  const terminals = [{ address: "t1", labels: { "bakers.ticket": "SHOP-49" } }];
  const columns = boardColumns(tickets, events, terminals, "", NOW);
  assert.deepEqual(columns.map((c) => c.id), ["needs-you", "qualification", "working", "review", "pre_deployment"]);
  assert.deepEqual(columns.map((c) => c.label), ["Needs you", "Qualification", "Working", "Review", "Pre deployment"]);
  const card = (id) => columns.flatMap((c) => c.cards).find((c) => c.identifier === id);
  assert.equal(card("SHOP-56").reason, "Question");
  assert.equal(columns[0].cards[0].identifier, "SHOP-56");
  assert.equal(card("SHOP-60").reason, "created");
  assert.equal(card("SHOP-60").age, "1h");
  assert.equal(card("SHOP-49").runningHere, true);
  assert.equal(card("SHOP-60").runningHere, false);
  assert.equal(card("SHOP-62").reason, "Frozen");
  assert.equal(columns.find((c) => c.id === "working").cards[0].identifier, "SHOP-62");
  assert.equal(card("SHOP-53"), undefined);
});

test("boardColumns filters by identifier or title, case-insensitive", () => {
  const tickets = [ticket("SHOP-60", "qualification", { title: "Import legacy customer accounts" }), ticket("SHOP-61", "plan")];
  for (const filter of ["shop-60", "LEGACY"]) {
    const cards = boardColumns(tickets, [], [], filter, NOW).flatMap((c) => c.cards);
    assert.deepEqual(cards.map((c) => c.identifier), ["SHOP-60"]);
  }
});

test("activeRun", () => {
  const running = { state: "running", closed: false };
  assert.equal(activeRun([{ state: "done", closed: true }, running]), running);
  assert.equal(activeRun([{ state: "claimed", closed: false }]).state, "claimed");
  assert.equal(activeRun([]), null);
});

test("newestComment picks the newest of a type", () => {
  const comments = [{ type: "plan", created: 1, body: "a" }, { type: "plan", created: 5, body: "b" }, { type: "summary", created: 9, body: "c" }];
  assert.equal(newestComment(comments, "plan").body, "b");
  assert.equal(newestComment(comments, "spec"), null);
});

test("attention states facts only", () => {
  const frozen = { frozen: true, labels: ["Question"] };
  const asked = [{ type: "summary", created: 1, body: "old" }, { type: "question", created: 2, body: "Which carrier calendar?\nMore text" }];
  assert.deepEqual(attention(frozen, asked, NOW), { kind: "question", title: "Question", body: "Which carrier calendar?" });
  const open = { frozen: false, labels: [] };
  assert.deepEqual(attention(open, [{ type: "plan", created: secondsAgo(180), body: "x" }], NOW), { kind: "newest", title: "Newest: plan, 3m", body: "" });
  assert.equal(attention(open, [], NOW).kind, "none");
});

test("openPlan selects, adopts or opens a tab", () => {
  const terminals = [{ address: "t3", labels: { "bakers.ticket": "SHOP-56", "bakers.run": "412" } }];
  assert.deepEqual(openPlan("SHOP-56", terminals, [{ pane: "w1:p2", terminal: "t3", tab: "w1:t2" }]), { action: "select", tab: "w1:t2" });
  assert.deepEqual(openPlan("SHOP-56", terminals, []), { action: "adopt", terminal: "t3", run: "412" });
  assert.deepEqual(openPlan("SHOP-60", terminals, []), { action: "tab" });
});

test("friendlyError", () => {
  assert.equal(friendlyError("spawn bakers ENOENT"), "bakers is not installed or not on PATH");
  assert.equal(friendlyError("zsh: command not found: bakers"), "bakers is not installed or not on PATH");
  assert.equal(friendlyError("Error: 401 Unauthorized\n    at x"), "Run bakers login first");
  assert.equal(friendlyError("\n  Ticket not found  \nstack"), "Ticket not found");
});

test("safeUrl lets only https through", () => {
  assert.equal(safeUrl("https://example.com/a b"), "https://example.com/a%20b");
  assert.equal(safeUrl("file:///etc/passwd"), null);
  assert.equal(safeUrl("vscode://open"), null);
  assert.equal(safeUrl("--help"), null);
});

test("resolveProject accepts a UUID or a key", () => {
  const projects = [{ uuid: "u-1", key: "SHOP", name: "acme-shop" }];
  assert.deepEqual(resolveProject(projects, "SHOP"), { uuid: "u-1", name: "acme-shop" });
  assert.deepEqual(resolveProject(projects, "u-1"), { uuid: "u-1", name: "acme-shop" });
  assert.equal(resolveProject(projects, "NOPE"), null);
});

test("conductorLabel falls back to the conductor id", () => {
  assert.equal(conductorLabel({ label: "build-vps", conductor_id: "c-1" }), "build-vps");
  assert.equal(conductorLabel({ label: null, conductor_id: "c-1" }), "c-1");
});

test("needsYouCount counts open tickets that need a person", () => {
  const tickets = [
    ticket("SHOP-56", "plan", { frozen: true, labels: ["Question"] }),
    ticket("SHOP-57", "working", { frozen: true }),
    ticket("SHOP-58", "review", { frozen: true, labels: ["technical problem"], closed: true }),
  ];
  assert.equal(needsYouCount(tickets), 1);
});

test("boardSteps selects the board tab, or makes one", () => {
  const space = { tabs: [{ id: "w1:t1", name: "1" }, { id: "w1:t2", name: "Tickets" }, { id: "w1:t3", name: "SHOP-56" }] };
  const panes = [{ tab: "w1:t2", mod: "bakers" }, { tab: "w1:t3", mod: "bakers" }];
  const newTab = ["tab.new", { name: "Tickets", mod: "bakers", props: { view: "board" } }];
  assert.deepEqual(boardSteps(space, panes), [["tab.select", { id: "w1:t2" }]]);
  assert.deepEqual(boardSteps(space, [{ tab: "w1:t2", terminal: "t9" }]), [newTab], "a terminal tab named Tickets is not the board");
  assert.deepEqual(boardSteps(undefined, panes), [["space.new", {}], newTab], "with no space open, tab.new needs one first");
});

test("machineOf names where the ticket's run is", () => {
  const conductors = [{ uuid: "c1", conductor_id: "mac-bakers", label: "rk-mac" }, { uuid: "c2", conductor_id: "vps", label: null }];
  assert.equal(machineOf({ conductor: "c1" }, conductors, true), "This computer");
  assert.equal(machineOf({ conductor: "c1" }, conductors, false), "rk-mac");
  assert.equal(machineOf({ conductor: "c2" }, conductors, false), "vps");
  assert.equal(machineOf(null, conductors, false), null);
});

test("CONFIRM runs the confirmed action on the ticket", async () => {
  const calls = [];
  const client = { cancelRun: async (...a) => calls.push(["cancel", ...a]), setFrozen: async (...a) => calls.push(["frozen", ...a]) };
  await CONFIRM.cancel.run(client, "u1", "Wrong branch");
  await CONFIRM.freeze.run(client, "u1");
  await CONFIRM.unfreeze.run(client, "u1");
  assert.deepEqual(calls, [["cancel", "u1", "Wrong branch"], ["frozen", "u1", true], ["frozen", "u1", false]]);
  assert.equal(CONFIRM.cancel.title("SHOP-56"), "Cancel the running run on SHOP-56?");
  assert.equal(CONFIRM.cancel.reason, true);
  assert.equal(CONFIRM.freeze.reason, undefined);
});

test("friendlyError reads the message of a bakers error object", () => {
  const output = '{"error":{"code":"E_TOOL","message":"Invalid input: Project 0000 does not exist or is not readable."}}';
  assert.equal(friendlyError(output), "Invalid input: Project 0000 does not exist or is not readable.");
});
