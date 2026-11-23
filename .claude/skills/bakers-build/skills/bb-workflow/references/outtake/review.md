# Outtake at review

- **Outcome** names the verdict, `OK` or `Not OK`.
- **Problems**: open finding IDs and required repair; cite the verdict under
  [ticket writes](../ticket-writes.md).
- **Success**: reused check IDs/original revisions separate from fresh results; passing ACs stay
  in typed verdict.
- **Manual review**: per `test_as` persona its fresh login link and what it should see, the
  verdict's open findings first; a missing persona stays listed as **missing**. Then open human
  work, the environment, the MR link and `base → head`.
- **Next action**: on `OK` the merge decision; on `Not OK` the route the verdict's causes give.
