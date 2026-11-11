import test from "node:test";
import assert from "node:assert/strict";
import { DIALOGS, WRITES, stateMenu, questionLabel } from "../mods/bakers/flows.js";

// A fake bakers client and hc: record every call, fail where asked. No call reaches the tracker.
function fakeIo(fail = {}) {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push([name, ...args]);
    if (fail[name]) throw new Error(fail[name]);
    return name === "create" ? { identifier: "SHOP-63", id: "u-63", state: "qualification" } : {};
  };
  const client = Object.fromEntries(["comment", "update", "transition", "classify", "cancelRun", "create"].map((n) => [n, record(n)]));
  const hc = async (args) => {
    calls.push(["hc", args]);
    return fail.hc ? { code: 1, stdout: "", stderr: `${fail.hc}\nmore` } : { code: 0, stdout: "{}", stderr: "" };
  };
  return { io: { client, hc }, calls };
}

const T41 = { id: "u-41", identifier: "SHOP-41", state: "working", branch_name: "shop-41-checkout-empty-cart", labels: ["Question", "checkout"], frozen: true };
const T56 = { id: "u-56", identifier: "SHOP-56", state: "plan", branch_name: "shop-56-show-delivery-date", labels: [], frozen: false };
const CI = { uuid: "c-ci", label: "ci-box", status: "online" };
const VPS = { id: "build-vps", label: "build-vps", mine: true, here: false, url: "ssh://deploy@vps.acme.internal", load: "0 of 2 busy" };

test("comment posts a comment; an empty one never leaves", async () => {
  const { io, calls } = fakeIo();
  await WRITES.comment(io, T41, { body: "  Agreed  " });
  assert.deepEqual(calls, [["comment", "u-41", "Agreed"]]);
  await assert.rejects(WRITES.comment(io, T41, { body: "  " }), { message: "Write something first." });
  assert.equal(calls.length, 1);
});

test("answer comments, then unfreezes and removes the label Question in one update", async () => {
  const { io, calls } = fakeIo();
  await WRITES.answer(io, T41, { body: "Show the empty-cart page.", unfreeze: true });
  assert.deepEqual(calls, [["comment", "u-41", "Show the empty-cart page."], ["update", "u-41", { frozen: false, labels_remove: ["Question"] }]]);
  const just = fakeIo();
  await WRITES.answer(just.io, T41, { body: "Thinking", unfreeze: false });
  assert.deepEqual(just.calls, [["comment", "u-41", "Thinking"]]);
});

test("questionLabel keeps the ticket's own spelling", () => {
  assert.equal(questionLabel({ labels: ["question", "ui"] }), "question");
  assert.equal(questionLabel({ labels: [] }), "Question");
});

test("request changes is a comment; the state stays", async () => {
  const { io, calls } = fakeIo();
  await WRITES.requestChanges(io, T56, { body: "Keep the cache at 1 h." });
  assert.deepEqual(calls, [["comment", "u-56", "Keep the cache at 1 h."]]);
});

test("save sends only what changed, never an empty title", async () => {
  const { io, calls } = fakeIo();
  const ticket = { ...T56, title: "Old", description: "Body" };
  await WRITES.save(io, ticket, { title: "New", description: "Body" });
  await WRITES.save(io, ticket, { title: "Old", description: "Body" });
  await WRITES.save(io, ticket, { title: "Old", description: "Other" });
  assert.deepEqual(calls, [["update", "u-56", { title: "New" }], ["update", "u-56", { description: "Other" }]]);
  await assert.rejects(WRITES.save(io, ticket, { title: " ", description: "Body" }), { message: "A ticket needs a title." });
});

test("type, recipe and labels save on change, each its own call", async () => {
  const { io, calls } = fakeIo();
  await WRITES.classify(io, T56, { type: "bug" });
  await WRITES.classify(io, T56, { recipe: "matt" });
  await WRITES.addLabel(io, T56, { name: "checkout" });
  await WRITES.removeLabel(io, T56, { name: "ui" });
  assert.deepEqual(calls, [
    ["classify", "u-56", { type: "bug" }], ["classify", "u-56", { recipe: "matt" }],
    ["update", "u-56", { labels_add: ["checkout"] }], ["update", "u-56", { labels_remove: ["ui"] }],
  ]);
});

test("create sends the filled fields, the project's workflow, and returns the new ticket", async () => {
  const { io, calls } = fakeIo();
  const made = await WRITES.create(io, null, { title: " Show stock ", project: "p1", workflow: "bb_work", type: "feature", recipe: "", parent: "SHOP-40", description: "" });
  assert.equal(made.identifier, "SHOP-63");
  assert.deepEqual(calls, [["create", { title: "Show stock", project: "p1", workflow: "bb_work", type: "feature", parent: "SHOP-40" }]]);
  await assert.rejects(WRITES.create(io, null, { title: "", project: "p1", workflow: "bb_work" }), { message: "A ticket needs a title." });
  await assert.rejects(WRITES.create(io, null, { title: "T", project: "p1", workflow: null }), { message: "No workflow known for this project yet: open one of its tickets first." });
});

test("stateMenu lists every state; the server refuses what the workflow forbids", () => {
  assert.deepEqual(stateMenu("plan").map((s) => [s.label, Boolean(s.current), Boolean(s.earlier)]), [
    ["Qualification...", false, true], ["Plan", true, false], ["Working...", false, false],
    ["Review...", false, false], ["Done...", false, false], ["Cancelled...", false, false],
  ]);
  assert.equal(stateMenu("pre_deployment").at(-1).label, "Pre deployment");
});

test("state dialog: the consequence in one sentence, comment then transition", async () => {
  const d = DIALOGS.state({ ticket: T56, target: "working" });
  assert.equal(d.title, "Move SHOP-56 to working?");
  assert.deepEqual([d.from, d.to], ["plan", "working"]);
  assert.equal(d.body, "A conductor picks SHOP-56 up and the agent starts coding on branch shop-56-show-delivery-date. You can move it back to plan later.");
  assert.deepEqual([d.yes, d.no, d.esc, d.primaryFirst, d.enter], ["Move to working", "Keep in plan", "Esc keeps it in plan", false, "yes"]);
  assert.equal(d.field.label, "Comment, optional, posted with the change");
  const { io, calls } = fakeIo();
  await d.run(io, { text: "Plan approved." });
  assert.deepEqual(calls, [["comment", "u-56", "Plan approved."], ["transition", "u-56", "working"]]);
  const quiet = fakeIo();
  await d.run(quiet.io, { text: " " });
  assert.deepEqual(quiet.calls, [["transition", "u-56", "working"]]);
  for (const [target, body] of [
    ["qualification", "The agent qualifies SHOP-56 again before anything else happens."],
    ["plan", "A run writes a new plan for SHOP-56; the old plan stays in Comments."],
    ["review", "The review run or a reviewer checks branch shop-56-show-delivery-date."],
    ["done", "This closes SHOP-56. A closed ticket cannot be changed any more."],
    ["cancelled", "This closes SHOP-56. A closed ticket cannot be changed any more."],
  ]) assert.equal(DIALOGS.state({ ticket: T56, target }).body, body);
  assert.equal(DIALOGS.state({ ticket: T56, target: "done" }).primaryFirst, true, "closing puts the primary first");
});

test("freeze and unfreeze keep by default; cancel run takes a reason", async () => {
  const freeze = DIALOGS.freeze({ ticket: T56 });
  assert.deepEqual([freeze.title, freeze.body, freeze.yes, freeze.no, freeze.enter], [
    "Freeze SHOP-56?", "No conductor picks it up while it is frozen. A run that is already running continues until it ends.", "Freeze", "Keep", "no",
  ]);
  const unfreeze = DIALOGS.unfreeze({ ticket: T41 });
  assert.deepEqual([unfreeze.title, unfreeze.yes, unfreeze.no], ["Unfreeze SHOP-41?", "Unfreeze", "Keep frozen"]);
  const cancel = DIALOGS.cancel({ ticket: T41 });
  assert.equal(cancel.title, "Cancel the running run on SHOP-41?");
  const { io, calls } = fakeIo();
  await freeze.run(io, {});
  await unfreeze.run(io, {});
  await cancel.run(io, { text: "" });
  await cancel.run(io, { text: "Wrong branch" });
  assert.deepEqual(calls, [
    ["update", "u-56", { frozen: true }], ["update", "u-41", { frozen: false }],
    ["cancelRun", "u-41", "Cancelled from Herdr"], ["cancelRun", "u-41", "Wrong branch"],
  ]);
});

test("run on: the consequence names machine and state; offline says when it starts", async () => {
  const d = DIALOGS["run-on"]({ ticket: T56, conductor: CI, machine: VPS });
  assert.equal(d.title, "Run SHOP-56 on ci-box?");
  assert.deepEqual([d.from, d.to, d.extra], ["no conductor", "ci-box, build-vps", "online, 0 of 2 busy"]);
  assert.equal(d.body, "A run starts at once in state plan on build-vps. If SHOP-56 has no assignee yet, it becomes you, the owner of ci-box. You can move or cancel the run later.");
  assert.deepEqual([d.yes, d.no, d.esc, d.enter], ["Run on ci-box", "Keep without a run", "Esc keeps it without a run", "yes"]);
  const offline = DIALOGS["run-on"]({ ticket: T56, conductor: { ...CI, status: "offline" }, machine: { ...VPS, mine: false } });
  assert.equal(offline.body, "The run starts when ci-box is back online, in state plan. You can move or cancel the run later.");
  assert.equal(offline.extra, "offline");
  const { io, calls } = fakeIo();
  await d.run(io, {});
  assert.deepEqual(calls, [["update", "u-56", { conductor: "c-ci" }]]);
});

test("move: cancel first, then start; a failed start says the run is cancelled", async () => {
  const studio = { uuid: "c-studio", label: "studio-mac", status: "online" };
  const d = DIALOGS.move({ ticket: T41, from: studio, since: "35m", conductor: CI, machine: VPS });
  assert.equal(d.title, "Move SHOP-41 to ci-box?");
  assert.deepEqual([d.from, d.to], ["studio-mac, running 35m", "ci-box, build-vps"]);
  assert.equal(d.body, "First the running run on studio-mac is cancelled; its work stays in the worktree on branch shop-41-checkout-empty-cart. Then a run starts at once on ci-box in state working. The agent there begins from the branch, not from the old run's conversation.");
  assert.deepEqual([d.field.label, d.field.placeholder], ["Reason, optional, recorded on the cancelled run", "Moved to ci-box from Herdr"]);
  assert.deepEqual([d.yes, d.no, d.esc, d.chip], ["Cancel and run on ci-box", "Keep on studio-mac", "Esc keeps it on studio-mac", "needs API: one move call"]);
  const { io, calls } = fakeIo();
  await d.run(io, { text: "" });
  assert.deepEqual(calls, [["cancelRun", "u-41", "Moved to ci-box from Herdr"], ["update", "u-41", { conductor: "c-ci" }]]);
  const half = fakeIo({ update: "Conductor is not active" });
  await assert.rejects(d.run(half.io, { text: "Needs the toolchain" }), (e) => e.moveFailed === "ci-box" && e.message === "Run cancelled, not started on ci-box: Conductor is not active");
  assert.deepEqual(half.calls.map((c) => c[0]), ["cancelRun", "update"]);
  const none = fakeIo({ cancelRun: "No run" });
  await assert.rejects(d.run(none.io, { text: "" }), { message: "No run" });
  assert.deepEqual(none.calls.map((c) => c[0]), ["cancelRun"], "nothing starts when the cancel fails");
});

test("stop dispatch clears the conductor; a running run stays", async () => {
  const d = DIALOGS.stop({ ticket: T56, conductor: CI });
  assert.deepEqual([d.title, d.yes, d.no, d.esc], ["Stop dispatch for SHOP-56?", "Stop dispatch", "Keep ci-box", "Esc keeps ci-box"]);
  assert.equal(d.body, "ci-box is cleared as its conductor. No new run starts until one is set again. A run that is already running is not stopped; Cancel run... does that.");
  const { io, calls } = fakeIo();
  await d.run(io, {});
  assert.deepEqual(calls, [["update", "u-56", { conductor: null }]]);
});

test("add machine shows what Herdr runs and runs exactly that", async () => {
  const d = DIALOGS["add-machine"]({ ticket: T56, machine: VPS });
  assert.equal(d.title, "Add machine build-vps?");
  assert.equal(d.body, "Herdr does not know build-vps yet. It connects over SSH and lists the machine's terminals; then the run's terminal of SHOP-56 opens beside the ticket. The machine stays in Herdr's list.");
  assert.deepEqual(d.rows, [["Machine", "build-vps"], ["Connection", "ssh deploy@vps.acme.internal"], ["Herdr runs", "hc machine add deploy@vps.acme.internal --name build-vps"]]);
  assert.deepEqual([d.yes, d.no, d.esc], ["Add and show", "Not now", "Esc: nothing is added"]);
  const { io, calls } = fakeIo();
  await d.run(io, {});
  assert.deepEqual(calls, [["hc", ["machine", "add", "deploy@vps.acme.internal", "--name", "build-vps", "--json"]]]);
  const failed = fakeIo({ hc: "ssh: connect to host vps.acme.internal port 22: Connection refused" });
  await assert.rejects(d.run(failed.io, {}), { message: "ssh: connect to host vps.acme.internal port 22: Connection refused" });
});

test("each dialog names what happened, for the toast after it", () => {
  const studio = { uuid: "c-studio", label: "studio-mac", status: "online" };
  assert.deepEqual([
    DIALOGS.state({ ticket: T56, target: "working" }).done, DIALOGS.freeze({ ticket: T56 }).done, DIALOGS.unfreeze({ ticket: T56 }).done,
    DIALOGS.cancel({ ticket: T41 }).done, DIALOGS["run-on"]({ ticket: T56, conductor: CI, machine: VPS }).done,
    DIALOGS.move({ ticket: T41, from: studio, since: "35m", conductor: CI, machine: VPS }).done, DIALOGS.stop({ ticket: T56, conductor: CI }).done,
    DIALOGS["add-machine"]({ ticket: T56, machine: VPS }).done,
  ], [
    "SHOP-56 moved to working", "SHOP-56 frozen", "SHOP-56 unfrozen", "Run on SHOP-41 cancelled", "SHOP-56 runs on ci-box",
    "SHOP-41 moved to ci-box", "Dispatch stopped for SHOP-56", "build-vps added to Herdr",
  ]);
});
