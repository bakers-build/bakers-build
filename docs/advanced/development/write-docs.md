---
title: Write the docs
description: "How to add or change a manual page: the areas, the writing standard, the length tiers, the link rules and the checks that pnpm build runs."
---

# Write the docs

**One manual, five areas, one writing standard. The build enforces the limits so reviewers can read for meaning.**

The manual is Markdown under `docs/`, rendered by VitePress from `website/`. Ask your agent to draft a page; the rules below are what it, and you, follow.

## Where a page goes

| Area | Reader question | Folder |
|---|---|---|
| Get started | Where do I start, what do I need? | `docs/get-started/` |
| Daily work | How do I work with tickets every day? | `docs/daily-work/` |
| Skills & Workflows | How does my project steer the agents? | `docs/skills-and-workflows/` |
| Addons | What can I swap or add? | `docs/addons/`, one page per package |
| Advanced | Configuration, operations, CLI, development | `docs/advanced/` |

`docs/index.md` renders at `/manual`, `docs/landing.md` at `/`. `decisions` and `conductor` are not rendered.

## Who we write for

Five readers, each with their own entry. Name the reader a page serves before you write it, and answer their question in the first 100 words.

| Reader | Enters through | Their questions |
|---|---|---|
| **Developer** | Get started › Set up bakers.build | What do I install, how long does it take? Does it work with my agent and subscription? How do I run my first ticket, notice the agent waiting, answer it? What if nothing starts? Do I stay in control of branch, merge and deployment? |
| **Developer lead** | Get started › Is bakers.build right for us? | What is bakers.build, what is it not? Does it fit our stack? Where do agents run, who sees our code, what is stored? Which agents and subscriptions, what does a run consume? How do our checks and standards come in? Hosted or self-run? How does it grow? Who may do what? |
| **Technical PM** | Daily work | How do I write a ticket the agent understands? What happens in qualification and spec, where do I approve? How do I read a summary and a review, when do I say no? Can I run small things on my machine? What is the team working on? How do I record time, who sees it? |
| **Simple PM** | Get started › Work in the browser | How do I connect claude.ai, Claude Desktop or Cowork? What can I do in the chat, where does it stop? Where do I follow tickets and answer? How do I accept a result? What do I see and not see? What if the connector stops? |
| **Contributor** | Addons › Build your own, Advanced › Development | How do I build an addon, with one complete example? How do I write and test a skill? How do I build from source, run tests, edit these docs? |

Everyone starts on their own machine with their own agent and subscriptions; worker servers and self-run servers come later and live under Advanced. bakers.build is swappable by design: agents, workspace managers, development environments and tunnels are addons, and a missing piece is "coming soon" only when it is confirmed, otherwise "build your own".

To check a page or an area, rate each question from 1 (no answer) to 6 (answered where the reader looks first, in their words, with evidence) on four dimensions: landing page, docs, language, length.

## Writing standard

- Second person. The heading answers the reader's question; the first line states the benefit in one sentence.
- Short sentences, one thought each. Verbs over noun chains. Positive phrasing: "You decide", not "nothing happens without you".
- bakers.build terms are allowed; explain or link each at first use on the page. States as code: `spec`.
- Outside Advanced and Addons › Build, no shell commands. Show the request to the agent as a text block. Where a command is unavoidable, collapse it:

  ```md
  ::: details Per CLI
  ...
  :::
  ```

- Task pages: numbered steps, a **You need** line, a **Done when** line, exactly one next step.
- Every behaviour claim has a source you checked: code, a test, or the running product. Mark what is coming soon as such; do not describe it as present.
- English only. Plain hyphen, no em dash. No ticket identifiers in prose.

## Length tiers

| Page | Prose words |
|---|---|
| `/manual` and every area index | 250 |
| Pages in Get started, Daily work, Skills & Workflows and Addons | 400 |
| Pages under Advanced, Engineering notes and Addons › Build your own | 1,500 |

Prose words exclude frontmatter, code blocks, link targets and HTML. Over the limit, split along a heading or move reference material to Advanced; do not raise the limit.

## One home per topic

Each fact lives on one page; other pages link to it. A moved page keeps its old URL in `website/routes.json`, pointing straight at the new page, never at another redirect. Headings people link to keep their wording, or the links are updated.

## Navigation

`website/.vitepress/manual.mjs` holds `AREAS`, `SIDEBAR` and `SRC_EXCLUDE`. A new page needs a sidebar entry, or the build fails. Addon pages are grouped as in the catalog at `/addons/`.

## What the build checks

`cd website && pnpm build` runs three steps and stops at the first failure:

1. `scripts/check-pages.mjs`: a page over its tier, without a tier, in no sidebar, or still `draft: true`.
2. `vitepress build`: dead page links and Markdown that does not compile.
3. `scripts/check-site.mjs` on the built HTML: links to missing pages or anchors, links to legacy routes, and `routes.json` entries that are still content, point nowhere or chain.

Run one step alone with `node scripts/check-pages.mjs <folder>/` or `node scripts/check-site.mjs /<route>/`. The `pages` CI job runs the same build on `develop` and publishes the result; the site therefore describes `develop`, and its version row names the commit.

## Documenting an addon

Every package under `bakers-cli/addons/` has exactly one page at `docs/addons/<package>.md`, linked from the catalog, with: purpose and reader, how to enable it, its options or an explicit "No options", a success check, limits, and a source link. A new addon ships with its page.
