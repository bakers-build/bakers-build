# Outtake at working

Read by [the outtake](../outtake.md) for a coding handoff.

- **Success**: one line per acceptance criterion — AC ID, `PASS` or `FAIL`, test path, command and
  the result's revision, all from its result record. A RED revision appears only where the record
  holds one; never infer it.
- **Problems**: every `FAIL`, every blocked check, and every test written but not run.
- **Manual review**: per `test_as` persona its issued login link and what it should see; a missing
  persona stays listed as **missing**. Then the MR link and `base → head`.
- **Next action**: all PASS — the coding gate's concrete question; any FAIL — the fix, with no
  hand-off to review.
