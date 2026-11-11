# Introduction video: recording script

The script for the introduction video on the landing page. It introduces bakers.build, then
follows one ticket from a GitLab issue to `done`. You record screen and narration in one take
from this file; the cut, the captions and the player are made from that recording afterwards.

- Length of the final cut: 120 to 180 seconds. The narration below is about 415 words.
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

> Hi! This is bakers.build. Every developer is a baker with their own bakery: they knead the dough, and they decide when the bread is ready.
> The product manager places the orders. We call them tickets.
> The ovens are AI agents. They plan, build, check and deliver, always along the same line. But the baker stays the baker.
> How that line works is your recipe: a simple text file, right next to your code.

### 2. A ticket system for AI (about 18 s)

On screen: the project's ticket board, then the machines list with both conductors.

> It's a ticket system where people and AI work together.
> Everything an agent does stays on the ticket, so the next ticket can build on it.
> And the work runs on your own computer, a colleague's, or a machine in the background.

### 3. From an issue to a ticket (about 16 s)

On screen: the GitLab issue, without labels. Then create the ticket from it in bakers.build and
add the label `auto`.

> Let's follow one ticket. Our little shop wants its opening hours on the contact page.
> It starts as a normal issue in GitLab. That stays.
> We turn it into a ticket and add one label: auto.

### 4. Labels (about 16 s)

On screen: the ticket's Properties panel with the labels; rest the pointer on `auto`.

> Labels decide how much you want to be involved.
> With auto, a simple ticket just runs, and only asks you what is yours to decide.
> Without it, a person says yes at every step.
> So not everything needs a developer.

### 5. Qualification and plan (about 18 s)

On screen: the ticket in `qualification`, its acceptance comment; then in `plan`, its spec and
plan comments. Switch once to the GitLab issue: the label `doing` is there.

> First comes qualification. The agent makes sure it understood us: what do we want, and how will we know it's done?
> Then it writes a plan. You can read all of it on the ticket.
> And in GitLab, the issue now says: doing.

### 6. Stepping in (about 13 s)

On screen: herdr with the ticket's run tab; the agent's output scrolls. Type one short sentence
to the agent, for example "Use the 24-hour format."

> While the agent is busy, you can look into the oven.
> Open its window in a tool like herdr or Orca, read along, and if you have an idea, tell it in one sentence.

### 7. The ticket moves (about 20 s)

On screen: the agent's report of the technical problem on the ticket. Then Properties: change
**Conductor** to `dev-workstation`, remove `auto`.

> Our ticket turns out to be trickier than it looked.
> The agent doesn't guess. It says so.
> So we hand the ticket to a developer, and it continues on their machine.
> Tickets can move, to whoever is the right person.

### 8. Working (about 13 s)

On screen: the ticket in `working` on the developer's conductor, the run in herdr, then the
summary comment and the developer's confirmation.

> Now the ticket is in working. The agent builds the change and tests it.
> Our developer tries it out and says: looks good.

### 9. Review (about 13 s)

On screen: the ticket in `review`, the review comment with its verdict, the confirmation.

> Then comes the review. A second agent checks everything again, with fresh eyes.
> Only then does the developer give the go for the merge.

### 10. Done (about 13 s)

On screen: the ticket in `done`. Switch to the GitLab issue: the label changed to `review`.

> And done! In GitLab the label has changed once more, so your customer sees the progress without learning a new tool.
> If you like, it can report back even more.

### 11. Closing (about 11 s)

On screen: the landing page, the section "Bake it yourself or let us run the oven".

> Your code never leaves your machines.
> bakers.build is open source and free, whether you host it yourself or let us do it.
> Give it a real ticket, and see what comes out of the oven.

## Handover

Copy the raw recording, unedited, to `docs/video/raw/` in the ticket's worktree. The folder is
git-ignored; the raw file is never committed. Then restart the ticket's run.

The cut needs `ffmpeg` and `whisper.cpp` installed on the machine that runs it.
