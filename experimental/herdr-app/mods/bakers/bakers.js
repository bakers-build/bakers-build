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

  async function all(name, key, args) {
    const rows = [];
    for (let offset = 0; offset !== null && offset !== undefined;) {
      const page = await tool(name, { ...args, limit: 100, offset });
      rows.push(...(page[key] ?? []));
      offset = page.next_offset;
    }
    return rows;
  }

  return {
    tool,
    allTickets: (project) => all("ticket_list", "tickets", { project }),
    projects: async () => (await tool("project_list")).projects ?? [],
    conductors: (project) => all("conductor_list", "conductors", { project }),
    // Older bakers servers have no machine_list: null says so, so the views can show what is missing.
    machines: () => all("machine_list", "machines", {}).catch((e) => {
      if (/unknown tool/.test(e.message)) return null;
      throw e;
    }),
    activity: async (args) => (await tool("ticket_activity_list", { limit: 100, ...args })).events ?? [],
    ticket: (key) => tool("ticket_read", { ticket: key }),
    runs: async (key) => (await tool("ticket_runs_list", { ticket: key })).runs ?? [],
    search: async (query, project) => (await tool("ticket_search", { query, project })).tickets ?? [],
    labels: (workspace) => all("label_list", "labels", { workspace }),
    me: () => tool("user_read"),
    cancelRun: (ticket, reason) => tool("run_cancel", { ticket, reason }),
    update: (ticket, fields) => tool("ticket_update", { ticket, ...fields }),
    transition: (ticket, state) => tool("ticket_transition", { ticket, state }),
    classify: (ticket, fields) => tool("ticket_classify", { ticket, ...fields }),
    comment: (ticket, body) => tool("comment_publish", { ticket, type: "comment", body }),
    create: (fields) => tool("ticket_create", fields),
  };
}
