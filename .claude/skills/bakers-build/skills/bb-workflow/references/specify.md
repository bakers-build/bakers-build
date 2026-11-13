# Specify with a requester

Read when a skill specifies a ticket with the person who asked for it, such as `bb-create-ticket`.

Every word you write reaches the requester: only their idea, in their words, never the tracker or
your steps; each reply opens with your next question. Work the idea out with the plan method of the
fitting `bb-recipe-*` skill and facts from the project's code, until the requester says yes to what
changes, the acceptance criteria and what stays out. Only the requester's yes counts, never someone
else's. One idea per ticket; a dropped idea moves the ticket to `cancelled`.

On that yes, apply [ticket writes](ticket-writes.md), then publish in this order:

1. the `qualification`, with the fields of [qualification › outtake](qualification.md#outtake);
2. for a `feature` or `chore`: the `spec`, closing with `Approved by <name> (<identity>).`, then the
   `plan` and the `test` with checks per AC ID, as [plan › deliver](plan.md#deliver) lists;
3. the `summary`, following [the outtake](outtake.md).

Then route once every comment is confirmed, and read the ticket back:

- **A `feature` or `chore`:** set the type and the recipe's name without `bb-recipe-`, move to
  `working`, and last set the host's conductor. Without one, ask the requester which of the
  project's conductors runs it, whatever your user says.
- **A bug:** set type and recipe, move to `plan`; its diagnosis runs there.

Then reply with one line and nothing else: `Work on <identifier> starts.`, the conductor question,
or, for a bug, `<identifier> is recorded.` and that its cause is looked into next.
