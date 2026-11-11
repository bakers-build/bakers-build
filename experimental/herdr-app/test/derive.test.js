import test from "node:test";
import assert from "node:assert/strict";
import {
  STATE_ORDER, stateLabel, terminalLabel, runTerminal, toUnix, ago,
  activeRun, newestComment, friendlyError, safeUrl, resolveProject, conductorLabel,
  statusLabel, claudeColor, CONFIRM, machineIdOf,
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
    { address: "t3", status: "working", program: { name: "Claude Code" }, labels: ["bakers.ticket=SHOP-56", "bakers.run=412"] },
  ];
  assert.deepEqual(runTerminal(terminals, "SHOP-56"), { address: "t3", run: "412", status: "working", name: "Claude Code" });
  assert.equal(runTerminal(terminals, "SHOP-60"), null);
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

test("statusLabel says blocked as needs you", () => {
  assert.equal(statusLabel("blocked"), "needs you");
  assert.equal(statusLabel("working"), "working");
});

test("claudeColor takes Claude Code's colors for the theme's brightness", () => {
  assert.equal(claudeColor("working", "#1e1e1e"), "#d77757");
  assert.equal(claudeColor("blocked", "#1e1e1e"), "#b1b9f9");
  assert.equal(claudeColor("idle", "#1e1e1e"), "#999999");
  assert.equal(claudeColor("done", "#1e1e1e"), "#4eba65");
  assert.equal(claudeColor("blocked", "#ffffff"), "#5769f7");
  assert.equal(claudeColor("starting", "#1e1e1e"), null);
});

test("CONFIRM runs the confirmed action on the ticket", async () => {
  const calls = [];
  const client = { cancelRun: async (...a) => calls.push(["cancel", ...a]), update: async (...a) => calls.push(["update", ...a]) };
  await CONFIRM.cancel.run(client, "u1", "Wrong branch");
  await CONFIRM.freeze.run(client, "u1");
  await CONFIRM.unfreeze.run(client, "u1");
  assert.deepEqual(calls, [["cancel", "u1", "Wrong branch"], ["update", "u1", { frozen: true }], ["update", "u1", { frozen: false }]]);
  assert.equal(CONFIRM.cancel.title("SHOP-56"), "Cancel the running run on SHOP-56?");
  assert.equal(CONFIRM.cancel.reason, true);
  assert.equal(CONFIRM.freeze.reason, undefined);
});

test("friendlyError reads the message of a bakers error object", () => {
  const output = '{"error":{"code":"E_TOOL","message":"Invalid input: Project 0000 does not exist or is not readable."}}';
  assert.equal(friendlyError(output), "Invalid input: Project 0000 does not exist or is not readable.");
});

test("machineIdOf reads this computer's machine_id from the bakers machine config", () => {
  assert.equal(machineIdOf('module.exports = {\n  machine_id: "MBP-von-Pascal",\n  label: "x",\n};'), "MBP-von-Pascal");
  assert.equal(machineIdOf("export default { machine_id: 'studio-mac' }"), "studio-mac");
  assert.equal(machineIdOf(null), null);
  assert.equal(machineIdOf("{}"), null);
});
