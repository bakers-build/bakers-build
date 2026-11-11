# Introduction video: recording script

The script for the introduction video on the landing page. It introduces bakers.build, then
follows one ticket from a GitLab issue to `done`. You record screen and narration in one take
from this file; the cut, the captions and the player are made from that recording afterwards.

- Length of the final cut: 120 to 180 seconds. The narration below is about 380 words.
- Language: English. Say "bakers dot build".
- Lines starting with `>` are the narration, word for word. Everything else is direction.

## The demo task

One small feature in a GitLab demo project, `northside/shop`:

- GitLab issue: **Show opening hours on the contact page**
- Text: "Customers call to ask when we are open. Show the opening hours on the contact page."

The story: the ticket starts with the label `auto` and runs alone through qualification and
plan. The plan finds that opening hours need a new field, a change to the data model. An `auto`
ticket reports such a change to the developers instead of deciding it. You move the ticket to a
developer's conductor, and the developer confirms the result and the review there.

You may swap the task. Keep it small, and keep one reason why it turns out harder than expected.

## Preparation

Everything on screen must be demo data: no real customer, colleague, address or token.

1. **Site.** A local `recipe-test` site, signed in as `north-lead` through the *Test personas*
   buttons on `/user/login`. Workspace: Northside Bakery.
2. **GitLab demo project.** `northside/shop` in a demo group, with the issue above and without
   labels on it. The project has the labels `doing` and `review`, the ones the
   `bb-phase-transition` table of its `WORKFLOW.md` names.
3. **bakers.build project.** Connected to that repository, recipe and skills installed, `glab`
   signed in on both conductor hosts.
4. **Two conductors** registered for the project, with demo names: yours (`lead-laptop`) and a
   developer's (`dev-workstation`). Both run herdr.
5. **herdr** open in its default session, font large enough to read at 1080p. The shell prompt
   shows no real user or host name.
6. **Browser.** One window at 1920×1080, 100 % zoom, bookmarks bar hidden, no other tabs, no
   extensions visible, a clean profile without autofill. Tabs in this order: landing page,
   ticket board, GitLab issue.
7. **System.** Notifications off, clock and menu bar hidden if they show anything personal.
8. **Sound.** Headset or a close microphone, a quiet room, a ten-second test recording played
   back once.

## Dry run before recording

Two steps of the story were not tried when this script was written. Run the whole story once
without recording and check them:

1. **The move.** After the `auto` ticket reports its technical problem, set **Properties →
   Conductor** to `dev-workstation` and remove the label `auto`. The developer's conductor must
   pick the ticket up in `working`, and the run must ask for confirmation there.
2. **The issue label.** The ticket must show the GitLab issue as its origin, and the issue must
   get `doing` at the first transition and `review` at `done`.

If one of them fails, record the scene anyway: say its narration over the ticket page and show
nothing that did not happen. Tell the cutting run which scene it was.

The dry run also gives you the waiting times. The agent works for minutes; keep recording and
stay silent while you wait. Waiting is cut out later.

## Recording rules

- One continuous screen recording at 1920×1080 with live narration, scenes in the order below.
- Do the action, then speak, or speak while the result is on screen. Never speak over a loading
  page.
- After a slip, pause for two seconds and repeat the whole sentence from its start. Do not
  stop the recording.
- Move the pointer slowly and rest it next to what you talk about.
- Leave two seconds of silence between scenes.
- No camera, no slides.

## Scenes

### 1. Introduction (about 22 s)

On screen: the landing page hero; scroll slowly to the line with its four stations.

> This is bakers.build, a ticket-driven software factory for teams.
> You write tickets for AI, and agents work them automatically along a fixed line: plan, build, review, ship.
> A recipe seasons how each station works, and the line itself lives in WORKFLOW.md in your repository.

### 2. A ticket system for AI (about 18 s)

On screen: the project's ticket board, then the machines list with both conductors.

> It is not a classic ticket system. It is a ticket system for AI.
> Every step stays on the ticket, and new tickets find earlier work again.
> The work runs on your own machine, a colleague's machine or a remote worker.

### 3. From an issue to a ticket (about 16 s)

On screen: the GitLab issue, without labels. Then create the ticket from it in bakers.build and
add the label `auto`.

> Let's follow one ticket. Our shop needs its opening hours on the contact page.
> It starts as a normal GitLab issue, because your issues stay where they are.
> We create a ticket from it and add the label auto.

### 4. Labels (about 16 s)

On screen: the ticket's Properties panel with the labels; rest the pointer on `auto`.

> Labels steer how a ticket runs.
> With auto, a simple ticket runs on its own and asks only what is yours to decide.
> Without it, a person approves at every station.
> So not every ticket has to pass through a developer's hands.

### 5. Qualification and plan (about 18 s)

On screen: the ticket in `qualification`, its acceptance comment; then in `plan`, its spec and
plan comments. Switch once to the GitLab issue: the label `doing` is there.

> In qualification, the agent looks for earlier work and writes acceptance criteria you can check.
> In plan, it writes the spec, the plan and the tests it will run. All of it lands on the ticket.
> And on the GitLab issue, a label now says: doing.

### 6. Stepping in (about 13 s)

On screen: herdr with the ticket's run tab; the agent's output scrolls. Type one short sentence
to the agent, for example "Use the 24-hour format."

> While the agent works, you can look into the oven.
> In a client such as herdr or Orca you read along, and you step in with one sentence whenever you want.

### 7. The ticket moves (about 20 s)

On screen: the agent's report of the technical problem on the ticket. Then Properties: change
**Conductor** to `dev-workstation`, remove `auto`.

> This ticket turns out harder than expected: opening hours need a change to the data model.
> The agent does not guess. It reports the problem.
> So we move the ticket to a developer's conductor.
> A ticket can move: to another person, and to another machine.

### 8. Working (about 13 s)

On screen: the ticket in `working` on the developer's conductor, the run in herdr, then the
summary comment and the developer's confirmation.

> In working, the agent builds on its own branch, tests first.
> The developer reads the summary, tries the result and confirms it.

### 9. Review (about 13 s)

On screen: the ticket in `review`, the review comment with its verdict, the confirmation.

> In review, a second agent checks the change independently and gives a verdict.
> The developer confirms it and authorizes the merge.

### 10. Done (about 13 s)

On screen: the ticket in `done`. Switch to the GitLab issue: the label changed to `review`.

> Done. On the GitLab issue the label has changed again, so your customer sees the progress without leaving GitLab.
> Your own workflow rules can report back more.

### 11. Closing (about 11 s)

On screen: the landing page, the section "Bake it yourself or let us run the oven".

> Your code stays on your machines.
> bakers.build is open source, and self-hosted or hosted, both are free.
> Try it on a real ticket.

## Handover

Copy the raw recording, unedited, to `docs/video/raw/` in the ticket's worktree. The folder is
git-ignored; the raw file is never committed. Then restart the ticket's run.

The cut needs `ffmpeg` and `whisper.cpp` installed on the machine that runs it.
