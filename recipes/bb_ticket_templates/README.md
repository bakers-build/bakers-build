# bb_ticket_templates

Example `bb_ticket_template` definitions. Today: **Drupal update**
(`bd9e5a3c-7f21-4c68-9a04-2d1e6b8c5f30`), a `bb_chore` with label `work:code` whose
description points to the `keytec-drupal-update` skill. It ships **disabled**; its monthly
schedule is a trigger you add on the template (see *Monthly trigger* below).

The recipe applies `bb_seed` for the `work:*` labels. It creates **no template**, because a
template belongs to a project and only the target workspace knows it. The definition lives in
`templates/<uuid>.yml`, outside `content/`, so applying the recipe never loads its placeholders.

## Import into a workspace

Run as a user who may create `bb_ticket_template` in the project (workspace lead).

1. Check the UUID first. Any answer except `404` means the template exists, possibly
   customised: **skip, never overwrite.**

   ```bash
   bakers dropsh read bb_ticket_template/bb_ticket_template/bd9e5a3c-7f21-4c68-9a04-2d1e6b8c5f30
   ```

2. Only on `404`: create it with that UUID. Take the field values from
   `templates/bd9e5a3c-7f21-4c68-9a04-2d1e6b8c5f30.yml`, substitute the project (its UUID in the
   target workspace), the owner and the `work:code` label (the target workspace's own term;
   a label of another workspace fails validation), keep `enabled: false`, and POST the JSON:API document (with
   `data.id` set to the UUID) from a file:

   ```bash
   bakers dropsh create bb_ticket_template --bundle bb_ticket_template --data @template.json
   ```

3. Review it on the project's *Templates* tab, then enable it when the team wants it.

Re-running the procedure is safe: step 1 finds the template and stops.

## Monthly trigger

Triggers have no API and belong to one template, so this recipe ships none; add it on the
imported template. Run as the workspace lead (Admin rank).

1. Create a workspace service account with the **Contributor** rank (workspace *Settings* →
   service accounts) and make it a member of the project's owning team; without that membership
   the trigger cannot be enabled. That account owns the generated tickets; never use a person.
2. Open the template → *Triggers* → *Add trigger* and set:

   | Field | Value |
   |---|---|
   | Frequency | Monthly |
   | Day of month | 1 |
   | Time | 09:00 |
   | Time zone | Europe/Berlin |
   | Service account | the account from step 1 |
   | Enabled | checked (needs the template to be enabled as well) |

3. Save. The *Triggers* tab shows the trigger as *Enabled* with *Next run* on the next 1st at
   09:00 Europe/Berlin. Nothing runs before that time; cron creates one ticket per month, as the
   service account, and the row shows the latest outcome.

Pausing stops it; resuming does not catch up on months missed while paused.
