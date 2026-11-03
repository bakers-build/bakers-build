/**
 * Where a denied terminal dialog sends an agent: the ticket question. Shared
 * by `bakers hook ask-user-question` and the launch wrapper that blocks the
 * dialog when that hook cannot run.
 */
export const ASK_REDIRECT =
  'Nobody answers a terminal dialog in an autopilot run. Publish the question as a `comment` starting `# Question`, then `bakers_ticket_update` with `labels_add: ["Question"]` and `frozen: true`, and end the run (bb-workflow › publish-comment).';
