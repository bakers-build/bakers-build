import test from "node:test";
import assert from "node:assert/strict";
import { makeClient } from "../mods/bakers/bakers.js";

// A fake herdr exec: answers by tool name (and offset), records every call.
function fakeExec(answer) {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push({ cmd, args });
    const tool = args[1].replace("tool_api__bakers_", ""), data = JSON.parse(args[3]);
    return answer(tool, data);
  };
  return { exec, calls };
}
const ok = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

test("tool sends the documented argv", async () => {
  const { exec, calls } = fakeExec(() => ok({ id: "u1" }));
  assert.deepEqual(await makeClient(exec).tool("ticket_read", { ticket: "u1" }), { id: "u1" });
  assert.deepEqual(calls[0], { cmd: "bakers", args: ["tools", "tool_api__bakers_ticket_read", "--data", "{\"ticket\":\"u1\"}"] });
});

test("allTickets pages to the end", async () => {
  const { exec, calls } = fakeExec((_tool, data) => ok(data.offset === 0 ? { tickets: ["a"], next_offset: 100 } : { tickets: ["b"], next_offset: null }));
  assert.deepEqual(await makeClient(exec).allTickets("p1"), ["a", "b"]);
  assert.deepEqual(calls.map((c) => JSON.parse(c.args[3])), [{ project: "p1", limit: 100, offset: 0 }, { project: "p1", limit: 100, offset: 100 }]);
});

test("tool rejects with a friendly line", async () => {
  const unauthorized = makeClient(fakeExec(() => ({ code: 1, stdout: "", stderr: "Error: 401 Unauthorized\n at x" })).exec);
  await assert.rejects(unauthorized.tool("project_list"), { message: "Run bakers login first" });
  const garbled = makeClient(fakeExec(() => ({ code: 0, stdout: "not json", stderr: "" })).exec);
  await assert.rejects(garbled.tool("project_list"), { message: "not json" });
  const missing = makeClient(async () => { throw new Error("spawn bakers ENOENT"); });
  await assert.rejects(missing.tool("project_list"), { message: "bakers is not installed or not on PATH" });
});

test("list helpers unwrap their arrays", async () => {
  const { exec } = fakeExec(() => ok({ projects: [1], conductors: [2], events: [3], runs: [4], next_offset: null }));
  const client = makeClient(exec);
  assert.deepEqual(await client.projects(), [1]);
  assert.deepEqual(await client.conductors("p1"), [2]);
  assert.deepEqual(await client.activity({ project: "p1" }), [3]);
  assert.deepEqual(await client.runs("u1"), [4]);
});

test("activity asks for the most rows one call allows", async () => {
  const { exec, calls } = fakeExec(() => ok({ events: [] }));
  await makeClient(exec).activity({ project: "p1" });
  assert.deepEqual(JSON.parse(calls[0].args[3]), { limit: 100, project: "p1" });
});

test("machines: the list of your machines, or null while bakers has no machine_list", async () => {
  const listed = makeClient(fakeExec(() => ok({ machines: [{ machine_id: "build-vps" }], next_offset: null })).exec);
  assert.deepEqual(await listed.machines(), [{ machine_id: "build-vps" }]);
  const unknown = { error: { code: "E_VALIDATION", message: "unknown tool 'tool_api__bakers_machine_list'; closest: x" } };
  const old = makeClient(fakeExec(() => ({ code: 1, stdout: JSON.stringify(unknown), stderr: "" })).exec);
  assert.equal(await old.machines(), null);
  const down = makeClient(fakeExec(() => ({ code: 1, stdout: "", stderr: "Error: 401 Unauthorized" })).exec);
  await assert.rejects(down.machines(), { message: "Run bakers login first" });
});

test("search, labels and me read what the popups need", async () => {
  const { exec, calls } = fakeExec((tool) => ok({ ticket_search: { tickets: [1] }, label_list: { labels: [{ name: "ui" }], next_offset: null }, user_read: { name: "pg" } }[tool]));
  const client = makeClient(exec);
  assert.deepEqual(await client.search("deliv", "p1"), [1]);
  assert.deepEqual(await client.labels("w1"), [{ name: "ui" }]);
  assert.deepEqual(await client.me(), { name: "pg" });
  assert.deepEqual(calls.map((c) => [c.args[1], JSON.parse(c.args[3])]), [
    ["tool_api__bakers_ticket_search", { query: "deliv", project: "p1" }],
    ["tool_api__bakers_label_list", { workspace: "w1", limit: 100, offset: 0 }],
    ["tool_api__bakers_user_read", {}],
  ]);
});

test("writes send exactly their arguments", async () => {
  const { exec, calls } = fakeExec(() => ok({}));
  const client = makeClient(exec);
  await client.cancelRun("u1", "Cancelled from Herdr");
  await client.update("u1", { frozen: true });
  await client.transition("u1", "working");
  await client.classify("u1", { type: "bug" });
  await client.comment("u1", "Looks good");
  await client.create({ title: "T", workflow: "bb_work", project: "p1" });
  assert.deepEqual(calls.map((c) => [c.args[1].replace("tool_api__bakers_", ""), JSON.parse(c.args[3])]), [
    ["run_cancel", { ticket: "u1", reason: "Cancelled from Herdr" }],
    ["ticket_update", { ticket: "u1", frozen: true }],
    ["ticket_transition", { ticket: "u1", state: "working" }],
    ["ticket_classify", { ticket: "u1", type: "bug" }],
    ["comment_publish", { ticket: "u1", type: "comment", body: "Looks good" }],
    ["ticket_create", { title: "T", workflow: "bb_work", project: "p1" }],
  ]);
});

test("workspaces come from bakers info, for the label picker", async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, args]);
    return { code: 0, stdout: JSON.stringify({ project: null, workspace_ids: ["w1", "w2"] }), stderr: "" };
  };
  assert.deepEqual(await makeClient(exec).workspaces(), ["w1", "w2"]);
  assert.deepEqual(calls, [["bakers", ["info"]]]);
});
