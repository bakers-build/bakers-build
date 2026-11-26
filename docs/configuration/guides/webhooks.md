# Send ticket activity to a webhook

Point an HTTPS endpoint at a project, a group or a whole workspace. Every ticket activity in that scope is POSTed to it as signed JSON.

**You need:** the Admin rank in the workspace ([ranks](/provision/security/access-and-data)), and an HTTPS endpoint that answers with a 2xx status.

1. Open the scope's **Webhooks** tab:

   | Scope | Where | Fires for |
   |---|---|---|
   | Project | The project, then **Webhooks** | Tickets of that project |
   | Group | The group, then **Webhooks** | Tickets of every project in the group |
   | Workspace | **Settings**, then **Webhooks** | Every ticket of the workspace |

2. Choose **Create webhook**, enter a **Name** and the **URL** (`https://` only), keep **Enabled** ticked, and save.

3. Copy the **signing secret** from the message shown after saving. It is not shown again.

**Done when:** the webhook is listed on the tab, and your endpoint receives a POST after the next ticket change in that scope.

A webhook keeps its scope for life. To move it, or to get a new secret, delete it and create it again. To pause it, open **Settings** and untick **Enabled**. Each tab lists only the webhooks of its own scope, so a group or workspace webhook is not listed on a project's tab, even though it fires for that project's tickets.

## What is sent

Each activity is one `POST` with a JSON body:

```json
{
  "event": "status_changed",
  "id": "<activity uuid>",
  "occurred": "2026-11-26T12:00:00+00:00",
  "workspace": "<workspace uuid>",
  "project": "<project uuid>",
  "ticket": {"uuid": "…", "identifier": "SHOP-42", "title": "…", "state": "working", "url": "https://…"},
  "actor": "<user uuid or null>",
  "previous_state": "plan",
  "new_state": "working"
}
```

`event` is one of `created`, `status_changed`, `assigned`, `claimed`, `run_ended`, `review_requested` and `review_completed`. Every event is sent; there is no filter.

| Header | Value |
|---|---|
| `X-Bakers-Event` | The event, as in the body |
| `X-Bakers-Delivery` | The activity UUID; the same on every retry, so you can drop duplicates |
| `X-Bakers-Timestamp` | Unix seconds of this attempt |
| `X-Bakers-Signature` | `sha256=` followed by the hex HMAC-SHA256 of `<timestamp>.<raw body>`, keyed with the secret |

## Check the signature

Recompute the HMAC over the raw body, before you parse it, and compare in constant time. Reject old timestamps to stop replays.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, timestamp, rawBody, signature) {
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  return fresh && expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

## Delivery and retries

- Deliveries go out on the server's cron run, never while the ticket change is being saved. A slow or failing endpoint does not slow down or break that change.
- A 2xx answer is success. Anything else, a redirect, a connection error or no answer within 5 seconds counts as a failure.
- A failed delivery is tried again on a later cron run, after 1, 2, 4 and 8 minutes at the earliest, up to 5 attempts in total, and then dropped. The server log records the dropped delivery.
- A webhook that is disabled or deleted before its delivery runs gets nothing.
- The server generates the secret and stores it as it is, because it needs the raw value to sign. Treat the endpoint as receiving ticket titles and states of its scope.
