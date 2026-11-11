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
  const { exec } = fakeExec(() => ok({ projects: [1], conductors: [2], events: [3], runs: [4] }));
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

test("cancelRun and setFrozen send their arguments", async () => {
  const { exec, calls } = fakeExec(() => ok({}));
  const client = makeClient(exec);
  await client.cancelRun("u1", "Cancelled from Herdr");
  await client.setFrozen("u1", true);
  assert.equal(calls[0].args[1], "tool_api__bakers_run_cancel");
  assert.deepEqual(JSON.parse(calls[0].args[3]), { ticket: "u1", reason: "Cancelled from Herdr" });
  assert.equal(calls[1].args[1], "tool_api__bakers_ticket_update");
  assert.deepEqual(JSON.parse(calls[1].args[3]), { ticket: "u1", frozen: true });
});
