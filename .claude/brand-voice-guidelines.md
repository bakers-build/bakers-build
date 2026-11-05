# bakers.build Brand Voice Guidelines

## Generation Metadata
- Created: 2026-10-22
- Version: 1.2 (brand foundation approved 2026-10-23: primary action, every station, core line, reading of the name, hosted case)
- Sources:
  - docs/decisions/brand-foundation.md (approved 2026-10-23; wins where it disagrees)
  - PRODUCT.md
  - repo `bakers-build/bakers-build` (develop): README.md, CONTEXT.md, WORKFLOW.md, website landing sections, docs/get-started, bakers-design readme and brand.html
  - old docs homepage (before the rename)
  - keytec.de (for contrast only)
  - owner decisions from design sessions 2026-10-20 to 2026-10-22
- Documents processed: 15
- Conversations analyzed: 0 (no call transcripts available)
- Discovery report used: No
- Overall confidence: Medium. The existing copy is consistent but was written before the bakery positioning. The tone layer comes from owner decisions, not from published copy.

---

## Executive Summary

bakers.build lets AI agents work a team's software tickets while a person takes part at every station and has the last word. The voice exists to lower the threshold of fear around AI.

**Reading of the name:** the bakers are the people (the agency lead, the client, the developer). They own the recipes and make the decisions. The agents are the tools and machines of the line.

**Who we speak to first:** the agency lead (P1), who is not a developer and wants their own ideas in the product without waiting and without breaking it. The copy must stay credible to developers (P2), stay plain enough for the agency's client (P3), and serve the technical solo founder (P4). Personas: `PRODUCT.md`.

It should feel like a very good bakery that also runs a production line. The work is careful and repeatable, nothing is hidden, and people stay in charge of the outcome. The reader should come away calm and informed, perhaps smiling once, and never pushed.

The existing copy already does the hardest part well. It is plain, declarative and second person, with ownership-led lines such as "Your agent, your machine, your rules." and "Agents work the tickets. You keep the workflow." That is the base to keep.

Three things are missing or wrong:
- **Wit:** the copy has almost none, but the owner wants a wink in the details.
- **Space metaphor:** the cosmos imagery (black hole, horizon, stars) works against both the bakery picture and calm.
- **Autonomy as a virtue:** phrases like "Agents are autonomous" stoke the fear the brand is meant to dissolve.

---

## We Are / We Are Not

| We Are | We Are Not |
|--------|------------|
| **Plain-spoken** — short declarative sentences, concrete nouns | **Jargon-heavy** — internal codenames, acronyms, "Model B" |
| **Reassuring by fact** — we say who decides and where the code stays | **Reassuring by adjective** — "safe", "trusted", "secure AI" with no proof |
| **People-first** — agents do the work, you decide | **Autonomy-first** — "fully autonomous", "set and forget", "replace your devs" |
| **Craft-precise** — numbers, states, real examples (BB-142, 12 passed) | **Vague or grand** — "revolutionize", "supercharge", "10x" |
| **Calm and self-confident** — no exclamation marks, no urgency | **Hyped or anxious** — countdowns, "don't get left behind" |
| **Dry wit in the details** — one wink per page, never at the user's expense | **Cute or punny** — bakery puns, "freshly baked code", emoji |
| **Honest about limits** — "Coming soon" says so; nothing invented | **Inflated** — invented customers, testimonials, benchmarks |

### Voice Attributes Detail

#### 1. Plain-spoken
- **What it means:** Say the thing directly, the way an experienced colleague explains it at the whiteboard.
- **How it shows up:**
  - Sentences are short, active and in the present tense.
  - Contractions are fine.
  - A three-beat rhythm is allowed but not every time.
- **What to avoid:** internal names (herdr, tuios, dropsh, BbRemote, "step skill", "Model B") in public copy.
- **Evidence:**
  - "Agents work the tickets. You keep the workflow." (HeroSection.vue)
  - "Start where you are" (ThreeWays.vue)
- **Confidence:** High

#### 2. Reassuring by fact
- **What it means:** We lower fear with verifiable statements, not soothing adjectives.
- **How it shows up:** We name the gate, the person and the place:
  - "you confirm the plan, the result and the verdict"
  - "Does my code leave my machines? No."
- **What to avoid:** "secure", "trustworthy" and "responsible AI" without a mechanism behind them.
- **Evidence:** FaqSection.vue; is-bakers-right-for-us.md
- **Confidence:** High

#### 3. People-first
- **What it means:** People are the subject of the important sentences. Agents are capable helpers, not actors with their own agenda.
- **How it shows up:**
  - "You decide", "you approve", "your team" all come before "the agent".
  - Agent work is described as preparation and craft; the decisions belong to people.
- **What to avoid:** "autonomous", "self-driving", "hands-off", "replaces".
- **Evidence:** "while you stay in charge" (what-is-bakers.md). "Agents are autonomous" (README.md) is the anti-pattern.
- **Confidence:** High (owner brand job plus existing copy)

#### 4. Craft-precise
- **What it means:** We show the work. Real states, real counts and real IDs make the system tangible and therefore less scary.
- **How it shows up:**
  - The technical state names stay: qualification, spec, coding, review, done.
  - Example runs use real-looking data.
- **What to avoid:** abstract value talk without an example.
- **Evidence:** ChatShowcase.vue ("12 passed, 0 failed", `BB-142`)
- **Confidence:** Medium

#### 5. Calm and self-confident
- **What it means:** We know what the product does and do not need to shout.
- **How it shows up:**
  - no exclamation marks;
  - no superlatives;
  - no urgency.
- **What to avoid:** hype verbs, FOMO, competitor bashing.
- **Evidence:** existing copy has no exclamation marks; owner decision "craft-precise, calm, self-confident"
- **Confidence:** Medium

#### 6. Dry wit in the details
- **What it means:** At most one small, warm wink per page or screen. It lives in microcopy (empty states, 404, FAQ, footer, loading) and never in headlines or decision moments.
- **How it shows up:**
  - "What if nothing starts?" (FaqSection.vue) is the model.
  - The bakery appears only as an undertone ("before the team is up, the prep is done").
  - There is never bakery vocabulary for product states.
- **What to avoid:**
  - puns such as "freshly baked", "half-baked" or "rise and shine";
  - Rohling, Im Ofen and Abkühlen;
  - emoji.
- **Evidence:** owner decision. The sources have almost no wit.
- **Confidence:** Low (no existing examples to calibrate)

#### 7. Honest about limits
- **What it means:** Everything we claim exists today. Anything that is not ready is labeled as such.
- **What to avoid:** customers, testimonials, benchmarks or pricing that do not exist.
- **Evidence:** "Coming soon" (is-bakers-right-for-us.md); PRODUCT.md "Must not be invented"
- **Confidence:** High

---

## Brand Personality

- **Archetype:** The Master Baker with a production line. An expert who runs a precise, repeatable process and still checks every batch personally.
- **If our brand were a person:** A calm senior engineer who opens the bakery at 4 am. They have set everything up so the machines do the heavy lifting. When you arrive they show you exactly what was done and what still needs your call. A dry joke happens, but only once.
- **Core values expressed in voice:**
  - people decide;
  - every run is traceable;
  - your code stays yours;
  - fewer choices, clearer defaults;
  - no tricks.

---

## Messaging Framework

### Core Line (shortlist, decided 2026-10-23)
- Headline candidate: **"You're the baker. Agents run the line."**
- Supporting line: **"Your recipes. Your line."**
- Rejected: "Agents do the dough work" (clumsy); "Fresh builds every day" (too close to the banned "freshly baked").

### Primary Value Proposition
AI agents work your tickets on your own machines. A person takes part at every station and has the last word.

Variations observed:
- "Agents work the tickets. You keep the workflow." (HeroSection.vue)
- "Your agent, your machine, your rules." (CtaSection.vue)
- "with you deciding at every step" (HeroSection.vue)

### Key Message Pillars

1. **A person at every station**
   - Core idea: Agents do the work at every station; a person confirms or approves at each one, and a person authorizes the merge. Who that is varies: the client in qualification and spec, a developer or the agency lead in coding and review.
   - When to use: hero, first objection and any demo opening.
   - Example phrasing: "You confirm the plan, the result and the verdict, and you authorize the merge."
   - Do not place the decision only at the end ("you decide what ships").
2. **Your code stays on your machines**
   - Core idea: Conductors run on your team's machines in git worktrees; there is no vendor cloud for code. This is true for the hosted offering too.
   - When to use: security questions, enterprise contexts, any mention of hosting.
   - Example phrasing: "Does my code leave my machines? No."
   - **Hosted case (required sentence wherever hosting is mentioned):** "Self-hosted or hosted, the conductors and your code stay on your team's machines. Hosting means only the control plane runs on bakers.build's servers. It holds tickets, handoffs and each run's footprint; your code and run transcripts stay with you." Without it, "we host" reads as a vendor cloud; without the last sentence, it hides what is stored.
3. **Every run is traceable**
   - Core idea: Who or what worked a ticket, when, with which result and what it cost.
   - When to use: managers, billing, trust.
   - Example phrasing: "Every run is recorded with its transcript and footprint."
4. **Bring your own agent**
   - Core idea: Claude Code, Codex and others run on your own subscription and can be swapped.
   - When to use: developers, cost questions.
   - Example phrasing: "Your agent, your machine, your subscriptions."
5. **Your recipe, your line**
   - Core idea: The rules live in WORKFLOW.md in your repo and go through code review. A text edit changes how the line works; own skills and add-ons extend it.
   - When to use: team leads, process-minded buyers, the agency lead who wants to adapt the line.
   - Example phrasing: "Code-reviewed, not tribal knowledge."
6. **Open source, then more when you need it**
   - Core idea: The core is open source (MIT) and free. bakers.build can run it for you, and add-ons such as time tracking extend it. Open source is the offer itself, not only a proof point.
   - When to use: cost questions, the "Free, self-hosted or hosted" section, developer audiences.
   - Example phrasing: "Bake for free. Let us run the oven for you. Add tools when you need them."
   - Never name prices or tiers until they are decided.

### Competitive Positioning
- **vs. cloud coding agents:** bakers.build runs on your machines, and a person takes part at every station.
- **vs. a plain ticket tracker:** The tickets actually get worked, and every run is recorded.
- **vs. the status quo (agents in individual terminals):** One shared system, three surfaces (browser, terminal, Claude Code), the same truth everywhere.

---

## Tone-by-Context Matrix

| Context | Formality | Energy | Technical Depth | Key Principle |
|---------|-----------|--------|-----------------|---------------|
| Website / landing | Medium | Medium | Low–Medium | Make the offer clear in one line, show one real run |
| Demo invitation / outreach (quiet path) | Medium | Medium | Low | Name the reader's situation, offer a 30-minute look with their repo |
| Docs | Medium | Low | High | Task first, exact commands, no marketing |
| App UI microcopy | Low–Medium | Low | Medium | Say what happened and what the person can do next |
| Empty states, 404, loading | Low | Medium | Low | The one place for the wink |
| Release notes / changelog | Medium | Medium | Medium–High | What changed, why it matters, one sentence each |
| Enterprise / security answers | High | Low | High | Mechanism, then the answer: who, where, how |

### Context-Specific Guidelines

#### Website / landing
- **Overall tone:** Calm confidence; people first.
- **Do's:**
  - Lead with who decides.
  - Show a real-looking run.
  - Make one primary action visible: **Start a free trial** (we set up the workspace). Self-host for free / start with your agent is secondary; book a demo is a quiet path.
  - Say "you authorize the merge", never "merge in the browser": merges happen in the terminal or the GitLab merge request.
  - Use the line metaphor (line, station, recipe, roll) here and in docs, never in the app or terminal.
- **Don'ts:**
  - cosmos imagery or copy ("horizon", "black hole");
  - "autonomous";
  - more than one wink.
- **Example:** "You're the baker. Agents run the line." (headline candidate)
- **Superseded:** "AI agents work your tickets. You decide what ships." ("tickets" is jargon for P1 and P3; the decision sits only at the end)

#### Demo invitation / outreach
- **Opening approach:** Start with the reader's work, not with AI.
- **Do's:**
  - Be specific about time and what they will see.
  - Use "you" and the first name where appropriate.
- **Don'ts:** urgency, "revolutionary", attachments with claims we cannot prove.
- **Example:** "Thirty minutes, your repo, one real ticket. You'll see exactly where the agent works and where your team decides."

#### App UI microcopy
- **Do's:**
  - Use the state names as they are.
  - Write in the active voice.
  - Make the next step explicit ("Waiting for your review").
- **Don'ts:** bakery terms, jokes in error or decision states.
- **Example:** "BB-151 is ready for review. The agent ran 12 tests; all passed."

#### Empty states and small moments
- **Do's:** one dry, warm line, then the useful action.
- **Example (approved tone):** "Before your team is up, the prep is done."
- **Anti-example (rejected):** a joke about agents and coffee waiting; jokes that carry no product fact.

---

## Terminology Guide

### Must-Use Terms
| Term | Usage | Instead Of | Example |
|------|-------|------------|---------|
| bakers.build | Product name everywhere, always lowercase with the dot, also at sentence start and in headlines (it is the domain) | the old product name, Bakers Build, Bakers, BB (except ticket prefix) | "bakers.build runs on your machines." |
| ticket | Unit of work | issue, task (in our UI) | "Create a ticket." |
| run | One agent execution on a ticket | job, session | "Every run is recorded." |
| conductor | The process on a team machine that claims tickets | daemon, worker, node agent | "Start a conductor on your laptop." |
| control plane | The shared server | backend, cockpit | "The control plane tracks projects and runs." |
| qualification, spec, coding, review, done | Ticket states, always lowercase in UI | code, handler names, bakery terms | "BB-151 moved to review." |
| station | Website and docs term for one step of the line (maps to a ticket state); a person takes part at each one | gate, checkpoint, handler | "A person at every station." |
| line | Website and docs term for the sequence of stations a ticket passes | pipeline (in marketing), flow | "Every ticket passes the same line." |
| recipe | Website and docs term for `WORKFLOW.md` | config, playbook | "Change the recipe, and the line changes." |
| self-hosted, hosted | The two ways to run bakers.build | on-prem, cloud version, SaaS | "Self-hosted or hosted, your code stays on your machines." |
| add-on | Paid extension of the open source core | plugin, premium feature, upgrade | "Time tracking is an add-on." |

### Preferred Terms
| Term | Usage | Example |
|------|-------|---------|
| your team, you | Subject of decision sentences | "You approve the plan." |
| prepare, draft, work | What agents do | "The agent drafts the spec." |
| footprint | Tokens, turns and tool calls of a run | "See each run's footprint." |

### Avoid These Terms
| Term | Reason | Alternative |
|------|--------|-------------|
| autonomous, hands-off, self-driving | Feeds AI fear; contradicts "people decide" | "works the ticket while you stay in charge" |
| daemon, node agent, worker | Inconsistent names for conductor | conductor |
| cockpit, dashboard (for the web app) | Inconsistent | web app, board |
| handler | Internal | state |
| horizon, black hole, cosmos | Old visual metaphor | none |
| gate (as the main idea) | Places the decision at a few points, not at every station | station |
| "nothing ships broken", "never breaks" | Absolute promise we cannot back | name the mechanisms: pipeline tests, browser scenarios, review verdict, a person authorizes the merge |
| custom solution, we build it for you | There is no customization service | "adapt your line" via WORKFLOW.md, skills, add-ons |

### Never-Use Terms
| Term | Reason |
|------|--------|
| keytec (and keytec URLs) in public copy | No parent-brand reference |
| Rohling, Im Ofen, Abkühlen, "freshly baked", "half-baked" | No bakery vocabulary in product or puns |
| "replace your developers" and similar | Opposite of the brand job |
| invented customer names, testimonials, benchmarks, prices | None exist |
| case study (for example lines) | There are no public customers; example lines are labeled as examples |

---

## Content Examples

### Excellent Examples
> "Agents work the tickets. You keep the workflow." (HeroSection.vue)

The sentence is short and declarative, with the person in the second half as the one in control. It needs no adjectives.

> "Does my code leave my machines? No." (FaqSection.vue)

This reassures with a fact. The one-word answer is confident and slightly dry.

### Examples to Avoid
> "Agents are autonomous." (README.md)

This makes the machine the hero and frightens the cautious reader. Better: "Agents work each ticket from spec to review; your team approves every step that matters."

> "Tickets falling into the bakers.build horizon" (CosmosPipeline.vue)

The cosmic metaphor is mystifying when it should clarify. Better: "Every ticket passes the same five steps, and you can see each one."

---

## Confidence Scores

| Section | Confidence | Basis | Sources |
|---------|------------|-------|---------|
| Voice Attributes | Medium | Strong existing copy for 1–4 and 7; 5–6 come from owner decisions only | 10 |
| Messaging Framework | High | Same five claims repeated across site, FAQ and docs | 8 |
| Tone Matrix | Medium | Website and docs observed; outreach and microcopy inferred | 6 |
| Terminology | Medium | Clear core terms; several inconsistencies need decisions | 7 |
| Wit / wink | Medium | One approved and one rejected owner sample | 2 |

---

## Open Questions for Team Discussion

### Resolved by owner (2026-10-22)
1. **Name:** `bakers.build` everywhere, lowercase with the dot, because it is also the domain. Never "Bakers Build".
2. ~~**Primary action:** "Book a demo" is primary; "Start with your agent" is the secondary path for developers.~~ Replaced on 2026-10-23, see below. **Open source (MIT) stays prominent.**
3. **Language:** English only for website, docs and app. If German marketing comes later, use "du".
4. **Counter captions (website illustration):** "weighs it · cuts it up · bakes it · glazes it · you ship it" stay. Bakery verbs are allowed only as captions of the tool illustrations on the website, never as state names in the app or terminal.
5. **Wit calibration:** Rejected: a joke line about the agents and the coffee waiting ("off-brand: a joke for its own sake"). Approved: "Before your team is up, the prep is done." The wink is a quiet bakery undertone carried by a true product fact, not a gag. Rule: a wink must still be a factual statement about the product.

### Resolved by the brand foundation (2026-10-23)
1. **Primary action:** "Start a free trial" is primary (corrected the same day: hosting is paid and workspaces are set up by hand, so there is no free self-service sign-up). "Self-host / start with your agent" is secondary. "Book a demo" is a quiet path. Reason: the first goal is reach.
2. **Every station, not gates:** a person takes part at every station and has the last word. "Station" replaces "gate" as the public word.
3. **Core line:** see Messaging Framework. One of the two shortlisted lines is chosen in the copy step.
4. **Reading of the name:** the bakers are the people; the agents are the tools and machines of the line.
5. **Hosted case:** the required sentence in pillar 2.
6. **keytec:** unchanged. bakers.build is a standalone brand, also as the hosting brand; keytec does not appear in public copy.

### Medium Priority
5. ~~**Is "gate" the public word for human decision points?**~~ Resolved: "station" (see above).
6. **Ticket key prefix:** the repo already uses BB-. Recommendation: keep BB- and update PRODUCT.md.

### Low Priority
7. **Role of the bakery picture in copy:** Recommendation: never named in UI. On the website, at most one sentence of origin story (About or footer).

---

## Data Gaps & Recommendations

- [ ] No sales or demo conversations: record 2–3 demo calls and run conversation analysis to calibrate tone and objections.
- [ ] No wit examples: collect 10 sample microcopy lines and have the owner rate them.
- [ ] Rename leftovers and keytec references are still in the repo (README, WORKFLOW.md, website config, bakers-design readme, brand.html): track as part of the rebrand epic.
- [ ] Three conflicting visual systems in the repo (bakers-design light keytec × GitLab hybrid, website dark cosmic purple, README green logo): to be replaced by one identity after these voice guidelines are approved.

---

## Appendix: Sources

| # | Source | Platform | Type | Key Sections Used | Confidence |
|---|--------|----------|------|-------------------|------------|
| 0 | docs/decisions/brand-foundation.md | local repo bakers-build | AUTHORITATIVE (owner-approved 2026-10-23) | audience, open core, core line, every station, primary action | High |
| 1 | PRODUCT.md | predecessor repo | AUTHORITATIVE (owner-confirmed) | brand job, tone, constraints | High |
| 2 | Owner decisions 2026-10-20…22 | design sessions | AUTHORITATIVE | name, no bakery vocabulary, demo action, no keytec | High |
| 3 | HeroSection.vue, CtaSection.vue, ThreeWays.vue, FaqSection.vue | GitLab bakers-build/bakers-build | OPERATIONAL (published copy) | voice, messages | High |
| 4 | ConceptsGrid.vue, CosmosPipeline.vue, FeatureStrip.vue, ChatShowcase.vue | GitLab | OPERATIONAL | terminology, anti-patterns | Medium |
| 5 | docs/get-started/what-is-bakers.md, is-bakers-right-for-us.md | GitLab | OPERATIONAL | messages, honesty | High |
| 6 | README.md, CONTEXT.md, WORKFLOW.md | GitLab | TECHNICAL | terminology, leftovers | Medium |
| 7 | bakers-design readme, brand.html | GitLab | DESIGN (stale) | visual facts, conflicts | Medium |
| 8 | Old docs homepage (before the rename) | GitLab Pages | HISTORICAL | consistency check | Medium |
| 9 | keytec.de | web | CONTEXT ONLY | contrast (formal "Sie", award-led) | — |
