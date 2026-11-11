import { friendlyError } from "./derive.js";

// bakers.build through the bakers CLI and the user's own auth profile. `exec` is herdr's (tests pass a fake).
export function makeClient(exec) {
  async function tool(name, args) {
    let result;
    try {
      result = await exec("bakers", ["tools", `tool_api__bakers_${name}`, "--data", JSON.stringify(args ?? {})]);
    } catch (e) {
      throw new Error(friendlyError(e?.message ?? e));
    }
    if (result.code !== 0) throw new Error(friendlyError(result.stderr || result.stdout));
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(friendlyError(result.stdout));
    }
  }

  async function allTickets(project) {
    const tickets = [];
    for (let offset = 0; offset !== null && offset !== undefined;) {
      const page = await tool("ticket_list", { project, limit: 100, offset });
      tickets.push(...(page.tickets ?? []));
      offset = page.next_offset;
    }
    return tickets;
  }

  return {
    tool,
    allTickets,
    projects: async () => (await tool("project_list")).projects ?? [],
    conductors: async (project) => (await tool("conductor_list", { project })).conductors ?? [],
    activity: async (args) => (await tool("ticket_activity_list", { limit: 100, ...args })).events ?? [],
    ticket: (uuid) => tool("ticket_read", { ticket: uuid }),
    runs: async (uuid) => (await tool("ticket_runs_list", { ticket: uuid })).runs ?? [],
    cancelRun: (uuid, reason) => tool("run_cancel", { ticket: uuid, reason }),
    setFrozen: (uuid, frozen) => tool("ticket_update", { ticket: uuid, frozen }),
  };
}
