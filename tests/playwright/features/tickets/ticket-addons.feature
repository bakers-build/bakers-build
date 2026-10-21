@feature:ticket-addons
Feature: A reviewer shares a ticket's preview through the ticket's Addons card
  A conductor runs addons whose messages a person sends from the ticket
  detail page's always-visible Addons card (BB-661) — no overlay, no
  "Addons" button, no dialog. Ports offers one message, Share tunnels, that
  shares every service of the worktree and answers with a Markdown list. The
  conductor is simulated: it answers the inbox message the click left, the
  way a real conductor does in its next tick. Every scenario works on its own
  disposable ticket.

  Scenario: A ticket without conductor shows no addons card
    Given a disposable addons ticket without conductor
    And I am logged in as the account "cwiedemann"
    When I visit the disposable addons ticket
    Then I do not see the addons card

  Scenario: A guest reviewer shares the worktree's services
    Given a disposable addons ticket whose conductor runs the ports addon
    And I am logged in as the account "addon-reviewer"
    When I visit the disposable addons ticket
    Then the addons card offers "Share tunnels"
    When I click "Share tunnels" in the addons card
    Then a pending "ports.tunnel" message exists
    When the conductor answers it with the shared URL "https://e2e-demo.trycloudflare.com"
    Then the addons card shows the link "https://e2e-demo.trycloudflare.com"

  Scenario: Another requester's newer answer never replaces my own
    Given a disposable addons ticket whose conductor runs the ports addon
    And I am logged in as the account "addon-reviewer"
    When I visit the disposable addons ticket
    And I click "Share tunnels" in the addons card
    And the conductor answers it with the shared URL "https://reviewer.trycloudflare.com"
    And I am logged in as the account "cwiedemann"
    When I visit the disposable addons ticket
    Then I do not see the link "https://reviewer.trycloudflare.com"
    And the addons card shows "You have not sent a message to this addon."
