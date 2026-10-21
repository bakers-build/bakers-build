@feature:group-team-create
Feature: Creating groups and teams through one workspace dialog
  Scenario Outline: Create twice from the real workspace action
    Given I am logged in as the account "create-lead-a"
    When I open the "<type>" creation action in "create-a"
    Then the shared creation dialog shows only its identity fields
    When I create two "<type>" entries through the shared dialog
    Then the created entries have the current owner and workspace
    Examples:
      | type  |
      | group |
      | team  |

  Scenario Outline: Reject invalid names, retain input, and recover
    Given I am logged in as "Administrator"
    When I open the "<type>" creation action in "create-a"
    Then the shared creation dialog shows only its identity fields
    When I submit invalid names and then a 255 character name
    Then the created entries have the current owner and workspace
    Examples:
      | type  |
      | group |
      | team  |

  Scenario Outline: Dismissal never creates an entry
    Given I am logged in as the account "create-lead-a"
    When I open the "<type>" creation action in "create-a"
    Then cancel, close, and Escape each leave no new entry
    Examples:
      | type  |
      | group |
      | team  |

  # BB-462 F5: this outline used to bundle a LOCAL member with a FOREIGN
  # lead, both denied — correct under the old model, where the implicit
  # `member` rank granted nothing at all. D1 still empties that implicit
  # rank, but the ticket's own AC ("any workspace member may create
  # projects and groups, not only the workspace lead") makes an explicit
  # local `contributor` an ALLOWED case now, so the outline splits: local
  # is its own scenario below, and only the foreign rank stays denied here.
  Scenario: A foreign lead rank does not grant creation
    Given I am logged in as the account "create-lead-b"
    Then both create actions and direct routes are denied in "create-a"

  # GROUP only, not team: the ticket's spec is explicit that "only admin may
  # ... create a team" — `create bb_team` sits on the `lead` (admin) tier
  # alone, so a contributor never sees that action at all. Measured: the
  # first version of this scenario tried both types and the team example
  # failed on a trigger link that was correctly never rendered.
  Scenario: A local contributor creates a group too
    Given I am logged in as the account "create-member-a"
    When I open the "group" creation action in "create-a"
    Then the shared creation dialog shows only its identity fields
    When I create two "group" entries through the shared dialog
    Then the created entries have the current owner and workspace

  # BB-462 F5: the confirmed test plan named this scenario as one that "must
  # change" — it assumed the revoked account would remain a `contributor` and
  # keep the right. It does not. Fixture
  # `recipes/bb_e2e/content/og_membership/c6966291-c2b8-5456-86eb-4e8ec44f42f6.yml`
  # gives "create-revocable" the `bb_workspace-bb_workspace-lead` role and
  # nothing else, so under D1's emptied implicit `member` rank revoking `lead`
  # leaves the membership carrying no permission at all. The step already
  # revokes exactly what carries the right; it is unchanged on purpose.
  Scenario Outline: Revoking the rank after opening prevents the write
    Given I am logged in as the account "create-revocable"
    When I open the "<type>" creation action in "create-a"
    Then revoking the workspace lead rank prevents submission
    Examples:
      | type  |
      | group |
      | team  |
