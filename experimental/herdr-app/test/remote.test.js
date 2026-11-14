import test from "node:test";
import assert from "node:assert/strict";
import { machineOf, agentSection, showAgentPlan, pickerRows, sshTarget } from "../mods/bakers/remote.js";

const NOW = 1_700_000_000_000;
const minutesAgo = (m) => NOW / 1000 - m * 60;
const CONDUCTORS = [
  { uuid: "c-studio", conductor_id: "studio-mac-shop", label: "studio-mac", active: true, status: "online", machine: "studio" },
  { uuid: "c-ci", conductor_id: "ci-box-shop", label: "ci-box", active: true, status: "online", machine: "build-vps" },
  { uuid: "c-mia", conductor_id: "mia-shop", label: "mia-laptop", active: true, status: "online", machine: "mia-mbp" },
  { uuid: "c-old", conductor_id: "old-ci-shop", label: "old-ci", active: true, status: "offline", machine: "ci-old" },
  { uuid: "c-off", conductor_id: "gone", label: "gone", active: false, status: "offline", machine: null },
];
const MACHINES = [
  { machine_id: "studio", label: "studio-mac", connection_url: null, max_parallel: 2, current_load: 1 },
  { machine_id: "build-vps", label: "build-vps", connection_url: "ssh://deploy@vps.acme.internal", max_parallel: 2, current_load: 2 },
  { machine_id: "ci-old", label: "ci-old", connection_url: null, max_parallel: 1, current_load: 0 },
];
const base = { conductors: CONDUCTORS, machines: MACHINES, local: "studio", herdrMachines: [], nowMs: NOW };
const ticket = (extra) => ({ identifier: "SHOP-56", state: "plan", frozen: false, conductor: null, ...extra });
const run = (conductor, extra) => ({ state: "running", agent: "claude", conductor, started_at: minutesAgo(12), closed: false, ...extra });

test("machineOf: yours with load, here, a teammate's, or not known", () => {
  assert.deepEqual(machineOf(CONDUCTORS[0], MACHINES, "studio"), { id: "studio", label: "studio-mac", mine: true, here: true, url: null, load: "1 of 2 busy", full: false });
  assert.deepEqual(machineOf(CONDUCTORS[2], MACHINES, "studio"), { id: "mia-mbp", label: "mia-mbp", mine: false, here: false, url: null, load: null, full: false });
  assert.equal(machineOf(CONDUCTORS[1], MACHINES, "studio").full, true);
  assert.equal(machineOf({ uuid: "x" }, MACHINES, "studio"), null, "no machine field: the server is older");
  assert.equal(machineOf(CONDUCTORS[1], null, "studio").mine, null, "no machine_list: unknown whose it is");
});

test("agentSection 1: no run, no conductor", () => {
  const s = agentSection({ ...base, ticket: ticket() });
  assert.deepEqual([s.kind, s.status, s.title, s.detail, s.line, s.cell], ["idle", null, "No active run", "no conductor, nothing starts until one is set", "No active run, no conductor", "No active run, no conductor"]);
  assert.deepEqual(s.actions.map((a) => a.id), ["run-on"]);
  assert.equal(s.actions[0].label, "Run on...");
});

test("agentSection 2: running on this computer", () => {
  const s = agentSection({ ...base, ticket: ticket({ conductor: "c-studio" }), run: run("c-studio"), terminal: { address: "t7", status: "working", name: "Claude Code" } });
  assert.deepEqual([s.status, s.title, s.detail, s.line, s.cell], ["working", "Claude Code working", "on studio-mac, this computer, 1 of 2 busy, 12m", "Claude Code working on studio-mac, 12m", "Claude Code working, studio-mac"]);
  assert.deepEqual(s.actions.map((a) => [a.id, a.label, Boolean(a.disabled)]), [["show-agent", "Show agent", false], ["move-to", "Move to...", false], ["cancel-run", "Cancel run...", false]]);
});

test("agentSection 2: Herdr's live status wins, blocked reads needs you", () => {
  const s = agentSection({ ...base, ticket: ticket({ conductor: "c-studio" }), run: run("c-studio"), terminal: { address: "t7", status: "blocked", name: "Claude Code" } });
  assert.equal(s.title, "Claude Code needs you");
});

test("agentSection 3: another machine of yours that Herdr does not know yet", () => {
  const s = agentSection({ ...base, ticket: ticket({ conductor: "c-ci" }), run: run("c-ci", { started_at: minutesAgo(3) }) });
  assert.deepEqual([s.title, s.detail], ["Claude Code working", "on ci-box, build-vps, 2 of 2 busy, 3m"]);
  assert.equal(s.note, "build-vps is not in Herdr yet: Show agent asks to add it first.");
  assert.equal(s.actions[0].disabled, undefined);
});

test("agentSection 3: a run that is claimed reads starting", () => {
  const s = agentSection({ ...base, ticket: ticket({ conductor: "c-ci" }), run: run("c-ci", { state: "claimed", started_at: null }) });
  assert.deepEqual([s.status, s.title, s.detail], ["starting", "Claude Code starting", "on ci-box, build-vps, 2 of 2 busy, claimed just now"]);
});

test("agentSection 4: a teammate's machine keeps Show agent visible but disabled", () => {
  const s = agentSection({ ...base, ticket: ticket({ conductor: "c-mia" }), run: run("c-mia", { started_at: minutesAgo(40) }) });
  assert.equal(s.detail, "on mia-laptop, a teammate's machine, 40m");
  assert.deepEqual(s.actions[0], { id: "show-agent", label: "Show agent", disabled: "Not available: only the machine's owner can connect to it." });
});

test("agentSection 5 and 6: waiting for an offline or a full conductor", () => {
  const offline = agentSection({ ...base, ticket: ticket({ conductor: "c-old" }) });
  assert.deepEqual([offline.kind, offline.status, offline.title, offline.detail], ["waiting", null, "Waiting for old-ci", "offline; the run starts when it is back"]);
  assert.deepEqual(offline.actions.map((a) => a.label), ["Move to...", "Stop dispatch..."]);
  const full = agentSection({ ...base, ticket: ticket({ conductor: "c-ci" }) });
  assert.deepEqual([full.title, full.detail, full.chip], ["Waiting for ci-box", "2 of 2 busy; starts when a slot frees", "derived, no queue field"]);
  const free = agentSection({ ...base, ticket: ticket({ conductor: "c-studio" }) });
  assert.equal(free.detail, "online, 1 of 2 busy; the run starts when it claims SHOP-56");
  const frozen = agentSection({ ...base, ticket: ticket({ conductor: "c-studio", frozen: true }) });
  assert.equal(frozen.detail, "frozen; no conductor picks it up until it is unfrozen");
});

test("agentSection: a failed move says so and offers Run on again", () => {
  const s = agentSection({ ...base, ticket: ticket(), moveFailed: "ci-box" });
  assert.deepEqual([s.kind, s.title, s.actions.map((a) => a.id)], ["idle", "Run cancelled, not started on ci-box", ["run-on"]]);
});

test("showAgentPlan: show the terminal, add your machine, or say why not", () => {
  const ci = machineOf(CONDUCTORS[1], MACHINES, "studio");
  assert.deepEqual(showAgentPlan({ terminal: { address: "build-vps/t7" }, machine: ci, machines: MACHINES, herdrMachines: ["build-vps"] }), { action: "show", terminal: "build-vps/t7" });
  assert.deepEqual(showAgentPlan({ terminal: null, machine: ci, machines: MACHINES, herdrMachines: [] }), { action: "add", machine: ci });
  assert.deepEqual(showAgentPlan({ terminal: null, machine: ci, machines: MACHINES, herdrMachines: ["build-vps"] }), { disabled: "Its terminal runs outside Herdr." });
  assert.deepEqual(showAgentPlan({ terminal: null, machine: machineOf(CONDUCTORS[2], MACHINES, "studio"), machines: MACHINES, herdrMachines: [] }), { disabled: "Not available: only the machine's owner can connect to it." });
  assert.deepEqual(showAgentPlan({ terminal: null, machine: machineOf(CONDUCTORS[0], MACHINES, "studio"), machines: MACHINES, herdrMachines: [] }), { disabled: "Its terminal runs outside Herdr." });
  assert.deepEqual(showAgentPlan({ terminal: null, machine: null, machines: null, herdrMachines: [] }), { disabled: "Needs API: bakers does not list machines yet." });
  assert.deepEqual(showAgentPlan({ terminal: null, machine: { ...ci, url: null }, machines: MACHINES, herdrMachines: [] }), { disabled: "bakers has no connection URL for build-vps." });
});

test("pickerRows: the project's active conductors with machine, status and load", () => {
  assert.deepEqual(pickerRows(CONDUCTORS, MACHINES, "studio", ""), [
    { uuid: "c-studio", label: "studio-mac", machine: "this computer", online: true, status: "online", load: "1 of 2 busy" },
    { uuid: "c-ci", label: "ci-box", machine: "build-vps", online: true, status: "online", load: "2 of 2 busy" },
    { uuid: "c-mia", label: "mia-laptop", machine: "mia-mbp", online: true, status: "online", load: "not yours, no load" },
    { uuid: "c-old", label: "old-ci", machine: "ci-old", online: false, status: "offline", load: "-" },
  ]);
  assert.deepEqual(pickerRows(CONDUCTORS, MACHINES, "studio", "vps").map((r) => r.uuid), ["c-ci"], "typing filters by conductor or machine");
  assert.equal(pickerRows([{ uuid: "x", label: "x", active: true, status: "online" }], null, null, "")[0].machine, null, "no machine field: unknown");
});

test("sshTarget turns a connection URL into what hc machine add takes", () => {
  assert.equal(sshTarget("ssh://deploy@vps.acme.internal"), "deploy@vps.acme.internal");
  assert.equal(sshTarget("ssh deploy@vps.acme.internal"), "deploy@vps.acme.internal");
  assert.equal(sshTarget("deploy@vps.acme.internal:2222"), "deploy@vps.acme.internal:2222");
  assert.equal(sshTarget("ssh://deploy@vps.acme.internal/"), "deploy@vps.acme.internal");
  assert.equal(sshTarget("-oProxyCommand=evil"), null, "never an option");
  assert.equal(sshTarget(null), null);
});

test("agentSection: a ticket from the list has no conductor field, so it does not claim there is none", () => {
  const s = agentSection({ ...base, ticket: { identifier: "SHOP-56", state: "plan", frozen: false } });
  assert.deepEqual([s.title, s.detail, s.line, s.cell], ["No active run", "", "No active run", "No active run"]);
});

test("agentSection: a run's terminal in Herdr that bakers no longer counts as active still shows its live agent", () => {
  const s = agentSection({ ...base, ticket: ticket(), terminal: { address: "t13", status: "idle", name: "Claude Code" } });
  assert.deepEqual([s.kind, s.status, s.title, s.detail, s.line], ["run", "idle", "Claude Code idle", "on this computer", "Claude Code idle on this computer"]);
  assert.deepEqual(s.actions.map((a) => a.id), ["show-agent"]);
});
