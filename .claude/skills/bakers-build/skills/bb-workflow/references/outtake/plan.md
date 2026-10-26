# Outtake at plan

Read by [the outtake](../outtake.md) for a `plan` handoff.

- **Lead section** `### 📖 Spec digest`, directly after *Outcome*: written from the published
  `spec` (a bug: `debug_diagnose`), `plan` and `test`, at most 200 words, self-contained, with
  exactly these three parts:
  - **Entities** — entities and fields the change creates or alters, or "none".
  - **Architecture** — the core decisions with the key classes and services: where the logic lives
    and why.
  - **Tests** — which tests, at which seam, proving what.

  The assignee's *Recipient profile* sets depth and emphasis: a request for reasons gives each test
  its reason, a request for brevity keeps names and decisions only, one line
  per part. Every part appears, also when
  the profile asks to skip one.
- **Manual review**: the published proposal comments to read.
- **Next action**: ask for the one approval of the proposal.
