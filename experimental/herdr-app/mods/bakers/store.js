import { exec, hc, home, readTextFile, shared, setShared, notify, terminals } from "herdr";
import { makeClient } from "./bakers.js";
import {
  activeRun, askedComment, isClosed, machineIdOf, needsMe, needsToast, newlyNeeding, planWaits, resolveProject, runTerminal,
} from "./derive.js";
import { agentSection } from "./remote.js";

export const client = makeClient(exec);

// The chosen project's tickets, runs and conductors, shared by every copy of the mod (module scope is one per mod);
// bakers.updated makes the copies draw again. Shared state itself keeps only identifiers and counts.
export const store = {
  projects: [], project: null, projectName: null, tickets: [], runs: {}, events: [], conductors: [], machines: [], reasons: {},
  details: {}, me: null, local: null, herdrMachines: [], moveFailed: {}, error: null, loading: false, updated: null,
};

const running = new Map();
let needing = null;

// One load per key at a time; `again` queues one more after it, for a load that must see a write.
function once(key, cx, work, again = false) {
  if (running.has(key)) return void (again && running.set(key, true));
  running.set(key, false);
  cx.spawn(async (cx) => {
    try {
      await work();
    } finally {
      const more = running.get(key);
      running.delete(key);
      setShared("bakers.updated", Date.now());
      cx.notify();
      if (more) once(key, cx, work);
    }
  });
}

const herdrMachines = () => hc(["machine", "ls", "--json"])
  .then((r) => (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary).map((m) => m.name))
  .catch(() => []);

async function loadProject() {
  if (!store.me) {
    const config = await readTextFile(`${home()}/.bakers/machine.config.js`).catch(() => null);
    Object.assign(store, { me: await client.me(), local: machineIdOf(config), projects: await client.projects() });
  }
  const hit = resolveProject(store.projects, shared("bakers.project") ?? null);
  Object.assign(store, { project: hit?.uuid ?? null, projectName: hit?.name ?? null });
  if (!hit) return;
  const [tickets, conductors, events, machines, known] = await Promise.all([
    client.allTickets(hit.uuid), client.conductors(hit.uuid), client.activity({ project: hit.uuid }), client.machines(), herdrMachines(),
  ]);
  // No tool lists a project's runs or which plans wait, so each open ticket asks for its own.
  const open = tickets.filter((t) => !isClosed(t));
  const runs = Object.fromEntries(await Promise.all(open.map(async (t) => [t.identifier, activeRun(await client.runs(t.identifier))])));
  const plans = await Promise.all(open.filter((t) => t.state === "plan" && !runs[t.identifier]).map((t) => client.ticket(t.identifier)));
  const ready = new Set(plans.filter((d) => planWaits(d, null, d.comments)).map((d) => d.identifier));
  const reasons = Object.fromEntries(open.map((t) => [t.identifier, needsMe(t, ready.has(t.identifier))]).filter(([, r]) => r));
  Object.assign(store, { tickets, conductors, events, machines, herdrMachines: known, runs, reasons });
}

async function announce() {
  for (const [identifier, reason] of newlyNeeding(needing, store.reasons)) {
    const asked = reason === "Asked a question" ? askedComment((await client.ticket(identifier).catch(() => null))?.comments) : null;
    const title = store.tickets.find((t) => t.identifier === identifier)?.title ?? "";
    notify(needsToast(identifier, reason, (asked?.body ?? title).trim().split("\n")[0]));
  }
  needing = Object.keys(store.reasons);
  setShared("bakers.needs", needing.length);
  setShared("bakers.needing", needing);
}

export function refresh(cx, again = false) {
  once("project", cx, async () => {
    store.loading = true;
    try {
      await loadProject();
      Object.assign(store, { error: null, updated: Date.now() });
      await announce();
    } catch (e) {
      store.error = String(e?.message ?? e);
    }
    store.loading = false;
  }, again);
}

export function loadTicket(identifier, cx, again = false) {
  if (!identifier) return;
  once(`ticket:${identifier}`, cx, async () => {
    try {
      const data = await client.ticket(identifier);
      const [runs, events] = await Promise.all([client.runs(identifier), client.activity({ ticket: identifier })]);
      store.details[identifier] = { data, runs, events, error: null, at: Date.now() };
    } catch (e) {
      store.details[identifier] = { ...store.details[identifier], error: String(e?.message ?? e), at: Date.now() };
    }
  }, again);
}

// A ticket view asks for its ticket again after each project refresh.
export const stale = (identifier) => (store.details[identifier]?.at ?? 0) < (store.updated ?? 1);

// After a write: the ticket and the project load again.
export function changed(identifier, cx) {
  loadTicket(identifier, cx, true);
  refresh(cx, true);
}

export const ticketOf = (identifier) => store.details[identifier]?.data ?? store.tickets.find((t) => t.identifier === identifier) ?? null;

// The Agent and conductor section of a ticket, from what is loaded.
export function agentOf(identifier, nowMs) {
  const ticket = ticketOf(identifier), detail = store.details[identifier];
  if (!ticket) return null;
  return agentSection({
    ticket, run: detail ? activeRun(detail.runs) : store.runs[identifier] ?? null, terminal: runTerminal(terminals(), identifier),
    conductors: store.conductors, machines: store.machines, local: store.local, herdrMachines: store.herdrMachines,
    nowMs, moveFailed: store.moveFailed[identifier],
  });
}
