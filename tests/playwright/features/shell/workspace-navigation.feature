Feature: Rail links follow the workspace switcher
  The rail's links carry the workspace the page is in, so switching the
  workspace must move every one of them.

  Scenario: Switching the workspace moves every rail link, both ways
    Given I am logged in as the account "login-multi"
    When I open My work in workspace "bakers"
    Then every rail link points into workspace "bakers"
    When I switch to workspace "other" with the workspace switcher
    Then every rail link points into workspace "other"
    When I switch to workspace "bakers" with the workspace switcher
    Then every rail link points into workspace "bakers"
