# Record a measurement

Own the measurement write. The caller supplies the ticket UUID, the chosen definition, and its
computed values; this capability replaces that definition's namespace in the ticket's metrics and
optionally adds the definition's `label_term`, in one write.
The definitions, their fixed output format, and the authoring rules live in
[measurements](../../bb-verdict/measurements/README.md).

Before writing, check the caller's rows against the chosen definition: every declared value present,
each value numeric, and no value the definition does not declare. A violation is surfaced to the
human and never written.

Call `bakers_metric_write` ([tools](tools.md)) with `ticket`, `name` set to the definition id,
`rows` set to the checked rows and, when the definition declares a `label_term`, `label` set to it.
The tool replaces the rows under `<name>.`, keeps every other row and label, and adds the label by
name. Verify the returned rows.

Record the measurement **before** any state write: a transition retires the run, and a retired run
loses its write scope.

The observable result is the written namespace. This capability chooses no destination, publishes no
comment, and transitions nothing.
