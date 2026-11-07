# Browser paths and inspection

Read only when the confirmed scope and verification plan select a browser surface. Automated
browser suites, including Playwright, run through [verify](verify.md). Apply the
[result records](results.md); personas come from qualification's `test_as`, environment and access
from the frame's *Provision* rule. Preserve anonymous, intentionally denied and missing personas;
unresolved access blocks the dependent path, and an administrator session is never a substitute.

## Paths

At plan, prepare one shortest complete observable path per required persona. Each path supplies its
check ID, AC IDs, persona, environment, starting URL, prerequisites, ordered actions and expected
visible observations; for a bug, the current failing observation. Separate checks when expected
outcomes or personas differ. Use visible interface labels and [audience and register](boundaries.md).
An agent path adds auth-state loading, stable selectors where useful and before/after screenshot
points; a human path must be executable by the intended reviewer with the supplied access. Keep
purpose, mode and permanent versus one-off coverage distinct in `checks`. Preparing a path executes
nothing, provisions nothing and creates no account.

## Inspection

For a confirmed path with mode `agent`, use `playwright-cli` where the project's testing setup
runs it; a sandboxed agent usually reaches the site only through a runtime tool such as
`ddev_exec`, which runs outside the sandbox. Load the persona's saved auth state
before the first authenticated action and confirm the actual identity; use an anonymous session for
an anonymous path. Run the ordered actions against the resolved absolute URL. Record persona,
environment, starting URL, actions or selectors, and expected versus observed behavior. Capture
the required before/after screenshots. A denial can pass when it is the confirmed expected
observation.

Return one `results` record per check, linked through its check ID to all covered ACs, with the
shared statuses, durable evidence and immutable revision. A successful one-off walk is not
permanent regression coverage. An intentional diagnosis RED is recorded as failed with the
observed defect; coding and review never treat it as GREEN. Missing observations are blocked or
not_run, never passed. Agent inspection leaves `manual_review` pending until a human records their
observation.

## Artifacts

Follow the transient root in [evidence and links](evidence.md). Under its `playwright/` tool
directory, place captured output in `logs/`, screenshots in `images/`, and any one-off driver at
the tool root. Captured logs start with the command; use subject names and state suffixes. Keep
traces and videos under the tool root, not in `logs/`.

At review read coding's captured output and screenshots in the shared worktree, retain the original
revision and scope, and explain any necessary rerun; fresh review artifacts use the `-review`
suffix. If another machine lacks required artifacts, report the gap and request or perform a fresh
authorized inspection; absent evidence cannot pass.

Return paths and records to the state file. Publish no comment and choose no transition; the
outtake renders observed results separately from the human walkthrough.
