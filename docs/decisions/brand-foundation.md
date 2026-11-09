# bakers.build brand foundation

Date: 2026-10-23. Status: approved by the owner on 2026-10-23, without changes; the *proposal* items are accepted as written. It includes the owner's answers from the builder check and the business model decided later the same day.

This document is the base for the bakers.build brand. It covers:
- who the brand is for;
- what it promises;
- how it tells that;
- what it must never look like.

Moodboard, corporate design and website copy build on it. It refines three documents:
- `PRODUCT.md`;
- `.claude/brand-voice-guidelines.md`;
- the visual direction contract in `.impeccable/surfaces/bakers-build-ci.md`.

Where this document disagrees with them, this document wins and they get updated (see "Changes to existing documents").

Owner statements are marked as decided. Everything marked *proposal* is Claude's call, open to the owner's correction.

## 1. Why this work, and what it must achieve

- **Brand job (decided, unchanged):** lower the threshold of fear around AI.
- **First big goal (decided 2026-10-23):** as many people as possible use bakers.build. Reach comes before revenue.
- **First buyer (insight 2026-10-23):** not a developer but an agency decision-maker who wants to get their own ideas into the product without waiting, and without breaking it. The brand must speak to that person first and stay credible to developers.
- **Daily use (decided):** people must *want to work with it, daily*. The core is technical and honest (terminal); the surface is humanly approachable.

Success, in the owner's words, three months after an agency starts:

1. "My ideas went straight into the product."
2. "The application is not broken."
3. "Through working with it, I adapted the line to my needs, with help from a developer for the more complex changes."

## 2. Business model: open core, like GitLab

Decided 2026-10-23:

- **Open source and free:** the basic version is open source (MIT) and free to use.
  *Correction 2026-11-02:* the server is GPL-2.0-or-later and only the CLI and skills are MIT; marketing copy says "open source" and links [licensing](../bakers/licensing.md) instead of "MIT".
- **Two ways to run it:**
  - self-hosted;
  - hosted for the customer.
- **Hosting under the product brand:** the hosted offering is bakers.build (like gitlab.com), not keytec.
- **Paid add-ons:** these extend the core, for example time tracking.
- **No custom solutions:** there is no customization service in the brand. Nobody asks GitLab to rebuild GitLab for them. Teams adapt their line themselves, through `WORKFLOW.md`, their own skills and add-ons.

Consequences (*proposal*):

- **keytec in public:** bakers.build is a standalone brand. keytec does not appear in public copy, which keeps the existing brand-voice rule unchanged.
- **Open source moves to the centre:** it is the offer itself, not only a proof point.
- **The staircase is part of the brand story:**
  - bake for free;
  - let us run the oven for you (hosted);
  - add tools when you need them (add-ons).
- **The privacy promise needs one precise sentence for the hosted case:**
  - The conductors and the code stay on the team's machines in both cases.
  - Hosting means only the control plane runs on bakers.build's servers.
  - That server holds tickets, handoffs and each run's footprint; code and run transcripts stay with the team (added 2026-10-23 after the check in section 11).
  - Without this sentence, "we host" reads as a vendor cloud.

Ways in, so the website's actions (*proposal*):

| Action | Weight | Audience |
|---|---|---|
| ~~Start free (hosted sign-up)~~ Start a free trial (we set up the workspace; see section 11) | primary | P1, and anyone who wants no setup |
| Self-host / start with your agent (`npm`, docs, GitLab) | secondary | P2, P4 |
| Book a demo | quiet | agencies that want a guided start |

This reverses the brand-voice decision of 2026-10-22 ("Book a demo" primary), because the goal is now reach.

Open (the owner decides later; it does not block this pass):
- whether the hosted offering has a free tier;
- the add-on list beyond time tracking;
- all prices.

Pricing stays undecided, as in `PRODUCT.md`. Nothing about prices or tiers goes into public copy until it is decided.

## 3. Audiences and personas

Segments (decided):

- **Core:** mid-sized agencies, especially tech agencies, with recurring processes to automate. Example: a WordPress agency that wants the same process every time, from writing the offer to shipping the website.
- **Second:** companies and agencies that want to replace external service providers.
- **Third:** start-ups and solo founders with a technical background who start on their own.

Personas (*proposal*, built from the owner's descriptions; names are placeholders):

### P1 · The agency lead (primary buyer, first contact)

- Runs or co-runs an agency, not a developer.
- **Wants:**
  - automate processes;
  - cut cost;
  - stop waiting for developers;
  - make small changes themselves ("the button should be yellow, not green").
- **Fears (*proposal*):** losing control, a broken application, AI hype that does not deliver.
- **Can do this today without a developer (decided 2026-10-23):** write the ticket, approve at the stations and authorize the merge themselves.
  - The architecture is built so that nothing breaks.
  - Pipeline tests verify the code, including Playwright browser scenarios.
  - A review gives a verdict before the merge.
- **Convinced by:**
  - a person decides at every station;
  - nothing ships without approval;
  - the line adapts to their way of working.
- **Likely buys:** hosting and add-ons, such as time tracking.
- **First action (*proposal*):** start free on the hosted version, with no setup.

### P2 · The developer (evaluator and builder, second contact)

- Looks for automation of recurring work.
- **Convinced by:**
  - open source;
  - CLI and terminal;
  - it runs on their own machines;
  - their own agent subscription;
  - `WORKFLOW.md` in the repo.
- **Role (*proposal*):** often the one who tells P1 "this is solid", and the one who self-hosts, sets up and extends the line.
- **First action:** install the CLI, read the docs.

### P3 · The agency's client (participant, not buyer)

- Works in qualification and spec: describes, clarifies and approves.
- Never buys bakers.build but uses it.
- Needs the most approachable surface: plain language, no jargon, clear "your turn" moments.
- *Proposal:* every P3 is a potential future user, which serves the reach goal.

### P4 · The technical solo founder (self-serve)

- Starts alone with their own agent, on the open source or free path.
- The owner's notes name "Rosmarie" in this group. Whether Rosmarie is a persona name is open.

## 4. How the product really works (facts the story rests on)

From `docs/skills-and-workflows/` as it stood in the predecessor repo; to be checked against this repo's `docs/skills-and-workflows/`:

- **Workflows:** a workflow (feature, bug, chore, deployment, verification) fixes the states in code.
- **One skill per state, a person at each state.** Each state is worked by one skill run, and a person confirms or approves:
  - qualification: "you confirm";
  - spec: "you approve one scope";
  - coding: "you confirm";
  - review: merge only once you authorize.
- **The recipe:** `WORKFLOW.md` in the repo decides which skills run. A text edit changes the way of working, with no migration.
- **Own machines:** conductors run on the team's own machines.
- **Extension point:** new kinds of work (`work:*`) and own skills extend the line. A WordPress line from offer to launch would be such an extension.
- **No reopening:** a ticket in `done` never reopens; follow-up work gets a new ticket.

People at every station (decided 2026-10-23): people take part at every station, not only at the end. Who that is varies:
- the client in qualification and spec;
- a developer or the agency lead in coding;
- the same in review.

## 5. Core idea and story

### Reading of the name (decided)

The bakers are the people: the agency lead, the client and the developer. They own the recipes and make the decisions. The agents are the tools and machines of the line.

### Current slogan {#current-slogan}

**A ticket-driven software factory.**

Provisional canonical slogan, agreed on 2026-11-08. This section owns its wording; product guidance and the Designbook vision reference it rather than maintaining another slogan.

The production line carries tickets through workflow states. Agents do the work; people observe, discuss and decide at the relevant stations. Clients are windows onto that line: herdr-cli, herdr-app, Orca and Hermes expose different views and actions. They can complement each other without sharing a terminal host or offering identical capabilities.

### Earlier core-line candidates

The owner liked both in the 2026-10-23 shortlist. Kept as history; the current provisional choice is maintained above.

1. "You're the baker. Agents run the line."
2. "Your recipes. Your line. Fresh builds every day."

*Proposal:*
- Keep option 1 as the headline candidate.
- Use option 2's "your recipes, your line" as a supporting line.
- Drop "fresh builds": it sits close to the banned pun "freshly baked" in the brand voice.

The owner rejected "Agents do the dough work" as clumsy.

### The picture

- **The line (Backstraße)** is the central metaphor: stations in order, each with a person and a tool.
- **The roll (Brötchen)** is the tasty result: what ships.
- **The recipe** is `WORKFLOW.md`: you change how the line works by changing the recipe.
- **Extra tools** are the add-ons: you add them to your line when you need them (*proposal*).

### The story, kept short (owner: no complex story)

One sentence on the homepage, three beats at most underneath:

1. **Your line:** every ticket passes the same stations.
2. **A person at every station:** agents do the work, you decide.
3. **Out comes something that works:** pipeline tests and browser scenarios verify the code, a review gives a verdict, and a person authorizes the merge.

Beat 3 names the mechanisms, not a guarantee (*proposal*). "Nothing ships broken" is an absolute promise the brand voice ("reassuring by fact") cannot back.

The longer arc over time is told only in example lines and demos, never on the homepage:

> first ticket → first approval → first own adaptation → first add-on

There are no public customers yet. Example lines must be labeled as examples, never presented as case studies.

### Where the metaphor lives (decided in PRODUCT.md, restated)

- **Website, docs and conversations:** line, station, recipe and roll.
- **App and terminal:** the technical state names stay (qualification, spec, coding, review, done), with no bakery words.

## 6. Anti-goals (decided)

The brand fails, even if it works technically, if it looks or reads:

- like generic AI slop UI or the Tailwind default look;
- too dark;
- too sci-fi;
- too playful;
- with 3D avatars in the monday.com style;
- with too complex a story.

Rule for the tool figures (*proposal*):
- The figures *work*; they are not cute.
- They appear in empty states and at a few places on the website, never as decoration covering a page.

## 7. Visual references (decided)

- **typesafe.ai:** technical, terminal style. It must not read as a copy of it.
- **monday.com:** the idea of AI agents as characters, without its 3D look.
- **graza.co:** tasty colors, human, approachable, illustrations.
- **raus.life:** in the same vein.

These are the same references that produced the current direction "Teig & Terminal" (`a-kombi.html`, approved 2026-10-22).

## 8. Check of "Teig & Terminal" against this foundation

The owner asked for this check. Each row is a *proposal*; the owner decides.

| | Finding | Proposal |
|---|---|---|
| Keeps | Visual base:<ul><li>flour ground and rye ink instead of black: light, warm, not sci-fi</li><li>terminal in rye brown</li><li>monoline tools</li><li>butter for "waiting for you"</li></ul> | Keep. |
| Gap | The hero counter shows only tools. The person appears only at the end ("Done · you ship it"). That contradicts "a person at every station". | Show a person at every station of the counter, or a "you" mark under each tool. |
| Gap | The headline "AI agents work your tickets. You decide what ships." is good for developers, but:<ul><li>"Tickets" is jargon for P1 and P3.</li><li>"Decide what ships" places the decision only at the end.</li></ul> | Test the core line "You're the baker. Agents run the line." as the headline. |
| Gap | The primary action is "Book a demo" with a work-email field. That contradicts the reach goal. | Make "Start free" primary. The demo band becomes a quiet path. |
| Gap | The site tells one linear ticket. Two things are missing:<ul><li>the line as something you adapt (recipe)</li><li>the open core staircase (free, hosted, add-ons)</li></ul> | Add a "Your recipe" section for P1 and a short "Free, self-hosted or hosted" section. Add-ons are named without prices. |
| Gap | P3, the client, is not addressed anywhere. | App microcopy for qualification and spec in the plainest language. No website section needed. |
| Risk | Googly eyes and action marks can tip into "too playful". | Apply the figure rule from section 6. |
| Risk | Instrument Serif is already flagged as overused, and pill buttons are common. Both edge toward the generic look. | Decide the display face in the corporate design step. |
| Fits | Proof strip:<ul><li>"Open source, MIT"</li><li>"Your code stays on your machines"</li><li>"Every run recorded"</li></ul> | Keep. Add the hosted case to "your code stays on your machines" (section 2). |

Verdict (*proposal*):
- Keep "Teig & Terminal" as the visual base, with its colors and tone.
- Revise the hero illustration, the story and the action hierarchy.

## 9. Changes to existing documents

When this document is approved:

- `PRODUCT.md`
  - "Humans decide at the gates (review, deploy)" becomes "a person takes part at every station and has the last word".
  - Add the open core model (section 2), the reach goal and the personas.
  - "Primary action of public surfaces: book a demo" becomes "start free". The demo becomes a quiet path.
- `.claude/brand-voice-guidelines.md`
  - Primary action as above (it replaces owner decision 2 of 2026-10-22).
  - Pillar 1 widened from "gates" to "every station".
  - The core line.
  - "Bakers are the people" as the reading of the name.
  - The hosted-case sentence for "your code stays on your machines".
  - The keytec rule stays unchanged.
- `.impeccable/surfaces/bakers-build-ci.md`: the story, the first viewport and the action hierarchy follow section 8.
- `.impeccable/mocks/directions/copy-deck.md`: the FAQ answer "What does it cost?" follows section 2. The answer says what is free and does not invent prices.

## 10. Next steps after approval

1. **Moodboard:** references plus the principles drawn from them (color, type, illustration, people at stations), so the corporate design step starts from a shared picture. The medium is the builder's call; Figma drafts go on their own page only.
2. **Corporate design revision** of "Teig & Terminal" per section 8:
   - hero with people at the stations;
   - the display face decision;
   - the figure rule;
   - the new action hierarchy.
3. **Copy:**
   - the headline and the three beats;
   - the "Your recipe" section;
   - the "Free, self-hosted or hosted" section;
   - the FAQ on cost.

   All of it follows the brand voice.
4. **App microcopy for P3:** plain language in qualification and spec.

### Scope of this pass (*proposal*)

- **Output:**
  - design artifacts: a revised `a-kombi.html` (or a sibling mock), the moodboard, and updated markdown docs;
  - copy as a revision of `.impeccable/mocks/directions/copy-deck.md`.
- **Not in this pass:**
  - implementing the website in the `bakers-build/bakers-build` repo (Vue sections);
  - tokens in Designbook or the theme;
  - a pricing page.

  These are separate work once this pass is approved and the prices are decided.
- **Illustration:** concept level, in the existing monoline style, for owner sign-off. Whether final art needs an outside illustrator is decided after that.
- **Website structure:**
  - In scope: the homepage, including mobile, because a-kombi already has a mobile layout.
  - The full site structure stays open, as in `PRODUCT.md`.

## 11. Check against the existing product work

Added 2026-10-23 at the owner's request. Christian Wiedemann's earlier strategy work was checked so this foundation does not contradict it.

### Sources

There is no persona or strategy document on any branch of `bakers-build/bakers-build` or the predecessor repo, and no issue about it. The audience thinking lives in:

- The predecessor repo, `docs/archive/specs/role-model-target.md`, §4 "Product personas (for IA)", and `ia-home-nav-roles-decisions.md`, D2 "two job kinds, not eight personas" (2026-08-16): personas as app roles (project member, project lead, team member, team lead, workspace admin, agent) with their leading questions.
- The landing page (`docs/.vitepress/theme/landing/`), especially `ThreeWays.vue`: three ways in that act as audiences.
- The docs: `docs/get-started/work-in-the-browser.md`, `is-bakers-right-for-us.md`, `docs/advanced/hosted-or-self-run.md`, `docs/daily-work/who-sees-what.md`.

### Two layers, kept apart

His personas are **app roles inside a workspace**; ours (section 3) are **marketing audiences and buyers**. Both stay. The app and docs keep his role words (member, lead, admin; never "manager"). Mapping:

| Persona | Way in on today's landing page | Typical app role |
|---|---|---|
| P1 · agency lead | "In the browser only", later "For your team" | workspace Admin or team Lead, listed as Reviewer to accept or merge |
| P2 · developer | "With your agent in the repo" | Contributor, project member, conductor owner |
| P3 · agency's client | "In the browser only" | open: see question 1 |
| P4 · solo founder | "With your agent in the repo" | workspace owner (all rights) |

### What already agrees

- **Hosted or self-run "like GitLab"** is already in the FAQ and the docs. The open core model builds on it.
- **A no-install path for non-developers** exists: tickets in the chat (claude.ai, Claude Desktop, Cowork), followed and accepted on the web. It is the natural first action for P1 and P3.
- **Adapting the line** ("For your team", `WORKFLOW.md`, own step skills) matches "your recipe, your line".
- **"with you deciding at every step"** in the hero matches "a person at every station".

### What differs

- **No buyer:** the landing page speaks to developers and teams. P1 as first buyer and the three segments are new.
- **Cost:** the current FAQ says "MIT licensed and free. You pay only what you already pay." Paid hosting and add-ons are new and replace it in the copy deck.
- **The hosted data:** the hosted server stores tickets, handoffs and footprint, no transcripts. The hosted-case sentence (section 2) now says so.
- **Accept vs. merge:** the browser path says "Accept / Reject". The website story names the merge; P1 reaches it as a listed reviewer.

### Answers and open questions (status 2026-10-23)

Answered by the owner:

- **Paid hosting and add-ons:** hosting by bakers.build is paid, and add-ons are paid. The open source core stays free.
- **Hosted instance:** a bakers.build-run instance exists today, and customers are let onto it. Each customer gets their own workspace.
- **Sign-up:** there is no self-service sign-up. The team creates each workspace by hand today. When self-service comes is not defined.
- **Trial:** a free trial or a demo is planned as the way into hosting. Length and form are open.
- **Merge path:** a merge is authorized only in the terminal or in the linked GitLab merge request today, not in the web app.
- **Agent questions:** they reach the lead in the browser.
  - `docs/get-started/work-in-the-browser.md` still says they are asked "on the machine that runs the ticket". Christian should check that page.
- **Who runs the conductors:** the agency, on its own machines. When keytec runs conductors for its clients, keytec is acting as an agency that uses bakers.build. That is not a bakers.build offer, so "your code stays on your machines" holds.

Open, for Christian Wiedemann:

1. **P3 and the Guest rank (tbd):** a Guest reads only. The client is meant to describe, clarify and approve in qualification and spec. Today that needs Contributor, which also allows creating projects and cancelling tickets. Is a client role (or a narrower rank) planned?

### Consequences for the brand (*proposal*)

- **Primary action:** "Start free (hosted sign-up)" cannot hold. Hosting is paid and workspaces are set up by hand.
  - New primary: **"Start a free trial"**. It is a short request, after which we set up the workspace. The confirmation says so plainly ("We'll set up your workspace and send you the link"), with no time promise until one is decided.
  - Secondary: **self-host for free** (open source, `npm`, docs, GitLab).
  - Quiet: **book a demo**.
  - This replaces the first row of the table in section 2.
- **Merge:** copy says "you authorize the merge", never "in the browser". For P1 the honest path is the button in the GitLab merge request.
- **"Without waiting for developers":** a developer, or we, set up the line and the conductor once. After that the lead works day to day without one. This matches success sentence 3 (section 1).

## Left to the builder

- Format and tooling for the moodboard.
- How people are drawn at the stations. The obvious default is the same monoline style as the tools.
- Exact wording of the three story beats within the brand voice.
