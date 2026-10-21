# Conductor JSON:API Contract (Phase 3)

Auth: `simple_oauth` in production, with one Drupal user per conductor node. The node role needs `register bakers conductor`, `claim bakers tickets`, and read access to bakers.build tickets/runs. Functional tests use `basic_auth`; the server-side access and guard logic is auth-transport independent.

| Logical operation (`03-control-plane.md` §1) | HTTP |
|---|---|
| `heartbeat_conductor()` | `POST /jsonapi/bakers/heartbeat` with the full registration. Registration omits `current_load` so a startup ping cannot overwrite a live process's reported load; a later heartbeat supplies load. Returns the conductor document (`data.id` is the UUID). |
| `offline_conductor()` | `POST /jsonapi/bb_conductor/{uuid}/offline`. No body values. Requires entity update plus ownership (or instance admin). Sets offline, lease expiry to now, reported load 0, and recomputes the machine aggregate. Idempotent; does not create. Older generic registration upsert and status PATCH callers fail once server-maintained fields are protected; ship a compatible CLI with that restriction. |
| `claim_next_ticket()` | `POST /jsonapi/bakers/claim-next` with optional `{data:{attributes:{lease_seconds,machine_id,session_user_id}}}`. Returns `201` with a `bb_run--bb_run` document or `204` when nothing is eligible. |
| `fetch_matching_tickets()` | `GET /jsonapi/bb_ticket/bb_ticket?...` for candidates, board, observability, and reconcile reads. This is not the primary dispatch path. |
| `claim_ticket()` | `POST /jsonapi/bb_ticket/{ticket_uuid}/claim` with optional `{data:{attributes:{lease_seconds,machine_id,session_user_id}}}`. Returns `201` with a `bb_run--bb_run` document or `409 claim_conflict`. |
| `renew_run()` | `PATCH /jsonapi/bb_run/bb_run/{uuid}` for `claim_expires_at` and optional active `state`. Expired leases cannot be renewed. |
| `release_run()` | `PATCH /jsonapi/bb_run/bb_run/{uuid}` with terminal `state` (`released`, `succeeded`, `failed`) and optional observability fields. |
| `fetch_ticket_states_by_ids()` | `GET /jsonapi/bb_ticket/bb_ticket?filter[id][condition][path]=id&filter[id][condition][operator]=IN&filter[id][condition][value][]=...` |

## Dispatch

`claim_next_ticket()` is the conductor poll operation. The server filters candidates by the conductor's `project_id` and — **only when the conductor's registered `states` list is non-empty** — by state (an empty/absent list applies no state filter, so the conductor serves every claimable state in its project), prefilters by server-managed dispatch fields, sorts by SPEC §10.4 (`priority` null-last, `created`, `identifier`), then applies the full SPEC §10.3 eligibility check (state type, assignee priority, blockers, lease) before creating the run lease.

The stock JSON:API candidate filter may use:

```text
filter[state][condition][path]=state
filter[state][condition][operator]=IN
filter[state][condition][value][]=todo
filter[state][condition][value][]=coding
filter[blockers][condition][path]=has_open_blockers
filter[blockers][condition][value]=0
filter[lease-missing][condition][path]=claim_lease_expires_at
filter[lease-missing][condition][operator]=IS NULL
filter[lease-expired][condition][path]=claim_lease_expires_at
filter[lease-expired][condition][operator]=<
filter[lease-expired][condition][value]=<now>
```

That read is intentionally only a candidate read. The assignee priority rule and state-type checks are enforced by the claim endpoints, not trusted from the stock filter.

## Lease Semantics

Claim creates a `bb_run` with `state=claimed`, `claim_owner=machine_id`, `claim_expires_at=now+lease_seconds` (default 300 seconds, max 3600), `state_at_start`, `handler_id`, and optional `session_user_id`.

The standard claim path refuses a ticket when a terminal run already exists for
the ticket's current state (`bb_run.state_at_start == bb_ticket.state`).
This prevents an unchanged dispatchable ticket from being claimed again
immediately after a successful run. Continuation turns require an explicit
continuation policy rather than implicit re-claiming through `claim-next`.

Conductor accounts may update only their own conductor registration and their own run lease/observability fields. Identity fields such as `ticket_id`, `conductor_id`, `claim_owner`, `state_at_start`, `handler_id`, and `session_user_id` are not conductor-writable after claim.

Expired leases are not renewable; the ticket must be claimed again. Terminal runs (`released`, `succeeded`, `failed`) cannot be reactivated. The claim service performs a post-save drift check; any remaining sub-request race is handled by reconciliation.

Conductor nodes never write ticket content or ticket state. Write-back remains the agent-session path.
