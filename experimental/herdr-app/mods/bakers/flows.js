// Every write: what each dialog says, and the calls each action makes. `io` is { client, hc } (tests pass fakes).
import { STATE_ORDER, stateLabel } from "./derive.js";
import { sshTarget } from "./remote.js";

const CLOSING = new Set(["done", "cancelled"]);

const text = (value, empty) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed && empty) throw new Error(empty);
  return trimmed;
};

const machineName = (machine, conductor) => (machine?.here ? "this computer" : machine?.label ?? conductor.label);

export const questionLabel = (ticket) => (ticket.labels ?? []).find((l) => /^question$/i.test(l)) ?? "Question";

export const WRITES = {
  comment: async ({ client }, ticket, { body }) => client.comment(ticket.id, text(body, "Write something first.")),
  // An answer also lets the run go on: unfreeze and drop the label in one update (not atomic with the comment).
  answer: async ({ client }, ticket, { body, unfreeze }) => {
    await client.comment(ticket.id, text(body, "Write something first."));
    if (unfreeze) await client.update(ticket.id, { frozen: false, labels_remove: [questionLabel(ticket)] });
  },
  requestChanges: async ({ client }, ticket, { body }) => client.comment(ticket.id, text(body, "Write something first.")),
  save: async ({ client }, ticket, { title, description }) => {
    const fields = { title: text(title, "A ticket needs a title."), description };
    const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== (ticket[key] ?? "")));
    if (Object.keys(changed).length) await client.update(ticket.id, changed);
  },
  classify: ({ client }, ticket, fields) => client.classify(ticket.id, fields),
  addLabel: ({ client }, ticket, { name }) => client.update(ticket.id, { labels_add: [name] }),
  removeLabel: ({ client }, ticket, { name }) => client.update(ticket.id, { labels_remove: [name] }),
  create: async ({ client }, _ticket, fields) => {
    const title = text(fields.title, "A ticket needs a title.");
    if (!fields.workflow) throw new Error("No workflow known for this project yet: open one of its tickets first.");
    const filled = Object.entries(fields).filter(([key, value]) => key !== "title" && value);
    return client.create({ title, ...Object.fromEntries(filled) });
  },
};

// The state menu shows every state; no tool names a workflow's allowed moves, so the server refuses what it forbids.
export function stateMenu(current) {
  const states = [...new Set([...STATE_ORDER, ...CLOSING, current])];
  const at = states.indexOf(current);
  return states.map((state, i) => ({ state, label: `${stateLabel(state)}${i === at ? "" : "..."}`, current: i === at, earlier: i < at }));
}

const STATE_SENTENCES = {
  qualification: (t) => `The agent qualifies ${t.identifier} again before anything else happens.`,
  plan: (t) => `A run writes a new plan for ${t.identifier}; the old plan stays in Comments.`,
  working: (t) => `A conductor picks ${t.identifier} up and the agent starts coding on branch ${t.branch_name}. You can move it back to ${t.state} later.`,
  review: (t) => `The review run or a reviewer checks branch ${t.branch_name}.`,
  done: (t) => `This closes ${t.identifier}. A closed ticket cannot be changed any more.`,
};

// Each dialog: title, from and to, the consequence, an optional field, the buttons, and what it does.
// `enter` says what Enter does: "yes" confirms, "no" keeps (the PoC's freeze and cancel).
export const DIALOGS = {
  state: ({ ticket, target }) => ({
    title: `Move ${ticket.identifier} to ${target}?`, from: ticket.state, to: target,
    body: (STATE_SENTENCES[CLOSING.has(target) ? "done" : target] ?? ((t) => `${t.identifier} moves to ${target}.`))(ticket),
    field: { label: "Comment, optional, posted with the change", multiline: true },
    done: `${ticket.identifier} moved to ${target}`, yes: `Move to ${target}`, no: `Keep in ${ticket.state}`, esc: `Esc keeps it in ${ticket.state}`, primaryFirst: CLOSING.has(target), enter: "yes",
    run: async ({ client }, { text: comment }) => {
      if (text(comment)) await client.comment(ticket.id, text(comment));
      await client.transition(ticket.id, target);
    },
  }),
  freeze: ({ ticket }) => ({
    title: `Freeze ${ticket.identifier}?`, body: "No conductor picks it up while it is frozen. A run that is already running continues until it ends.",
    done: `${ticket.identifier} frozen`, yes: "Freeze", no: "Keep", esc: "Esc keeps it", enter: "no",
    run: ({ client }) => client.update(ticket.id, { frozen: true }),
  }),
  unfreeze: ({ ticket }) => ({
    title: `Unfreeze ${ticket.identifier}?`, body: "Conductors can pick it up again.",
    done: `${ticket.identifier} unfrozen`, yes: "Unfreeze", no: "Keep frozen", esc: "Esc keeps it frozen", enter: "no",
    run: ({ client }) => client.update(ticket.id, { frozen: false }),
  }),
  cancel: ({ ticket }) => ({
    title: `Cancel the running run on ${ticket.identifier}?`,
    body: `The agent stops in the run's terminal. Its work stays in the worktree and ${ticket.identifier} stays in ${ticket.state}, so it can run again.`,
    field: { label: "Reason, optional, recorded on the run", placeholder: "Wrong branch, restarting with a smaller scope" },
    done: `Run on ${ticket.identifier} cancelled`, yes: "Cancel run", no: "Keep running", esc: "Esc keeps it running", enter: "no",
    run: ({ client }, { text: reason }) => client.cancelRun(ticket.id, text(reason) || "Cancelled from Herdr"),
  }),
  "run-on": ({ ticket, conductor, machine }) => {
    const online = conductor.status === "online", where = machineName(machine, conductor);
    const owner = machine?.mine ? ` If ${ticket.identifier} has no assignee yet, it becomes you, the owner of ${conductor.label}.` : "";
    const start = online ? `A run starts at once in state ${ticket.state} on ${where}.` : `The run starts when ${conductor.label} is back online, in state ${ticket.state}.`;
    return {
      title: `Run ${ticket.identifier} on ${conductor.label}?`, from: "no conductor", to: [conductor.label, where].filter((v, i, a) => a.indexOf(v) === i).join(", "),
      extra: online ? ["online", machine?.load].filter(Boolean).join(", ") : "offline",
      body: `${start}${online ? owner : ""} You can move or cancel the run later.`,
      done: `${ticket.identifier} runs on ${conductor.label}`, yes: `Run on ${conductor.label}`, no: "Keep without a run", esc: "Esc keeps it without a run", enter: "yes",
      run: ({ client }) => client.update(ticket.id, { conductor: conductor.uuid }),
    };
  },
  // One deliberate action, two calls: if the start fails after the cancel, the error says so.
  move: ({ ticket, from, since, conductor, machine }) => {
    const reason = `Moved to ${conductor.label} from Herdr`, online = conductor.status === "online";
    const start = online ? `Then a run starts at once on ${conductor.label}` : `Then a run starts on ${conductor.label} once it is back online,`;
    return {
      title: `Move ${ticket.identifier} to ${conductor.label}?`, from: `${from.label}, running ${since}`,
      to: [conductor.label, machineName(machine, conductor)].filter((v, i, a) => a.indexOf(v) === i).join(", "),
      body: `First the running run on ${from.label} is cancelled; its work stays in the worktree on branch ${ticket.branch_name}. ${start} in state ${ticket.state}. The agent there begins from the branch, not from the old run's conversation.`,
      field: { label: "Reason, optional, recorded on the cancelled run", placeholder: reason },
      done: `${ticket.identifier} moved to ${conductor.label}`, yes: `Cancel and run on ${conductor.label}`, no: `Keep on ${from.label}`, esc: `Esc keeps it on ${from.label}`, chip: "needs API: one move call", enter: "yes",
      run: async ({ client }, { text: typed }) => {
        await client.cancelRun(ticket.id, text(typed) || reason);
        await client.update(ticket.id, { conductor: conductor.uuid }).catch((e) => {
          throw Object.assign(new Error(`Run cancelled, not started on ${conductor.label}: ${e.message}`), { moveFailed: conductor.label });
        });
      },
    };
  },
  stop: ({ ticket, conductor }) => ({
    title: `Stop dispatch for ${ticket.identifier}?`,
    body: `${conductor.label} is cleared as its conductor. No new run starts until one is set again. A run that is already running is not stopped; Cancel run... does that.`,
    done: `Dispatch stopped for ${ticket.identifier}`, yes: "Stop dispatch", no: `Keep ${conductor.label}`, esc: `Esc keeps ${conductor.label}`, enter: "yes",
    run: ({ client }) => client.update(ticket.id, { conductor: null }),
  }),
  // The machine is named by its machine_id, so later runs on it match.
  "add-machine": ({ ticket, machine }) => {
    const target = sshTarget(machine.url);
    return {
      title: `Add machine ${machine.label}?`,
      body: `Herdr does not know ${machine.label} yet. It connects over SSH and lists the machine's terminals; then the run's terminal of ${ticket.identifier} opens beside the ticket. The machine stays in Herdr's list.`,
      rows: [["Machine", machine.label], ["Connection", `ssh ${target}`], ["Herdr runs", `hc machine add ${target} --name ${machine.id}`]],
      done: `${machine.label} added to Herdr`, yes: "Add and show", no: "Not now", esc: "Esc: nothing is added", enter: "yes",
      run: async ({ hc }) => {
        const result = await hc(["machine", "add", target, "--name", machine.id, "--json"]);
        if (result.code !== 0) throw new Error(String(result.stderr || result.stdout).trim().split("\n")[0] || "hc machine add failed");
      },
    };
  },
};
