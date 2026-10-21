# bakers.build Domain Language

bakers.build separates work execution from commercial sizing, internal effort allocation, and billing.
The commercial and worklog context consumes selected bakers.build identities without becoming part
of the bakers.build execution model.

## Execution context

**bakers.build Project**:
An execution and repository context in which Tickets are handled. It has no commercial or
worklog back-references.
_Avoid_: Engagement, contract, cost center

**bakers.build Ticket**:
The dispatch and delivery record handled by bakers.build. It has no LP, commercial role, or relationship to
the commercial and worklog context.
_Avoid_: Billable Unit, invoice line

**bakers.build Run**:
One execution attempt for a bakers.build Ticket. Its telemetry can inform allocation but it is never a
persistent Domain Link target or a measure of employee time.
_Avoid_: Time entry, billable session

## Commercial and worklog context

**Domain Link**:
A one-way reference owned by the commercial and worklog context whose bakers.build target is a Project
or Ticket. The target never stores a reverse relationship.
_Avoid_: Back-reference, Run link, bidirectional entity reference

**Engagement**:
A commercial context with one billing mode and one Harvest Project reference. Customer identity
remains owned by Harvest in phase one.
_Avoid_: bakers.build Project, customer record

**Delivery Item**:
The commercial representation of customer-visible scope. It owns its Engagement, commercial role,
LP, and Domain Link to a bakers.build Ticket.
_Avoid_: Ticket billing fields, invoice line

**Delivery Point (LP)**:
A unit of conventional software effort estimated without generative AI execution. It is not actual
employee time.
_Avoid_: Story Point, worked hour, Run duration

**Worklog**:
An employee's measured, inferred, or corrected internal effort allocation to a linked bakers.build Project
and optionally a linked bakers.build Ticket. The AI supplies concrete durations as `proposed` worklogs in a
Proposal, retaining original source measurements; they count as time only once the employee saves
them as `recorded`. Historical approved worklogs remain read-only.
_Avoid_: Customer time entry, Run footprint

**Submission**:
An owner-private group of Worklogs with a proposed, discarded, draft or submitted state and no
calendar period. Submitting leaves the Worklogs unchanged and editable.
_Avoid_: approval lock

**Proposal**:
A Submission in state `proposed` whose Worklogs the AI supplied and the employee has not saved yet.
Saving the week records them and turns the Proposal into a draft; discarding drops them.
_Avoid_: draft booking

**Timesheet (week grid)**:
The employee's own week as an editable grid: one row per project/ticket, one duration cell per day.
_Avoid_: approval sheet

**Account (Billing account)**:
A billing account belonging to a Project; one per Project is its default, and a Ticket/Epic
may link another.
Bookings retain its identity; it does not determine customer prices.
_Avoid_: Engagement, billing rate

**Billable Unit**:
An approved commercial bundle of Delivery Items whose LP values are snapshotted for export.
_Avoid_: bakers.build Ticket, Worklog, invoice

**Source Ticket**:
The customer-system issue resolved through a linked bakers.build Ticket's source identity. Its customer
acceptance defines delivery eligibility.
_Avoid_: Internal child Ticket, local done state
