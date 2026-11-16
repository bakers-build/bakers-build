# Execution problems — design-verify

Diff 2.68% at 1440x900 (threshold 2%), severity minor. Actual capture of the scene at ticket commit 786c79b9 through the provision `designbook` key (web container Chromium). Accepted deviations stay accepted; new findings are recorded, not repaired here.

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-16 | triage | triage | members | invited-tone (minor): Invited badge is the neutral grey tone; the reference draws indigo. File: web/modules/custom/bb_core/src/Members/WorkspaceInvite.php | Accepted D4; not repaired in this run. |
| 2026-11-16 | triage | triage | members | resend (minor): The expired invitation offers no Resend action. File: web/modules/custom/bb_core/src/Members/WorkspaceInvite.php | Accepted D5; not repaired in this run. |
| 2026-11-16 | triage | triage | members | invite-action (minor): Invite members sits on the Members section header, not in the page header. File: web/modules/custom/bb_core/src/Form/GroupMembersForm.php | Accepted (behaviour out of scope); not repaired in this run. |
| 2026-11-16 | triage | triage | members | relative-dates (minor): Dates read 31 Oct / 6 Jan; the reference shows 12 days ago / 6 Jan 2026. File: web/modules/custom/bb_core/src/Time/BbDate.php | Accepted (product date formatter); not repaired in this run. |
| 2026-11-16 | triage | triage | members | person-two-lines (minor): Name and mail stack on two lines; the reference sets them inline. File: web/themes/custom/bb_theme/components/person/person.twig | Accepted (shared person cell); not repaired in this run. |
| 2026-11-16 | triage | triage | members | table-header (minor): Header row 40px on a fill; the reference draws a 33px header without fill. File: web/themes/custom/bb_theme/components/table/table.twig | Accepted (shared table); not repaired in this run. |
| 2026-11-16 | triage | triage | members | shell (minor): Sidebar entries, message fill, accent colours and status bar differ from the frame. File: web/themes/custom/bb_theme/designbook/design-system/design-system.scenes.yml | Accepted (earlier tickets); not repaired in this run. |
| 2026-11-16 | triage | triage | members | row-action-icons (minor): Revoke and Remove are icon-only buttons; the reference shows text actions. File: web/themes/custom/bb_theme/components/table/table.twig | New; not repaired in this run. |
| 2026-11-16 | triage | triage | members | self-remove (minor): The first member row (Christian Wiedemann) carries a remove action; the reference shows none there. File: web/themes/custom/bb_theme/designbook/sections/settings/settings.section.scenes.yml | New; not repaired in this run. |
