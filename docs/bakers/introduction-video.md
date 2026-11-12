# Introduction video: recording script

The script for the introduction video on the landing page. It introduces bakers.build, then
follows one ticket from a GitHub issue to `done`. You record screen and narration in one take
from this file; the cut, the captions and the player are made from that recording afterwards.

- Estimated length of the final cut: about 205 seconds at 150 words per minute. The narration
  below is 514 words; confirm the timing in the dry run.
- Language: English. Say "bakers dot build".
- Lines starting with `>` are the narration, word for word. Everything else is direction.

## The demo task

One small feature in the demo repository `northside-shop` on GitHub, a small React app for the
fictional Northside Bakery whose data file has no opening hours:

- GitHub issue: **Show opening hours on the contact page**
- Text: "Customers call to ask when we are open. Show the opening hours on the contact page."

The story: you create the ticket from the issue and approve its acceptance criteria and its
plan yourself. The plan finds that opening hours need a new field, a change to the data model.
That is a developer's call, so you move the ticket to a developer's conductor, and the developer
confirms the result and the review there.

You may swap the task. Keep it small, and keep one reason why it turns out harder than expected.

## Preparation

Everything on screen must be demo data: no real customer, colleague, address or token.

1. **Site.** A local `recipe-test` site, signed in as `north-lead` through the *Test personas*
   buttons on `/user/login`. Workspace: Northside Bakery.
2. **Demo repository.** `northside-shop` on GitHub, reset to its tag `demo-start`, with the
   issue above open and without labels. Its README describes the reset.
3. **bakers.build project.** Connected to that repository, recipe and skills installed, the
   conductors able to push and open pull requests there.
4. **Two conductors** registered for the project, with demo names: yours (`lead-laptop`) and a
   developer's (`dev-workstation`). Both run herdr.
5. **herdr** open in its default session, font large enough to read at 1080p. The shell prompt
   shows no real user or host name.
6. **Browser.** One window at 1920×1080, 100 % zoom, bookmarks bar hidden, no other tabs, no
   extensions visible, a clean profile without autofill. Tabs in this order: landing page,
   ticket board, GitHub issue.
7. **System.** Notifications off, clock and menu bar hidden if they show anything personal.
8. **Sound.** Headset or a close microphone, a quiet room, a ten-second test recording played
   back once.

## Dry run before recording

Two steps of the story were not tried when this script was written. Run the whole story once
without recording and check them:

1. **The move.** After you approved the plan, set **Properties → Conductor** to
   `dev-workstation`. The developer's conductor must pick the ticket up in `working`, and the
   run must ask the developer for confirmation there.
2. **The pull request.** The `working` run must open a pull request in the demo repository,
   and at `done` it must be merged.

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

### 1. Introduction (about 69 s)

On screen: the landing page hero. From "Your workflow lives", scroll slowly to the
line with its four stations.

> Everyone on the team is using AI, but each developer has built their own setup. Different skills, different tools, different workflows.
> Some projects already use worktrees to run tasks in parallel. Others don't. Keeping all of that working together becomes a job in itself.
> That's why we built bakers.build: one tool for the team, with a shared workflow everyone follows.
> I'm Christian, and this started with our team of seven developers and two project managers.
> Looking for a better way led us to OpenAI's Symphony spec.
> So we built Gaia on Symphony's spec. The team decides on one workflow, and the agents follow it, on our own machines, with the AI subscriptions we already had.
> It worked better than expected. We're clearly faster, everyone runs several tickets in parallel, and nobody babysits anymore.
> So we made it open source as bakers.build. The name? We kept asking, "Is that ticket baked yet?"
> Your workflow lives in a text file next to your code. The agents follow it; you steer.
> Let's give it a ticket.

### 2. A ticket system for AI (about 18 s)

On screen: the project's ticket board, then the machines list with both conductors.

> It's not a classic ticket system. It's one where people and AI work together.
> Everything an agent does stays on the ticket, so the next ticket can build on it.
> And the work runs on your own computer, a colleague's, or a remote worker.

### 3. From an issue to a ticket (about 14 s)

On screen: the GitHub issue. Then create the ticket from it in bakers.build.

> Let's follow one ticket. Our little shop wants its opening hours on the contact page.
> It starts as a normal issue on GitHub. That stays.
> We turn it into a ticket, and the agent starts.

### 4. People decide (about 13 s)

On screen: the agent's question on the ticket, then your approval.

> From here on, the agent does the work, and a person decides at every step.
> You choose who that is: you, a developer, or your customer.
> Nothing moves on without a yes.

### 5. Qualification and plan (about 14 s)

On screen: the ticket in `qualification`, its acceptance comment; then in `plan`, its spec and
plan comments.

> First comes qualification. The agent makes sure it understood us: what do we want, and how will we know it's done?
> Then it writes a plan. We read it on the ticket and approve it.

### 6. Stepping in (about 14 s)

On screen: herdr with the ticket's run tab; the agent's output scrolls. Type one short sentence
to the agent, for example "Use the 24-hour format."

> While the agent is busy, you can look over its shoulder.
> Open its window in a tool like herdr or Orca, read along, and if you have an idea, tell it in one sentence.

### 7. The ticket moves (about 16 s)

On screen: the plan's note that the data model must change. Then Properties: change
**Conductor** to `dev-workstation`.

> Our ticket turns out to be trickier than it looked.
> The agent doesn't guess. It says so.
> So we hand the ticket to a developer, and it continues on their machine.
> Tickets can move, to whoever is the right person.

### 8. Working (about 9 s)

On screen: the ticket in `working` on the developer's conductor, the run in herdr, then the
summary comment, the contact page with its opening hours in the browser, and the developer's
confirmation.

> Now the ticket is in working. The agent builds the change and tests it.
> Our developer tries it out and says: looks good.

### 9. Review (about 10 s)

On screen: the ticket in `review`, the review comment with its verdict, the confirmation.

> Then comes the review. A second agent checks everything again, with fresh eyes.
> Only then does the developer give the go for the merge.

### 10. Done (about 16 s)

On screen: the ticket in `done`. Switch to GitHub: the merged pull request.

> And done! The change is merged on GitHub, as a normal pull request. Your tools stay the same.
> On GitLab, the issue even gets a status label along the way, and your own workflow rules can report back more.

### 11. Closing (about 14 s)

On screen: the landing page, the section "Bake it yourself or let us run the oven".

> Your code never leaves your machines.
> bakers.build is open source and free, whether you host it yourself or let us do it.
> Give it a real ticket, and see what comes out of the oven.

## Handover

Copy the raw recording, unedited, to `docs/video/raw/` in the ticket's worktree. The folder is
git-ignored; the raw file is never committed. Then restart the ticket's run.

The cut needs `ffmpeg` and `whisper.cpp` installed on the machine that runs it.
