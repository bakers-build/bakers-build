# Follow a ticket

See where a ticket stands, read its evidence and respond when a decision is needed.

**You need:** access to the ticket's project. Changing its properties also needs update permission.

1. **Read the latest summary.** Open the ticket or ask your agent:

   ```text
   Read <identifier> and all its comments. Summarize the outcome,
   outstanding checks and next decision.
   ```

   A completed workflow step records a `summary`. An interrupted run may have none; inspect **Runs** for its status and errors.

2. **Check the state.** The standard workflow uses `qualification`, `plan`, `working`, `review` and `done`. An already approved specification can enter `working` directly. [Recipes and states](/skills-and-workflows/states) determine required steps: the Matt recipe requires agent review for features.

3. **Distinguish the reviews.** In workflow review, an agent checks the produced changes against requirements and repository standards. A person assigned under **Reviewers** separately checks the result, often through a shared preview. Mandatory agent review does not require a named human reviewer. Follow [Accept results](/skills-and-workflows/accept-results) for that walkthrough.

4. **Check holds and properties.** The Properties panel includes assignee, reviewers, conductor, priority and labels. Its footer offers **Freeze ticket**, **Cancel ticket** and **More settings**. Reasons such as *frozen*, *blocked*, *no conductor*, *conductor has no access* or *failing* explain dispatch holds.

## Where you answer

During a run, answer in the agent conversation provided by the configured [client](/get-started/use-your-client). With a terminal client, open the run's agent tab. For a team machine, ask its operator to relay the question or provide access to that conversation.

A ticket-page comment is read by the next workflow step; do not rely on it to wake an agent already waiting. A quiet run may be working, waiting or failing: inspect the run before assuming it needs an answer.

## Comments you will see

| Type | Holds |
|---|---|
| `summary` | Outcome, evidence, links and next action |
| `qualification`, `acceptance` | Scope and acceptance criteria |
| `spec`, `plan`, `test` | Specification, implementation and verification plans |
| `coding`, `review` | Implementation evidence or review findings and verdict |

**Done when:** you know the current state, available evidence and next action.

**Next:** [review the result](/skills-and-workflows/accept-results) when its summary says it is ready.
