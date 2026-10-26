# Follow a ticket

**See where a ticket stands and answer your agent when it needs you.**

**You need:** access to the ticket's project.

1. **Read the latest summary.** Open the ticket in your browser or ask your agent:

   ```text
   Use bb-read-ticket for <identifier> and tell me where it stands.
   ```

   Every step ends with a `summary` comment: what happened and what comes next.

2. **Check the state.** A ticket moves through `qualification`, `plan`, `working`, `review` and `done`; a fully specified ticket may skip `plan`, and review is optional. [Workflows and states](/skills-and-workflows/workflows-and-states) explains each one.

3. **Answer questions.** See [Where you answer](#where-you-answer) below.

4. **Adjust the ticket.** On the ticket page, the Properties panel changes assignee, reviewers, conductor, priority and labels. Its footer offers **Freeze ticket**, **Cancel ticket** and **More settings**. The header names why a ticket stands still: *frozen*, *blocked*, *no conductor* or *failing*.

## Where you answer

An agent that needs your decision stops and asks **in its own terminal tab on the machine that runs the ticket**. Your workspace manager opens one tab per ticket and step, named after the ticket. Answer there and the agent continues.

| Where the ticket runs | Where you answer |
|---|---|
| On your machine | In the tab your workspace manager opened for it |
| On a teammate's machine or a shared server | Ask the person who runs it to answer, or to pass the question to you |

A comment you write on the ticket page reaches the **next** step, not a step that is already waiting. A ticket that shows a running step but no new comment for a while is usually a question nobody has seen yet.

## Comments you will see

| Type | Holds |
|---|---|
| `summary` | outcome, evidence, links, the next action |
| `qualification` | acceptance criteria and labels |
| `spec`, `plan`, `test` | design, plan and test plan |
| `debug_diagnose` | the reproduced defect and its cause |
| `acceptance` | the criteria, each with PASS or FAIL and its evidence |
| `scenario` | a browser path you can click through |
| `review` | the verdict, `OK` or `Not OK`, with findings |

**Done when:** you know the state, the latest `summary` and whether anything waits for you.

Runs, activity and answering from the terminal: [Tickets in the terminal](/advanced/cli/tickets-in-the-terminal).
