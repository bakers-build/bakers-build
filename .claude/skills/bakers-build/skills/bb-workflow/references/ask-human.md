# Ask a human

Read when the work needs a decision only a human can make, and at `read` when the ticket carries a
comment starting `# Question`. Any run in any state may ask, for a **real question**: one the
ticket, its comments, the repository and the confirmed scope cannot settle. Merge authorization,
a prior-art hit and the coding gate keep their own flow.

## Ask

1. Write the question to a Markdown file in this shape; offer choices where they help and mark the
   recommendation:

   ```markdown
   # Question

   <the question, with the context needed to answer it>

   1. <choice> (recommended)
   2. <choice>

   Answer in a comment, then remove the label *Question* and unfreeze the ticket.
   ```

2. Run `bakers ticket ask <ticket> --body <file.md>`. It publishes the file as a `comment`, puts the
   workspace label "Question" on the ticket (creating it when missing), freezes the ticket and
   prints `{ticket, comment, label, frozen}` after reading them back. On failure it prints
   `error.done`, the steps that already happened: ask once, and report the remaining steps as
   blocked.
3. End the run: print the question and its comment id. The frozen ticket is the waiting state, so
   the run publishes no summary, makes no transition and changes no state.

An interactive terminal keeps Claude's question dialog; in an autopilot run a hook denies it and
points here.

## Read the answer

The latest comment starting `# Question` is the question; every comment after it is the answer.

- The ticket still carries the label "Question", or no comment follows the question: stop without
  writing anything and print `waiting for an answer to <comment id>`.
- Otherwise continue the current state with the answer as a confirmed input. A resumed session
  still reads the ticket first.
