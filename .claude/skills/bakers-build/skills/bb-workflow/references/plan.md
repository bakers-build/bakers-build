## Plan flow

Read in the `plan` state. The recipe's `plan` section supplies the method; this flow supplies the
bakers.build frame around it. The method produces no implementation.

1. Give the method the ticket's acceptance criteria, repository boundaries and the project's hints,
   with this ticket as the tracker target.
2. Publish its result through `@bakers-build/bb-publish-comment` as complete `spec`, `plan` and `test`
   comments. A bug publishes the cause and observed evidence as `debug_diagnose` instead of `spec`,
   and records a real RED observation before any fix.
3. The `test` comment separates applicable project checks from the functional regression and
   records per check its type, rationale, command/path, expected RED and GREEN, and the evidence
   it will report. Use the approved seams and reuse suitable coverage. A selected browser path uses
   `@bakers-build/bb-scenario` and its browser driver.
4. Obtain **one** approval covering the proposal (for a bug: cause, fix direction and verification
   plan); reuse approval already given for this scope. Record the confirmed comment IDs, then
   transition once to `working` under *transition*.
