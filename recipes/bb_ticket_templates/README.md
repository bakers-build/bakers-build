# bb_ticket_templates

Example `bb_ticket_template` definitions. Today: **Drupal update**
(`bd9e5a3c-7f21-4c68-9a04-2d1e6b8c5f30`), a `bb_work` ticket of type `chore` whose
description points to the repository's `drupal-update` skill. It ships **disabled**; its monthly
schedule is a trigger you add on the template (see *Monthly trigger* below).

The recipe applies `bb_seed` for the `chore` type term. It creates **no template**, because a
template belongs to a project and only the target workspace knows it. The definition lives in
`templates/<uuid>.yml`, outside `content/`, so applying the recipe never loads its placeholders.

## Import into a workspace

Do this as a user who may add ticket templates in the project (workspace lead), on the web
application's own screens.

1. Open the project's *Templates* tab. If a template named **Drupal update** is already listed, it
   exists, possibly customised: **skip, never overwrite.**
2. Otherwise choose *Add template* and copy the values from
   `templates/bd9e5a3c-7f21-4c68-9a04-2d1e6b8c5f30.yml`: name, title pattern, description, workflow
   `bb_work`, target state `qualification`, and the type `chore` (the target workspace's own term;
   a term of another workspace fails validation). Leave it **disabled**, and save.
3. Review it on the *Templates* tab, then enable it when the team wants it.

Re-running the procedure is safe: step 1 finds the template and stops. The form assigns its own
UUID, so the imported template does not carry the file's UUID; the check in step 1 goes by name.

To create one ticket from the template by hand once it is enabled, use the *Templates* tab or the
`bakers_ticket_template_run` tool with the template's UUID (`bakers tools
tool_api__bakers_ticket_template_run --data @args.json`).

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
