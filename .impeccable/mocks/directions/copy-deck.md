# bakers.build — Copy deck (direction A)

Voice: `.claude/brand-voice-guidelines.md`. All product copy is English. The facts come from the repo and docs (`bakers-build/bakers-build`); nothing is invented, and there are no customers, prices or benchmarks.

Legend: **keep** = unchanged from a-kombi · **new** = new text · **was → now** = rewritten.

> **Pending revision (brand foundation approved 2026-10-23, `docs/decisions/brand-foundation.md`).** This deck still has "Book a demo" as the primary action and the headline "AI agents work your tickets. You decide what ships." Both are superseded: the primary action is **Start free**, self-host / start with your agent is secondary, and the demo is a quiet path. The headline candidate is "You're the baker. Agents run the line." The hero, the three beats, the demo band, the "Your recipe" section, the "Free, self-hosted or hosted" section and the closing CTA are rewritten in the copy step (foundation section 10, step 3). Only the FAQ is updated so far. The cost and hosting answers wait on the open questions to Christian Wiedemann in foundation section 11 (paid add-ons, who runs the hosted instance) before they go live.

---

## 1. Landing page

### Nav
| Element | Copy | Status |
|---|---|---|
| Links | How it works · Terminal · Docs · GitLab | keep |
| Primary | Book a demo | keep |

### Hero
| Element | Copy | Status |
|---|---|---|
| Headline | AI agents work your tickets. You decide what ships. | keep |
| Subline | Before your team is up, the prep is done. Agents run on your own machines. Every plan, review and merge waits for a person. | small change: split into three sentences, one beat each. This is the page's one wink |
| Under the hero | Open source under MIT. | new (MIT as a headline-level proof point) |
| Counter tags | Qualification · weighs it / Spec · cuts it up / Coding · bakes it / Review · glazes it / Done · you ship it | keep (owner decision 2026-10-22): the bakery verbs stay as illustration captions on the website only. They never appear as app or terminal state names. |

### Demo band
| Element | Copy | Status |
|---|---|---|
| Heading | See it on your own repo. | keep |
| Field label | Work email | keep |
| Button | Book a demo | keep |
| Confirmation | Thanks. We'll get back to you to find a time. | new |
| Error | Enter a work email so we can reach you. | new |
| Secondary | Or start with your agent: `npm i -g @bakers-build/bakers` | keep |

### Proof strip
Open source, MIT · Your code stays on your machines · Every run recorded — keep

### How it works (new section, the five gates)
> **Every ticket takes the same five steps. You see each one.**

1. **Qualification.** An agent reads the ticket, checks what's missing and splits off sub-tickets. *You confirm it's worth doing.*
2. **Spec.** An agent writes the plan: steps, files, tests. *You approve the plan before any code is written.*
3. **Coding.** An agent works in its own git worktree on one of your machines.
4. **Review.** A second agent checks the result and gives a verdict. *You decide: merge or send back.*
5. **Done.** Merged by a person. The run stays on the record.

The italic lines are the gates. They are the point of the page: they show who decides.

### Terminal (bakers ui)
| Element | Copy | Status |
|---|---|---|
| Heading | Write the ticket where you already work. | keep |
| Body | Describe what you need in the terminal. The Spec agent drafts a plan, and you approve it before any code is written. | keep |

### Your machines, your agents (new)
> **Runs on your machines. With the agent you already pay for.**
>
> Conductors run on your team's laptops and servers. Each ticket gets its own git worktree, and your code never leaves your machines. Use Claude Code, Codex, Grok, Kimi, OpenCode or Pi on your own subscription, and switch per project.

### Every run on the record (new)
> **Who worked on what, and what it cost.**
>
> Every run keeps its transcript and footprint: tokens, turns, tool calls. Effort and AI usage roll up per billing account.

### Your workflow, versioned (new)
> **Your rules live in your repo.**
>
> `WORKFLOW.md` sits next to your code and goes through code review like everything else. Not tribal knowledge.

### Three ways in (new, replaces "THREE WAYS IN" eyebrow)
| Card | Copy |
|---|---|
| Start with your agent | Install the CLI and run `/bakers init` in Claude Code. |
| Start in the browser | Work your tickets from claude.ai or Claude Desktop. |
| Is bakers.build right for us? | See whether it fits your team before you book a demo. |

### FAQ (new where missing)
| Question | Answer |
|---|---|
| Does my code leave my machines? | No. Agents work in git worktrees on your machines, and your repository stays there. If bakers.build hosts it for you, only the control plane runs on our servers. It holds tickets, handoffs and each run's footprint; the conductors, your code and run transcripts stay on your team's machines. |
| Who merges? | A person does. People approve the plan, the verdict and the merge. |
| Which agents can I use? | Claude Code, Codex, Grok, Kimi, OpenCode and Pi, on your own subscription. |
| What does it cost? | The core is open source under MIT and free to use, on your own machines. bakers.build can also host it for you, and add-ons such as time tracking extend it when you need them. Prices for hosting and add-ons aren't set yet. |
| What if nothing starts? | Start the conductor in the foreground to see its log: `bakers conductor start --foreground`. The docs cover the usual causes. |

### Closing CTA
> **Thirty minutes, your repo, one real ticket.**
> You'll see where the agents work and where your team decides.
> [Book a demo]

### Footer
bakers.build · Open source under MIT · Docs · GitLab · Imprint
No wink in the footer. The one wink on this page is the hero subline.

---

## 2. bakers ui (terminal)

| Moment | Copy |
|---|---|
| New ticket header | `new ticket  (esc to cancel)` |
| Fields | `title` · `detail` · `project` · `priority` |
| Created | `✓ created BB-162 → qualification` |
| Board line, waiting | `BB-162  qualification  waiting for you` |
| Board line, running | `BB-151  coding  Coding on cw-framework · running 12:08 · 62k tokens` |
| Board line, verdict | `BB-149  review  agent Review · verdict ready · your call` |
| Board line, done | `BB-140  done  merged by ms · 2 runs` |
| Help line | `[a] approve  [r] send back  [/] search  [?] help` |
| Approve confirm | `Approve the plan for BB-162? [y/N]` |
| Approved | `✓ BB-162 approved → spec` |
| Sent back | `↩ BB-149 sent back to coding with your note` |
| Empty | `Nothing waiting for you. 3 tickets are with agents.` |
| No conductor | `No conductor online for shop-relaunch. Start one with: bakers conductor start` |
| Not logged in | `You're not logged in. Run /bakers init in Claude Code to connect.` |
| Network error | `Can't reach the control plane at <url>. Check the connection, then press r to retry.` |

Rules:
- Casing: terminal copy is lowercase (`waiting for you`); web app copy is sentence case (`Waiting for you`).
- State names stay lowercase and technical.
- "you" marks a gate.
- Errors name the problem and the next command.
- No jokes in errors.

---

## 3. Web app microcopy

| Place | Was | Now |
|---|---|---|
| Card waiting on a person | waiting for you | **Waiting for you** (badge, highlight color) |
| Qualification card action | Approve / Edit | **Approve** / **Edit ticket** |
| Review card action | Merge / Send back | **Merge** / **Send back** (keep) |
| Review verdict | verdict: looks good | **Review: looks good** |
| Running card | running 12:08 · 62k tok | **Running 12:08 · 62k tokens** |
| Agent label | Coding · cw-framework | **Coding on cw-framework · Running 12:08** |
| Toast after merge | — | **BB-149 merged.** |
| Toast after send back | — | **BB-149 sent back to coding.** |
| Empty state, My work | Nothing waiting for you in intranet. / The agents are working on 3 tickets… | **Nothing waiting for you.** The agents are on 3 tickets. They'll show up here when they need your decision. [Open board] |
| Empty board | — | **No tickets yet.** Create one here or in the terminal with `bakers ui`. [New ticket] |
| Conductor offline | — | **No conductor online.** Tickets wait until one starts. [How to start a conductor] |
| Run failed | — | **Run failed after 04:12.** The transcript shows where it stopped. [Open run] [Retry] |
| Permission | — | **You can't merge in this project.** Ask a workspace lead for access. |
| Confirm merge dialog | — | Title **Merge BB-149?** · Body *This merges branch bb-149 into develop.* · Buttons **Merge** / **Cancel** |
| Greeting (My work) | Good morning, Michael. | keep. It's factual and personal, with no wink |

Rules:
- Buttons name their action.
- The same verb runs through the whole flow (Merge → "merged").
- No bakery words.
- The wink goes only in empty states, and only if it's true.

---

## 4. Demo invitation email

**Subject:** 30 minutes with bakers.build on your repo

> Hi {first name},
>
> thanks for your interest in bakers.build.
>
> In thirty minutes we take one real ticket from your repo through the whole flow. You'll see where the agents work, where your team decides, and what each run costs.
>
> Pick a time that suits you: {booking link}
>
> If you'd like to look around first, the docs are here: {docs link}. bakers.build is open source under MIT.
>
> {sender name}
> bakers.build

The email uses "you" and names concrete outcomes. It has no urgency, no hype words, no attachment and no invented claims.

---

## 5. Removed or replaced (from the current repo copy)

| Was | Why | Now |
|---|---|---|
| "Agents are autonomous." (README) | Feeds the fear the brand exists to lower | "Agents work each ticket from spec to review; your team approves every step that matters." |
| "Tickets falling into the bakers.build horizon" (landing) | Cosmos metaphor, mystifying | "Every ticket takes the same five steps. You see each one." |
| "THREE WAYS IN", "ARCHITECTURE" (caps eyebrows) | Label chrome, shouty | Plain sentence-case headings |
| daemon / worker / node agent | Three names for one thing | conductor |
| cockpit UI | Inconsistent | web app |
