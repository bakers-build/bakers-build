# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Public audience (decided 2026-10-23, see `docs/decisions/brand-foundation.md`):**
  - **Core:** mid-sized agencies, especially tech agencies, with recurring processes to automate.
  - **Second:** companies and agencies that want to replace external service providers.
  - **Third:** start-ups and technical solo founders who start on their own.
- **Personas** (names are placeholders):
  - **P1 · The agency lead** (primary buyer, first contact). Not a developer. Wants to get their own ideas into the product without waiting and without breaking it. Can write the ticket, approve at the stations and authorize the merge (in the terminal or the GitLab merge request) without a developer. First action: start a free trial.
  - **P2 · The developer** (evaluator and builder). Convinced by open source, the CLI, their own machines, their own agent subscription and `WORKFLOW.md` in the repo. Often tells P1 "this is solid"; self-hosts, sets up and extends the line. First action: install the CLI, read the docs.
  - **P3 · The agency's client** (participant, not buyer). Describes, clarifies and approves in qualification and spec. Needs the plainest language and clear "your turn" moments.
  - **P4 · The technical solo founder** (self-serve). Starts alone with their own agent on the open source path.
- **Inside a workspace** (product roles are ranks, see `docs/daily-work/who-sees-what.md`; the product word is **lead**, never "manager"):
  - workspace ranks: **Admin** (everything, invites people), **Contributor** (works tickets, registers a conductor, records time), **Guest** (reads only);
  - team roles: **Member** (sees the team's projects), **Lead** (edits projects and billing accounts, sees statistics and hours), **Owner** (also manages the team);
  - reviewing a ticket needs being listed under **Reviewers** on it; review, merge and deployment stay explicit human decisions whatever the rank;
  - a merge is authorized in the terminal or in the linked GitLab merge request, not in the web app (status 2026-10-23);
  - a company is a workspace, e.g. keytec, chemistree.
- **Personas vs. roles:** the personas above are marketing audiences; these ranks are app roles. The mapping is in `docs/decisions/brand-foundation.md`, section 11.
- **Machines and agents:** conductors on team members' machines claim tickets and run coding agents (Claude Code). They talk to the product through the API, the CLI and the Claude Code skill, not the web UI.

## Product Purpose

A ticket-driven orchestrator where every active ticket state is worked by a human or an AI.

- A ticket moves through states such as qualification, spec, coding, review and done. Each state is worked by a person or by an agent run on a conductor.
- Success means:
  - teams ship more with the same people;
  - every run stays traceable;
  - a person takes part at every station and has the last word.
- Commercial context: effort and AI usage can be allocated to billing accounts. Hours come from the product's own time tracking.
- **First big goal (decided 2026-10-23):** as many people as possible use bakers.build. Reach comes before revenue.

## Business Model

Open core, like GitLab (decided 2026-10-23):

- **Open source and free:** the basic version is open source (MIT) and free to use.
- **Two ways to run it:** self-hosted, or hosted for the customer.
- **Hosting under the product brand:** the hosted offering is bakers.build (like gitlab.com), not keytec. The instance exists today. Each customer gets their own workspace, created by the team by hand; there is no self-service sign-up yet. Hosting is paid; a free trial or demo is planned.
- **Paid add-ons** extend the core, for example time tracking.
- **Conductors** always run on the agency's own machines. keytec running conductors for its own clients is keytec acting as an agency on bakers.build, not a bakers.build offer.
- **No custom solutions:** teams adapt their line themselves, through `WORKFLOW.md`, their own skills and add-ons.
- **Hosted case, precisely:** conductors and code stay on the team's machines in both cases. Hosting means only the control plane runs on bakers.build's servers. It holds tickets, handoffs and each run's footprint; code and run transcripts stay with the team (`docs/advanced/hosted-or-self-run.md`).
- **Open:** whether hosting has a free tier, the add-on list beyond time tracking, all prices. Nothing about prices or tiers goes into public copy until decided.

## Positioning

- **Distributed execution:** conductors run on the team's own machines and repositories, not in a vendor cloud. This holds for the hosted offering too: only the control plane is hosted.
- **A real control plane:** projects, workflows, reviews, runs, billing accounts and statistics in one system.
- **The same work in three places:** in the browser, in the terminal (`bakers ui`, CLI) and inside Claude Code.
- **Lineage:** inspired by OpenAI Symphony, extended with a Drupal control plane, distributed conductors and cost allocation.

## Operating Context

- **Daily use:**
  - ticket list and My work;
  - project board with work states (Not assigned, Intake, Working, Done);
  - ticket detail with run history, handoffs and reviews;
  - insights (new vs. done, runs per ticket, rating, AI usage);
  - billing report;
  - time tracking.
- **Two interfaces of equal rank:**
  - **`bakers ui` (terminal):** where tickets are entered and worked day to day; plus the `bakers` CLI and conductors.
  - **bakers.build web app:** board, ticket detail, runs, insights, billing (the screens in Figma).
- **Inside Claude Code:** the agent-facing ticket workflow skill.
- **Systems around it:**
  - code in GitLab;
  - time and billing exported to Harvest;
  - design system in Designbook/Storybook (`web/themes/custom/bb_theme`, components via `designbook:debo`).

## Capabilities and Constraints

- Web app on Drupal 11 with a single theme (`bb_theme`), Light and Dark mode only. The four extra skins (harbor, grove, ember, iris) and the theme picker are being retired.
- UI strings and repo artifacts are English. The team communicates in German.
- Ticket states and work states keep their technical names in the app: qualification, spec, coding, review, done, cancelled.
- **Rename in progress:** the old product name gives way to **bakers.build** completely — UI, logo, domains, repository, CLI command, packages and ticket key prefix. This repo, `bakers-build/bakers-build`, is already largely renamed (`bb_theme`, `@bakers-build/*`, ticket prefix `BB-`).
- **Undecided:** public pricing (including a hosted free tier and the add-on list), website structure.
- **Voice:** brand voice guidelines live in `.claude/brand-voice-guidelines.md` (English only; a wink must still be a true product fact).

## Brand Commitments

- **Name:** `bakers.build`, always lowercase with the dot (it is the domain), also at sentence start.
- **The brand's job:** lower the threshold of fear around AI.
- **Reading of the name:** the bakers are the people (agency lead, client, developer). They own the recipes and make the decisions. The agents are the tools and machines of the line.
- **Core line (shortlist):** "You're the baker. Agents run the line." is the headline candidate; "Your recipes. Your line." is the supporting line.
- **Metaphor on public surfaces:** website, docs and conversations use line, station, recipe (`WORKFLOW.md`) and roll (what ships). The app and terminal keep the technical state names.
  - Everyone has a positive relation to a bakery: handcrafted and human, yet running on a production line.
  - The picture to aim for is an organic bakery with automation.
- **Tone:** craft-precise and calm, with a wink in the details, and at the same time self-confident.
- **Actions of public surfaces (decided 2026-10-23, replaces "book a demo" of 2026-10-22):**
  - primary: start a free trial (a request; we set up the workspace);
  - secondary: self-host for free / start with your own agent (`npm`, docs, GitLab);
  - quiet: book a demo.
  - Open source (MIT) is the offer itself, not only a proof point.
- **Agents as characters:** personified baking tools in a monoline style, one per state: scale (qualification), dough scraper (spec), oven (coding), pastry brush (review). Baked goods stand for the work and appear in empty states. They are used on the website, in docs and in empty states, never as app state names. Decided 2026-10-22.
- **Marks:** the looking bun is the brand mark (website, docs, social); the oven with a terminal window is the product mark (app icon, favicon, `bakers ui`, CLI).
- **Bakery motif:** quiet, in the details only. It appears in the logo idea, marketing tone and small easter eggs, never as cute or literal decoration.
  - The app does **not** use bakery vocabulary for states. Rohling, Im Ofen, Abkühlen and similar terms stay out of the UI.
- **Anti-goals:** generic AI slop or the Tailwind default look; too dark; too sci-fi; too playful; 3D avatars in the monday.com style; too complex a story. The tool figures work, they are not cute, and they appear only in empty states and a few places on the website.
- **No borrowed look:**
  - It must not read as a copy of typesafe.ai. The terminal / console feel is welcome because the product really has a terminal UI.
  - No visual or verbal reference to keytec as parent brand.
- **Retired:** the earlier "braid" logo and the corporate design draft from before the rename.
- **Surfaces the identity must cover from the start:** web app (Light/Dark), terminal UI and CLI, website / marketing, docs.

## Evidence on Hand

- Real product with real internal use at keytec and in a customer workspace (chemistree).
- **Must not be invented:** no public customers, testimonials, benchmarks or pricing exist yet.
- **Design work so far:**
  - Figma file `sr31HfHNWbCeNsxvXbt4wv`: core screens, proposals, statistics, corporate design drafts.
  - Impeccable critique snapshot in `.impeccable/critique`.

## Product Principles

- **A person at every station.** Agents do the work; at every station a person confirms or approves, and a person authorizes the merge.
- **Every run is traceable:** who or what worked a ticket, when, with which result and cost.
- **One system, three surfaces.** Browser, terminal and Claude Code show the same truth in the same words.
- **Fewer choices, clearer defaults.** No preset lists, no export clutter. Show what matters and let the rest stay out of the way.
- **Operate first.** The app is a working tool; brand expression lives in precise details, not decoration.

## Accessibility & Inclusion

WCAG 2.2 AA for the web app in Light and Dark. Contrast and focus visibility were the top findings of the 2026-10-14 audit. The app must be fully keyboard operable, including dialogs and the board.
